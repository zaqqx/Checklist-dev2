import { getAdminClient } from "../_lib/supabase.js";
import { requireAuth } from "../_lib/auth-guard.js";
import { TASK_COLUMNS, normalizeTask } from "../_lib/task-columns.js";
import { withRetry } from "../_lib/retry.js";
import { serverError } from "../_lib/errors.js";

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
  const { id } = req.query;
  if (typeof id !== "string" || !id) return res.status(400).json({ error: "Id invalide" });

  if (req.method === "PATCH") {
    const body = req.body ?? {};
    const patch = {};

    if (body.status !== undefined) {
      if (!STATUSES.has(body.status)) return res.status(400).json({ error: "Statut invalide" });
      patch.status = body.status;
    }
    if (body.cabCode !== undefined) {
      patch.cabCode = typeof body.cabCode === "string" ? body.cabCode.trim().slice(0, 100) || null : null;
    }
    if (body.cabLink !== undefined) {
      const cabLink = typeof body.cabLink === "string" ? body.cabLink.trim() : "";
      if (cabLink && !safeUrl(cabLink)) return res.status(400).json({ error: "Lien CAB invalide" });
      patch.cabLink = cabLink || null;
    }
    if (body.siteUrl !== undefined) {
      const siteUrl = typeof body.siteUrl === "string" ? body.siteUrl.trim() : "";
      if (siteUrl && !safeUrl(siteUrl)) return res.status(400).json({ error: "Lien de site invalide" });
      patch.siteUrl = siteUrl || null;
      patch.siteName = siteUrl ? siteNameFrom(siteUrl) : null;
    }
    if (body.description !== undefined) {
      patch.description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) || null : null;
    }
    if (body.notes !== undefined) {
      patch.notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 5000) || null : null;
    }
    if (body.urgency !== undefined) {
      if (!URGENCIES.has(body.urgency)) return res.status(400).json({ error: "Urgence invalide" });
      patch.urgency = body.urgency;
    }
    if (body.deadline !== undefined) {
      patch.deadline = body.deadline ? new Date(body.deadline).toISOString() : null;
    }
    if (body.assignedTo !== undefined) {
      patch.assignedTo = typeof body.assignedTo === "string" ? body.assignedTo || null : null;
    }

    const { data, error } = await withRetry(() => db.from("Task").update(patch).eq("id", id).select(TASK_COLUMNS).single());
    if (error?.code === "PGRST116") return res.status(404).json({ error: "Tâche introuvable" });
    if (error) return serverError(res, error);
    return res.status(200).json(normalizeTask(data));
  }

  if (req.method === "DELETE") {
    const { error } = await withRetry(() => db.from("Task").delete().eq("id", id));
    if (error) return serverError(res, error);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: "Méthode non autorisée" });
}
