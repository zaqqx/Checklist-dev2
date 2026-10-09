import { randomUUID } from "node:crypto";
import { getAdminClient } from "./_lib/supabase.js";
import { requireAuth } from "./_lib/auth-guard.js";
import { withRetry } from "./_lib/retry.js";
import { serverError } from "./_lib/errors.js";

// Un seul fichier pour les commentaires (limite de fonctions Vercel Hobby) :
// GET ?taskId=…, POST { taskId, author, body }, DELETE ?id=…
const COMMENT_COLUMNS = "id,taskId,author,body,createdAt";
const BODY_MAX = 2000;

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const db = getAdminClient();

  if (req.method === "GET") {
    const { taskId } = req.query;
    if (typeof taskId !== "string" || !taskId) return res.status(400).json({ error: "Tâche invalide" });
    const { data, error } = await withRetry(() =>
      db.from("TaskComment").select(COMMENT_COLUMNS).eq("taskId", taskId).order("createdAt", { ascending: true }));
    if (error) return serverError(res, error);
    return res.status(200).json(data);
  }

  if (req.method === "POST") {
    const taskId = typeof req.body?.taskId === "string" ? req.body.taskId : "";
    const author = typeof req.body?.author === "string" ? req.body.author.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!taskId) return res.status(400).json({ error: "Tâche invalide" });
    if (!body) return res.status(400).json({ error: "Le commentaire est vide" });
    if (body.length > BODY_MAX) return res.status(400).json({ error: `Commentaire trop long (${BODY_MAX} caractères max)` });
    if (!author) return res.status(400).json({ error: "Choisissez un auteur" });

    const [task, dev] = await Promise.all([
      withRetry(() => db.from("Task").select("id").eq("id", taskId).maybeSingle()),
      withRetry(() => db.from("Dev").select("id").eq("name", author).maybeSingle()),
    ]);
    if (task.error || dev.error) return serverError(res, task.error || dev.error);
    if (!task.data) return res.status(404).json({ error: "Tâche introuvable" });
    if (!dev.data) return res.status(400).json({ error: "Auteur inconnu" });

    const comment = { id: randomUUID(), taskId, author, body };
    const inserted = await withRetry(() => db.from("TaskComment").insert(comment).select(COMMENT_COLUMNS).single(), { insert: true });
    // 23503 : la tâche a été supprimée entre la vérification et l'insertion.
    if (inserted.error?.code === "23503") return res.status(404).json({ error: "Tâche introuvable" });
    if (inserted.error) return serverError(res, inserted.error);
    if (!inserted.duplicate) return res.status(200).json(inserted.data);

    // Un essai précédent avait inséré le commentaire : on le relit.
    const { data, error } = await withRetry(() => db.from("TaskComment").select(COMMENT_COLUMNS).eq("id", comment.id).single());
    if (error) return serverError(res, error);
    return res.status(200).json(data);
  }

  if (req.method === "DELETE") {
    const { id } = req.query;
    if (typeof id !== "string" || !id) return res.status(400).json({ error: "Commentaire invalide" });
    const { error } = await withRetry(() => db.from("TaskComment").delete().eq("id", id));
    if (error) return serverError(res, error);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: "Méthode non autorisée" });
}
