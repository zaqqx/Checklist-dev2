const db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const COLUMNS = "id,cabCode,cabLink,siteUrl,siteName,description,urgency,deadline,status,assignedTo";
const URGENCY_LABELS = { BASSE: "Basse", MOYENNE: "Moyenne", HAUTE: "Haute", CRITIQUE: "Critique" };

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

/* ---------- Authentification ---------- */
async function showView() {
  const { data } = await db.auth.getSession();
  const logged = Boolean(data.session);
  $("login-view").hidden = logged;
  $("app-view").hidden = !logged;
  if (logged) {
    await loadDevs();
    await loadTasks();
  }
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-error").textContent = "";
  const { error } = await db.auth.signInWithPassword({
    email: $("login-email").value.trim(),
    password: $("login-password").value,
  });
  if (error) {
    $("login-error").textContent = "Identifiant ou mot de passe incorrect";
    return;
  }
  $("login-password").value = "";
  showView();
});

$("logout").addEventListener("click", async () => {
  await db.auth.signOut();
  showView();
});

/* ---------- Devs ---------- */
async function loadDevs() {
  const { data, error } = await db.from("Dev").select("name").order("name");
  if (error) return;
  const names = data.map((row) => row.name);
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
  const { error } = await db.from("Dev").insert({ id: crypto.randomUUID(), name });
  if (error && error.code !== "23505") {
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
  let query = db.from("Task").select(COLUMNS);

  const status = $("f-status").value;
  const assigned = $("f-assigned").value;
  const urgency = $("f-urgency").value;
  const due = $("f-due").value;
  const search = $("f-search").value.trim().replace(/[%(),]/g, " ");

  if (status) query = query.eq("status", status);
  if (assigned) query = query.eq("assignedTo", assigned);
  if (urgency) query = query.eq("urgency", urgency);
  if (search) query = query.or(`cabCode.ilike.%${search}%,siteName.ilike.%${search}%,description.ilike.%${search}%`);
  if (due === "overdue") query = query.lt("deadline", new Date().toISOString()).neq("status", "TERMINE");
  if (due === "without") query = query.is("deadline", null);

  const { data, error } = await query
    .order("urgency", { ascending: false })
    .order("deadline", { ascending: true, nullsFirst: false });

  if (error) {
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
    const edit = el("button", { className: "btn small", textContent: "Modifier" });
    edit.addEventListener("click", () => openForm(task));
    const remove = el("button", { className: "btn small danger", textContent: "Supprimer" });
    remove.addEventListener("click", () => removeTask(task));
    btns.append(edit, remove);
  }

  return el("li", { className: `task${done ? " done" : ""}` }, checkbox, info, btns);
}

async function setStatus(id, status) {
  const { error } = await db.from("Task").update({ status }).eq("id", id);
  if (error) $("list-error").textContent = error.message;
  loadTasks();
}

async function removeTask(task) {
  if (!confirm(`Supprimer la tâche ${task.cabCode || task.siteName || task.siteUrl || ""} ?`)) return;
  const { error } = await db.from("Task").delete().eq("id", task.id);
  if (error) $("list-error").textContent = error.message;
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
    siteName: siteUrl ? siteNameFrom(siteUrl) : null,
    description: $("t-description").value.trim() || null,
    urgency: $("t-urgency").value,
    deadline: deadline ? new Date(deadline).toISOString() : null,
    assignedTo: $("t-assignedTo").value || null,
  };

  const { error } = editingId
    ? await db.from("Task").update(payload).eq("id", editingId)
    : await db.from("Task").insert({ id: crypto.randomUUID(), ...payload });

  if (error) {
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
