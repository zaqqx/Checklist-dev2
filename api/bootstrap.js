import { isAuthenticated } from "./_lib/session.js";
import { getAdminClient } from "./_lib/supabase.js";
import { TASK_COLUMNS, normalizeTask } from "./_lib/task-columns.js";
import { withRetry } from "./_lib/retry.js";
import { serverError } from "./_lib/errors.js";

// Tout ce qu'il faut pour afficher l'application, en un seul appel.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Méthode non autorisée" });
  if (!isAuthenticated(req)) return res.status(401).json({ authenticated: false, error: "Non authentifié" });

  const db = getAdminClient();
  const [devs, tasks] = await Promise.all([
    withRetry(() => db.from("Dev").select("id,name").order("name")),
    withRetry(() => db.from("Task").select(TASK_COLUMNS)
      .order("urgency", { ascending: false })
      .order("deadline", { ascending: true, nullsFirst: false })),
  ]);

  const error = devs.error || tasks.error;
  if (error) return serverError(res, error);
  return res.status(200).json({ authenticated: true, devs: devs.data, tasks: tasks.data.map(normalizeTask) });
}
