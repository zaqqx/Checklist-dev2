// Colonnes d'une tâche renvoyées au client (liste, création, modification), avec le nombre
// de commentaires calculé par Supabase dans la même requête (pas de requête par tâche).
export const TASK_COLUMNS = "id,cabCode,cabLink,siteUrl,siteName,description,notes,urgency,deadline,status,assignedTo,commentCount:TaskComment(count)";

// Supabase renvoie le compte sous la forme [{ count: n }] : on l'aplatit en nombre.
export function normalizeTask(row) {
  return { ...row, commentCount: row.commentCount?.[0]?.count ?? 0 };
}
