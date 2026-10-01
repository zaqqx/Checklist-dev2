// Erreur Supabase ou serveur : détail complet dans les logs, message générique pour le client.
export function serverError(res, error) {
  console.error("Erreur serveur :", error);
  return res.status(500).json({ error: "Erreur temporaire, réessaie" });
}
