const $ = (id) => document.getElementById(id);
const URGENCY_LABELS = { BASSE: "Basse", MOYENNE: "Moyenne", HAUTE: "Haute", CRITIQUE: "Critique" };
const STATUS_LABELS = { A_FAIRE: "À faire", EN_COURS: "En cours", TERMINE: "Terminé" };

let editingId = null;
let devs = [];
let searchTimer;
let tasksRequest = 0;

/* ---------- Utilitaires ---------- */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children.filter(Boolean));
  return node;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// Date du jour (AAAA-MM-JJ) à Paris. Les deadlines sont stockées à minuit UTC
// du jour d'échéance : une tâche n'est en retard qu'après la fin de ce jour.
function todayInParis() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

function siteNameFrom(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* réponse sans corps */
  }
  if (!res.ok) throw new Error(body?.error || "Erreur serveur");
  return body;
}

/* ---------- Authentification ---------- */
async function showView() {
  const { authenticated } = await api("/api/session");
  $("login-view").hidden = authenticated;
  $("app-view").hidden = !authenticated;
  if (authenticated) {
    await loadDevs();
    await loadTasks();
  }
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-error").textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        login: $("login-email").value.trim(),
        password: $("login-password").value,
      }),
    });
  } catch {
    $("login-error").textContent = "Identifiant ou mot de passe incorrect";
    return;
  }
  $("login-password").value = "";
  showView();
});

$("logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showView();
});

/* ---------- Devs ---------- */
async function loadDevs() {
  try {
    devs = await api("/api/devs");
  } catch {
    return;
  }
  const names = devs.map((dev) => dev.name);
  fillSelect($("f-assigned"), names, "Tous les assignés", $("f-assigned").value);
  fillSelect($("t-assignedTo"), names, "— Non assigné —", $("t-assignedTo").value);
  renderDevList();
}

async function addDev(name) {
  await api("/api/devs", { method: "POST", body: JSON.stringify({ name }) });
  await loadDevs();
}

function fillSelect(select, names, placeholder, selected) {
  select.replaceChildren(el("option", { value: "", textContent: placeholder }));
  names.forEach((name) => select.append(el("option", { value: name, textContent: name })));
  select.value = names.includes(selected) ? selected : "";
}

$("add-dev").addEventListener("click", async () => {
  const name = $("new-dev").value.trim();
  if (!name) return;
  try {
    await addDev(name);
  } catch (error) {
    $("form-error").textContent = error.message;
    return;
  }
  $("new-dev").value = "";
  $("t-assignedTo").value = name;
});

// Entrée dans « Nouveau dev » ajoute le dev au lieu d'enregistrer la tâche.
$("new-dev").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  $("add-dev").click();
});

/* ---------- Paramètres ---------- */
function renderDevList() {
  const list = $("dev-list");
  list.replaceChildren();
  if (!devs.length) {
    list.append(el("li", { className: "muted", textContent: "Aucun dev." }));
    return;
  }
  devs.forEach((dev) => {
    const input = el("input", { type: "text", value: dev.name, maxLength: 100, ariaLabel: "Nom du dev" });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      renameDev(dev, input.value.trim());
    });
    const rename = el("button", { type: "button", className: "btn small", textContent: "Renommer" });
    rename.addEventListener("click", () => renameDev(dev, input.value.trim()));
    const remove = el("button", { type: "button", className: "btn small danger", textContent: "Supprimer" });
    remove.addEventListener("click", () => deleteDev(dev));
    list.append(el("li", { className: "row" }, input, rename, remove));
  });
}

// Après un renommage ou une suppression, les tâches affichées changent aussi.
async function settingsAction(action) {
  $("settings-error").textContent = "";
  try {
    await action();
  } catch (error) {
    $("settings-error").textContent = error.message;
    return;
  }
  await loadDevs();
  loadTasks();
}

function renameDev(dev, name) {
  if (!name || name === dev.name) return;
  settingsAction(() => api(`/api/devs/${dev.id}`, { method: "PATCH", body: JSON.stringify({ name }) }));
}

function deleteDev(dev) {
  if (!confirm(`Supprimer ${dev.name} ? Ses tâches seront désassignées.`)) return;
  settingsAction(() => api(`/api/devs/${dev.id}`, { method: "DELETE" }));
}

$("settings").addEventListener("click", () => {
  $("settings-error").textContent = "";
  renderDevList();
  $("settings-dialog").showModal();
});
$("settings-close").addEventListener("click", () => $("settings-dialog").close());

$("settings-add").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("settings-new-dev").value.trim();
  if (!name) return;
  $("settings-error").textContent = "";
  try {
    await addDev(name);
  } catch (error) {
    $("settings-error").textContent = error.message;
    return;
  }
  $("settings-new-dev").value = "";
});

/* ---------- Liste ---------- */
async function loadTasks() {
  // Seule la réponse de la dernière requête est affichée (évite des résultats périmés).
  const request = ++tasksRequest;
  $("list-error").textContent = "";

  const params = new URLSearchParams();
  const status = $("f-status").value;
  const assigned = $("f-assigned").value;
  const urgency = $("f-urgency").value;
  const due = $("f-due").value;
  const search = $("f-search").value.trim();

  if (status) params.set("status", status);
  if (assigned) params.set("assigned", assigned);
  if (urgency) params.set("urgency", urgency);
  if (due) params.set("due", due);
  if (search) params.set("search", search);

  let data;
  try {
    data = await api(`/api/tasks?${params.toString()}`);
  } catch (error) {
    if (request === tasksRequest) $("list-error").textContent = error.message;
    return;
  }
  if (request === tasksRequest) renderTasks(data);
}

function renderTasks(tasks) {
  $("count").textContent = `${tasks.length} résultat${tasks.length > 1 ? "s" : ""}`;
  const list = $("tasks");
  list.replaceChildren();
  if (!tasks.length) {
    list.append(el("li", { className: "muted", textContent: "Aucune tâche ne correspond aux filtres." }));
    return;
  }
  tasks.forEach((task) => list.append(renderTask(task)));
}

function renderTask(task) {
  const done = task.status === "TERMINE";
  const overdue = !done && task.deadline && task.deadline.slice(0, 10) < todayInParis();

  const checkbox = el("input", { type: "checkbox", checked: done, disabled: done });
  checkbox.addEventListener("change", () => setStatus(task.id, "TERMINE"));

  const info = el("div", { className: "info" });
  const cabHref = task.cabLink && safeUrl(task.cabLink);
  if (task.cabCode) {
    info.append(cabHref
      ? el("a", { href: cabHref, target: "_blank", rel: "noopener noreferrer", textContent: task.cabCode })
      : el("strong", { textContent: task.cabCode }));
  }
  const siteHref = task.siteUrl && safeUrl(task.siteUrl);
  if (siteHref) {
    info.append(el("a", { href: siteHref, target: "_blank", rel: "noopener noreferrer", textContent: task.siteName || siteHref }));
  }
  if (task.description) info.append(el("small", { textContent: task.description }));
  info.append(el("span", { className: `badge ${task.urgency}`, textContent: URGENCY_LABELS[task.urgency] }));
  if (task.status === "EN_COURS") info.append(el("span", { className: "badge EN_COURS", textContent: STATUS_LABELS.EN_COURS }));
  if (task.deadline) {
    info.append(el("small", {
      className: overdue ? "late" : "",
      textContent: `${overdue ? "⚠ " : ""}${new Date(task.deadline).toLocaleDateString("fr-FR")}`,
    }));
  }
  if (task.assignedTo) info.append(el("small", { textContent: `→ ${task.assignedTo}` }));

  const btns = el("div", { className: "btns" });
  const edit = el("button", { className: "btn small", textContent: "Modifier" });
  edit.addEventListener("click", () => openForm(task));
  const duplicate = el("button", { className: "btn small", textContent: "Dupliquer" });
  duplicate.addEventListener("click", () => openForm(task, true));
  if (done) {
    const restore = el("button", { className: "btn small", textContent: "Restaurer" });
    restore.addEventListener("click", () => setStatus(task.id, "A_FAIRE"));
    btns.append(restore, edit, duplicate);
  } else {
    const status = el("select", { ariaLabel: "Statut" },
      el("option", { value: "A_FAIRE", textContent: STATUS_LABELS.A_FAIRE }),
      el("option", { value: "EN_COURS", textContent: STATUS_LABELS.EN_COURS }));
    status.value = task.status;
    status.addEventListener("change", () => setStatus(task.id, status.value));
    const remove = el("button", { className: "btn small danger", textContent: "Supprimer" });
    remove.addEventListener("click", () => removeTask(task));
    btns.append(status, edit, duplicate, remove);
  }

  return el("li", { className: `task${done ? " done" : ""}` }, checkbox, info, btns);
}

async function setStatus(id, status) {
  try {
    await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  } catch (error) {
    // Recharge d'abord (remet la carte dans son vrai état), puis affiche l'erreur
    // que loadTasks() aurait sinon effacée.
    await loadTasks();
    $("list-error").textContent = error.message;
    return;
  }
  loadTasks();
}

async function removeTask(task) {
  if (!confirm(`Supprimer la tâche ${task.cabCode || task.siteName || task.siteUrl || ""} ?`)) return;
  try {
    await api(`/api/tasks/${task.id}`, { method: "DELETE" });
  } catch (error) {
    $("list-error").textContent = error.message;
    return;
  }
  loadTasks();
}

/* ---------- Formulaire ---------- */
// duplicate : préremplit le formulaire depuis `task` mais crée une nouvelle tâche (sans deadline).
function openForm(task = null, duplicate = false) {
  editingId = task && !duplicate ? task.id : null;
  $("dialog-title").textContent = editingId ? "Modifier la tâche" : "Nouvelle tâche";
  $("form-error").textContent = "";
  $("t-cabCode").value = task?.cabCode ?? "";
  $("t-cabLink").value = task?.cabLink ?? "";
  $("t-siteUrl").value = task?.siteUrl ?? "";
  $("t-description").value = task?.description ?? "";
  $("t-urgency").value = task?.urgency ?? "MOYENNE";
  $("t-deadline").value = task?.deadline && !duplicate ? task.deadline.slice(0, 10) : "";
  $("t-assignedTo").value = task?.assignedTo ?? "";
  $("task-dialog").showModal();
}

$("new-task").addEventListener("click", () => openForm());
$("cancel").addEventListener("click", () => $("task-dialog").close());

$("task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const cabLink = $("t-cabLink").value.trim();
  const siteUrl = $("t-siteUrl").value.trim();

  if ((cabLink && !safeUrl(cabLink)) || (siteUrl && !safeUrl(siteUrl))) {
    $("form-error").textContent = "Lien invalide (http:// ou https:// requis)";
    return;
  }

  const deadline = $("t-deadline").value;
  const payload = {
    cabCode: $("t-cabCode").value.trim() || null,
    cabLink: cabLink || null,
    siteUrl: siteUrl || null,
    description: $("t-description").value.trim() || null,
    urgency: $("t-urgency").value,
    deadline: deadline ? new Date(deadline).toISOString() : null,
    assignedTo: $("t-assignedTo").value || null,
  };

  const submit = $("task-form").querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    if (editingId) {
      await api(`/api/tasks/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
    }
  } catch (error) {
    $("form-error").textContent = error.message;
    return;
  } finally {
    submit.disabled = false;
  }
  $("task-dialog").close();
  loadTasks();
});

/* ---------- Filtres ---------- */
["f-status", "f-assigned", "f-urgency", "f-due"].forEach((id) => $(id).addEventListener("change", loadTasks));
$("f-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadTasks, 300);
});
$("reset").addEventListener("click", () => {
  ["f-search", "f-status", "f-assigned", "f-urgency", "f-due"].forEach((id) => ($(id).value = ""));
  loadTasks();
});

/* ---------- Démarrage ---------- */
showView();
