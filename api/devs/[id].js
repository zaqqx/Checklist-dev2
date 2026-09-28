import { getAdminClient } from "../_lib/supabase.js";
import { requireAuth } from "../_lib/auth-guard.js";

// Les tâches référencent un dev par son nom ("assignedTo") : renommer ou supprimer
// un dev met aussi à jour ses tâches.
export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const db = getAdminClient();
  const { id } = req.query;
  if (typeof id !== "string" || !id) return res.status(400).json({ error: "Id invalide" });

  if (req.method !== "PATCH" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { data: dev, error: findError } = await db.from("Dev").select("name").eq("id", id).maybeSingle();
  if (findError) return res.status(500).json({ error: findError.message });
  if (!dev) return res.status(404).json({ error: "Dev introuvable" });

  if (req.method === "PATCH") {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 100) return res.status(400).json({ error: "Nom invalide" });
    if (name === dev.name) return res.status(200).json({ ok: true });

    const { error } = await db.from("Dev").update({ name }).eq("id", id);
    if (error?.code === "23505") return res.status(409).json({ error: "Ce nom existe déjà" });
    if (error) return res.status(500).json({ error: error.message });

    const { error: taskError } = await db.from("Task").update({ assignedTo: name }).eq("assignedTo", dev.name);
    if (taskError) return res.status(500).json({ error: taskError.message });
    return res.status(200).json({ ok: true });
  }

  const { error: taskError } = await db.from("Task").update({ assignedTo: null }).eq("assignedTo", dev.name);
  if (taskError) return res.status(500).json({ error: taskError.message });

  const { error } = await db.from("Dev").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
