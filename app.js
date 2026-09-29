const $ = (id) => document.getElementById(id);
const URGENCY_LABELS = { BASSE: "Basse", MOYENNE: "Moyenne", HAUTE: "Haute", CRITIQUE: "Critique" };
const STATUS_LABELS = { A_FAIRE: "À faire", EN_COURS: "En cours", TERMINE: "Terminé" };
const URGENCY_ORDER = { CRITIQUE: 0, HAUTE: 1, MOYENNE: 2, BASSE: 3 };

let editingId = null;
let devs = [];
let tasksRequest = 0;
// Toutes les tâches, chargées une fois : les filtres s'appliquent en mémoire.
const state = { tasks: [], loadedAt: 0 };
const REFRESH_AFTER_MS = 30_000;
// Actions en cours d'envoi : un rechargement lancé pendant ce temps ne doit pas écraser l'état optimiste.
const pendingIds = new Set();
let mutationVersion = 0;
let doneOpen = false;

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
  if (!res.ok) {
    const error = new Error(body?.error || "Erreur serveur");
    error.status = res.status;
    throw error;
  }
  return body;
}

/* ---------- Authentification ---------- */
// Un seul appel au chargement (et à chaque actualisation) : session, devs et tâches.
async function showView() {
  // Seule la réponse de la dernière requête est affichée (évite des résultats périmés).
  const request = ++tasksRequest;
  const version = mutationVersion;
  let data;
  try {
    data = await api("/api/bootstrap");
  } catch (error) {
    if (request !== tasksRequest) return;
    if (error.status === 401) {
      $("login-view").hidden = false;
      $("app-view").hidden = true;
    } else if ($("app-view").hidden) {
      $("login-view").hidden = false;
      $("login-error").textContent = error.message;
    } else {
      $("list-error").textContent = error.message;
    }
    return;
  }
  if (request !== tasksRequest) return;
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  $("list-error").textContent = "";
  applyDevs(data.devs);
  // Une action lancée pendant le chargement l'emporte sur les données reçues.
  if (!pendingIds.size && version === mutationVersion) {
    state.tasks = data.tasks;
    state.loadedAt = Date.now();
  }
  render();
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
    applyDevs(await api("/api/devs"));
  } catch {
    /* on garde la liste actuelle */
  }
}

function applyDevs(list) {
  devs = list;
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

// Après un renommage ou une suppression, l'API a aussi mis à jour les tâches :
// on reporte le même changement sur les tâches en mémoire au lieu de tout recharger.
async function settingsAction(action, reassign) {
  $("settings-error").textContent = "";
  try {
    await action();
  } catch (error) {
    $("settings-error").textContent = error.message;
    return;
  }
  mutationVersion++;
  state.tasks.forEach((task) => {
    if (task.assignedTo === reassign.from) task.assignedTo = reassign.to;
  });
  await loadDevs();
  render();
}

function renameDev(dev, name) {
  if (!name || name === dev.name) return;
  settingsAction(() => api(`/api/devs/${dev.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    { from: dev.name, to: name });
}

function deleteDev(dev) {
  if (!confirm(`Supprimer ${dev.name} ? Ses tâches seront désassignées.`)) return;
  settingsAction(() => api(`/api/devs/${dev.id}`, { method: "DELETE" }), { from: dev.name, to: null });
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
// Mêmes règles que le filtrage serveur de GET /api/tasks.
function filterTasks(tasks) {
  const status = $("f-status").value;
  const assigned = $("f-assigned").value;
  const urgency = $("f-urgency").value;
  const due = $("f-due").value;
  const term = $("f-search").value.trim().replace(/[%(),]/g, " ").toLowerCase();

  return tasks.filter((task) =>
    (!status || task.status === status) &&
    (!assigned || task.assignedTo === assigned) &&
    (!urgency || task.urgency === urgency) &&
    (due !== "overdue" || isOverdue(task)) &&
    (due !== "without" || !task.deadline) &&
    (!term || [task.cabCode, task.siteName, task.description].some((value) => value?.toLowerCase().includes(term))));
}

function render() {
  renderTasks(filterTasks(state.tasks));
}

function upsertTask(task) {
  const index = state.tasks.findIndex((item) => item.id === task.id);
  if (index === -1) state.tasks.push(task);
  else state.tasks[index] = task;
}

// Mise à jour optimiste : l'état et l'affichage changent tout de suite, la requête part
// en arrière-plan ; en cas d'erreur, `rollback` restaure l'état précédent.
async function optimistic(id, apply, request, rollback) {
  $("list-error").textContent = "";
  apply();
  mutationVersion++;
  pendingIds.add(id);
  render();
  try {
    const saved = await request();
    if (saved?.id) upsertTask(saved);
  } catch (error) {
    rollback();
    $("list-error").textContent = error.message;
  } finally {
    pendingIds.delete(id);
  }
  render();
}

// Critique > Haute > Moyenne > Basse, puis échéance la plus proche (sans échéance en dernier).
function compareTasks(a, b) {
  const byUrgency = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
  if (byUrgency) return byUrgency;
  if (!a.deadline || !b.deadline) return (a.deadline ? 0 : 1) - (b.deadline ? 0 : 1);
  return a.deadline.localeCompare(b.deadline);
}

// Nombre de jours entre aujourd'hui (Paris) et le jour d'échéance : négatif = en retard.
function daysUntil(deadline) {
  return Math.round((Date.parse(deadline.slice(0, 10)) - Date.parse(todayInParis())) / 86400000);
}

function isOverdue(task) {
  return task.status !== "TERMINE" && Boolean(task.deadline) && daysUntil(task.deadline) < 0;
}

function renderTasks(tasks) {
  $("count").textContent = `${tasks.length} résultat${tasks.length > 1 ? "s" : ""}`;

  const overdue = [];
  const todo = [];
  const done = [];
  tasks.forEach((task) => (task.status === "TERMINE" ? done : isOverdue(task) ? overdue : todo).push(task));
  overdue.sort(compareTasks);
  todo.sort(compareTasks);
  done.sort(compareTasks);

  renderRecap({
    overdue: overdue.length,
    critical: [...overdue, ...todo].filter((task) => task.urgency === "CRITIQUE").length,
    todo: todo.length,
    done: done.length,
  });

  const list = $("tasks");
  list.replaceChildren();
  if (!tasks.length) {
    list.append(el("p", { className: "muted empty", textContent: "Aucune tâche ne correspond aux filtres." }));
    return;
  }

  // Avec un filtre de statut, seule la section correspondante est affichée.
  const status = $("f-status").value;
  if (status !== "TERMINE") {
    if (overdue.length) list.append(taskSection("overdue", "En retard", overdue));
    if (todo.length) list.append(taskSection("todo", "À traiter", todo));
  }
  if ((!status || status === "TERMINE") && done.length) {
    const details = el("details", { id: "section-done", className: "task-section done", open: status === "TERMINE" || doneOpen },
      el("summary", { className: "section-title", textContent: `Terminées (${done.length})` }),
      el("ul", { className: "tasks" }, ...done.map((task) => renderTask(task))));
    details.addEventListener("toggle", () => {
      if ($("f-status").value !== "TERMINE") doneOpen = details.open;
    });
    list.append(details);
  }
}

function taskSection(id, title, tasks) {
  return el("section", { id: `section-${id}`, className: `task-section ${id}` },
    el("h2", { className: "section-title", textContent: `${title} (${tasks.length})` }),
    el("ul", { className: "tasks" }, ...tasks.map((task) => renderTask(task))));
}

function renderDue(deadline) {
  const days = daysUntil(deadline);
  let text = `Dans ${days} j`;
  if (days < 0) text = `En retard de ${-days} j`;
  else if (days === 0) text = "Aujourd'hui";
  else if (days === 1) text = "Demain";
  // Deadline stockée à minuit UTC : affichée en UTC pour garder le bon jour.
  const full = new Date(deadline).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  return el("span", { className: `due${days < 0 ? " late" : days === 0 ? " today" : ""}`, textContent: text, title: full });
}

function renderAssignee(name) {
  if (!name) return el("span", { className: "assignee none", textContent: "Non assigné" });
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return el("span", { className: "assignee", title: name },
    el("span", { className: "avatar", textContent: initials, ariaHidden: "true" }), name);
}

function renderTask(task) {
  const done = task.status === "TERMINE";
  const overdue = isOverdue(task);

  const checkbox = el("input", { type: "checkbox", checked: done, disabled: done, ariaLabel: "Marquer comme terminée" });
  checkbox.addEventListener("change", () => setStatus(task.id, "TERMINE"));

  // Ligne 1 : code CAB + site, pastilles à droite.
  const line1 = el("div", { className: "line1" });
  const cabHref = task.cabLink && safeUrl(task.cabLink);
  if (task.cabCode) {
    line1.append(cabHref
      ? el("a", { className: "cab", href: cabHref, target: "_blank", rel: "noopener noreferrer", textContent: task.cabCode })
      : el("strong", { className: "cab", textContent: task.cabCode }));
  }
  const siteHref = task.siteUrl && safeUrl(task.siteUrl);
  if (siteHref) {
    line1.append(el("a", { className: "site", href: siteHref, target: "_blank", rel: "noopener noreferrer", textContent: task.siteName || siteHref }));
  }
  if (!task.cabCode && !siteHref) line1.append(el("span", { className: "cab untitled", textContent: "Sans code" }));
  if (done && task.description) line1.append(el("span", { className: "desc-inline", textContent: task.description, title: task.description }));

  const tags = el("span", { className: "tags" });
  if (done) {
    tags.append(el("span", { className: "badge check", textContent: `✓ ${STATUS_LABELS.TERMINE}` }));
  } else {
    if (task.status === "EN_COURS") tags.append(el("span", { className: "badge EN_COURS", textContent: STATUS_LABELS.EN_COURS }));
    tags.append(el("span", { className: `badge ${task.urgency}`, textContent: URGENCY_LABELS[task.urgency] }));
  }
  line1.append(tags);

  // Ligne 2 : description (2 lignes max), échéance, assigné.
  const body = el("div", { className: "body" }, line1);
  if (!done) {
    if (task.description) body.append(el("p", { className: "desc", textContent: task.description, title: task.description }));
    body.append(el("div", { className: "meta" }, task.deadline && renderDue(task.deadline), renderAssignee(task.assignedTo)));
  }

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

  return el("li", { className: `task urg-${task.urgency}${done ? " done" : ""}${overdue ? " overdue" : ""}` }, checkbox, body, btns);
}

function setStatus(id, status) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.status === status) return;
  const previous = task.status;
  optimistic(id,
    () => (task.status = status),
    () => api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    () => (task.status = previous));
}

function removeTask(task) {
  if (!confirm(`Supprimer la tâche ${task.cabCode || task.siteName || task.siteUrl || ""} ?`)) return;
  const index = state.tasks.findIndex((item) => item.id === task.id);
  if (index === -1) return;
  const removed = state.tasks[index];
  optimistic(task.id,
    () => state.tasks.splice(index, 1),
    () => api(`/api/tasks/${task.id}`, { method: "DELETE" }),
    () => state.tasks.splice(Math.min(index, state.tasks.length), 0, removed));
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
  let saved;
  try {
    saved = editingId
      ? await api(`/api/tasks/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
  } catch (error) {
    $("form-error").textContent = error.message;
    return;
  } finally {
    submit.disabled = false;
  }
  // L'API renvoie la tâche enregistrée : on la place dans l'état sans tout recharger.
  mutationVersion++;
  upsertTask(saved);
  $("task-dialog").close();
  render();
});

/* ---------- Récapitulatif ---------- */
function renderRecap(counts) {
  Object.entries(counts).forEach(([key, value]) => ($(`stat-${key}`).textContent = value));
  document.querySelector('.stat[data-stat="overdue"]').ariaPressed = String($("f-due").value === "overdue");
  document.querySelector('.stat[data-stat="critical"]').ariaPressed = String($("f-urgency").value === "CRITIQUE");
  document.querySelector('.stat[data-stat="done"]').ariaPressed = String($("f-status").value === "TERMINE");
}

// Chaque compteur pilote les filtres existants ; un second clic retire le filtre.
// « À traiter » n'a pas de filtre dédié : on retire ce qui masque la section puis on y défile.
async function applyStat(stat) {
  if (stat === "overdue") {
    const on = $("f-due").value !== "overdue";
    $("f-due").value = on ? "overdue" : "";
    if (on && $("f-status").value === "TERMINE") $("f-status").value = "";
  } else if (stat === "critical") {
    $("f-urgency").value = $("f-urgency").value === "CRITIQUE" ? "" : "CRITIQUE";
  } else if (stat === "done") {
    const on = $("f-status").value !== "TERMINE";
    $("f-status").value = on ? "TERMINE" : "";
    if (on && $("f-due").value === "overdue") $("f-due").value = "";
  } else if (stat === "todo") {
    if ($("f-status").value === "TERMINE") $("f-status").value = "";
    if ($("f-due").value === "overdue") $("f-due").value = "";
  }
  render();
  if (stat === "todo") $("section-todo")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelectorAll(".recap .stat").forEach((button) =>
  button.addEventListener("click", () => applyStat(button.dataset.stat)));

/* ---------- Filtres ---------- */
// Filtres appliqués en mémoire : aucun appel réseau.
["f-status", "f-assigned", "f-urgency", "f-due"].forEach((id) => $(id).addEventListener("change", render));
$("f-search").addEventListener("input", render);
$("reset").addEventListener("click", () => {
  ["f-search", "f-status", "f-assigned", "f-urgency", "f-due"].forEach((id) => ($(id).value = ""));
  render();
});

/* ---------- Actualisation ---------- */
$("refresh").addEventListener("click", () => showView());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !$("app-view").hidden && Date.now() - state.loadedAt > REFRESH_AFTER_MS) {
    showView();
  }
});

/* ---------- Démarrage ---------- */
showView();
