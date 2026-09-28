import { randomUUID } from "node:crypto";
import { getAdminClient } from "./_lib/supabase.js";
import { requireAuth } from "./_lib/auth-guard.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const db = getAdminClient();

  if (req.method === "GET") {
    const { data, error } = await db.from("Dev").select("name").order("name");
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === "POST") {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 100) return res.status(400).json({ error: "Nom invalide" });
    const { error } = await db.from("Dev").insert({ id: randomUUID(), name });
    if (error && error.code !== "23505") return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: "Méthode non autorisée" });
}
