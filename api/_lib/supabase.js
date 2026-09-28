import { createClient } from "@supabase/supabase-js";

let client;

// Client admin : utilise la clé secrète, ne doit jamais être importé côté navigateur.
export function getAdminClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }
  client = createClient(url, secretKey, { auth: { persistSession: false } });
  return client;
}
