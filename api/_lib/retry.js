const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 300;

// Erreurs JWT transitoires de Supabase : avec une clé sb_secret_, la passerelle génère un JWT
// que PostgREST peut juger « émis dans le futur » (léger décalage d'horloge). La requête suivante passe.
export function isTransientJwtError(error) {
  return Boolean(error) &&
    (error.code === "PGRST301" || error.code === "PGRST303" || /JWT issued at future/i.test(error.message ?? ""));
}

// Exécute une requête Supabase (`run` la reconstruit à chaque essai) et la réessaie jusqu'à
// 2 fois, après ~300 ms, si l'erreur est une erreur JWT transitoire. Les autres erreurs sont renvoyées telles quelles.
// insert : sur un nouvel essai, 23505 (clé déjà présente) signifie que l'essai précédent avait abouti.
export async function withRetry(run, { insert = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    const result = await run();
    if (!result.error) return result;
    if (insert && attempt > 0 && result.error.code === "23505") return { ...result, data: null, error: null, duplicate: true };
    if (attempt >= MAX_RETRIES || !isTransientJwtError(result.error)) return result;
    console.warn(`Supabase : erreur JWT transitoire, nouvel essai ${attempt + 1}/${MAX_RETRIES} :`, result.error.message);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}
