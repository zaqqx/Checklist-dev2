const $ = (id) => document.getElementById(id);
const URGENCY_LABELS = { BASSE: "Basse", MOYENNE: "Moyenne", HAUTE: "Haute", CRITIQUE: "Critique" };
const STATUS_LABELS = { A_FAIRE: "À faire", EN_COURS: "En cours", TERMINE: "Terminé" };

let editingId = null;
let searchTimer;

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
  let names = [];
  try {
    names = (await api("/api/devs")).map((row) => row.name);
  } catch {
    return;
  }
  fillSelect($("f-assigned"), names, "Tous les assignés", $("f-assigned").value);
  fillSelect($("t-assignedTo"), names, "— Non assigné —", $("t-assignedTo").value);
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
    await api("/api/devs", { method: "POST", body: JSON.stringify({ name }) });
  } catch (error) {
    $("form-error").textContent = error.message;
    return;
  }
  $("new-dev").value = "";
  await loadDevs();
  $("t-assignedTo").value = name;
});

/* ---------- Liste ---------- */
async function loadTasks() {
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
    $("list-error").textContent = error.message;
    return;
  }
  renderTasks(data);
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
  const overdue = !done && task.deadline && new Date(task.deadline) < new Date();

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
  if (done) {
    const restore = el("button", { className: "btn small", textContent: "Restaurer" });
    restore.addEventListener("click", () => setStatus(task.id, "A_FAIRE"));
    btns.append(restore);
  } else {
    const status = el("select", { ariaLabel: "Statut" },
      el("option", { value: "A_FAIRE", textContent: STATUS_LABELS.A_FAIRE }),
      el("option", { value: "EN_COURS", textContent: STATUS_LABELS.EN_COURS }));
    status.value = task.status;
    status.addEventListener("change", () => setStatus(task.id, status.value));
    const edit = el("button", { className: "btn small", textContent: "Modifier" });
    edit.addEventListener("click", () => openForm(task));
    const remove = el("button", { className: "btn small danger", textContent: "Supprimer" });
    remove.addEventListener("click", () => removeTask(task));
    btns.append(status, edit, remove);
  }

  return el("li", { className: `task${done ? " done" : ""}` }, checkbox, info, btns);
}

async function setStatus(id, status) {
  try {
    await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
  } catch (error) {
    $("list-error").textContent = error.message;
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
function openForm(task = null) {
  editingId = task ? task.id : null;
  $("dialog-title").textContent = task ? "Modifier la tâche" : "Nouvelle tâche";
  $("form-error").textContent = "";
  $("t-cabCode").value = task?.cabCode ?? "";
  $("t-cabLink").value = task?.cabLink ?? "";
  $("t-siteUrl").value = task?.siteUrl ?? "";
  $("t-description").value = task?.description ?? "";
  $("t-urgency").value = task?.urgency ?? "MOYENNE";
  $("t-deadline").value = task?.deadline ? task.deadline.slice(0, 10) : "";
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

  try {
    if (editingId) {
      await api(`/api/tasks/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
    }
  } catch (error) {
    $("form-error").textContent = error.message;
    return;
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
