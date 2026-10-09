import { randomUUID } from "node:crypto";
import { getAdminClient } from "./_lib/supabase.js";
import { requireAuth } from "./_lib/auth-guard.js";
import { TASK_COLUMNS, normalizeTask } from "./_lib/task-columns.js";
import { withRetry } from "./_lib/retry.js";
import { serverError } from "./_lib/errors.js";
const URGENCIES = new Set(["BASSE", "MOYENNE", "HAUTE", "CRITIQUE"]);
const STATUSES = new Set(["A_FAIRE", "EN_COURS", "TERMINE"]);

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

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const db = getAdminClient();

  if (req.method === "GET") {
    const { status, assigned, urgency, due, search } = req.query;
    // La requête est reconstruite à chaque essai de withRetry.
    const buildQuery = () => {
      let query = db.from("Task").select(TASK_COLUMNS);

      if (status && STATUSES.has(status)) query = query.eq("status", status);
      if (assigned) query = query.eq("assignedTo", String(assigned));
      if (urgency && URGENCIES.has(urgency)) query = query.eq("urgency", urgency);
      if (search) {
        const term = String(search).trim().replace(/[%(),]/g, " ");
        if (term) query = query.or(`cabCode.ilike.%${term}%,siteName.ilike.%${term}%,description.ilike.%${term}%,notes.ilike.%${term}%`);
      }
      if (due === "overdue") query = query.lt("deadline", `${todayInParis()}T00:00:00.000Z`).neq("status", "TERMINE");
      if (due === "without") query = query.is("deadline", null);

      return query
        .order("urgency", { ascending: false })
        .order("deadline", { ascending: true, nullsFirst: false });
    };

    const { data, error } = await withRetry(buildQuery);
    if (error) return serverError(res, error);
    return res.status(200).json(data.map(normalizeTask));
  }

  if (req.method === "POST") {
    const body = req.body ?? {};
    const cabLink = typeof body.cabLink === "string" ? body.cabLink.trim() : "";
    const siteUrl = typeof body.siteUrl === "string" ? body.siteUrl.trim() : "";
    if ((cabLink && !safeUrl(cabLink)) || (siteUrl && !safeUrl(siteUrl))) {
      return res.status(400).json({ error: "Lien invalide (http:// ou https:// requis)" });
    }

    const payload = {
      id: randomUUID(),
      cabCode: typeof body.cabCode === "string" ? body.cabCode.trim().slice(0, 100) || null : null,
      cabLink: cabLink || null,
      siteUrl: siteUrl || null,
      siteName: siteUrl ? siteNameFrom(siteUrl) : null,
      description: typeof body.description === "string" ? body.description.trim().slice(0, 2000) || null : null,
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 5000) || null : null,
      urgency: URGENCIES.has(body.urgency) ? body.urgency : "MOYENNE",
      deadline: body.deadline ? new Date(body.deadline).toISOString() : null,
      assignedTo: typeof body.assignedTo === "string" ? body.assignedTo || null : null,
    };

    const inserted = await withRetry(() => db.from("Task").insert(payload).select(TASK_COLUMNS).single(), { insert: true });
    if (inserted.error) return serverError(res, inserted.error);
    if (!inserted.duplicate) return res.status(200).json(normalizeTask(inserted.data));

    // Un essai précédent avait inséré la tâche : on la relit.
    const { data, error } = await withRetry(() => db.from("Task").select(TASK_COLUMNS).eq("id", payload.id).single());
    if (error) return serverError(res, error);
    return res.status(200).json(normalizeTask(data));
  }

  res.status(405).json({ error: "Méthode non autorisée" });
}
