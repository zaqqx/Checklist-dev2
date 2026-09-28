import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !publishableKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required.");
}

if (publishableKey.startsWith("sb_secret_") || publishableKey === process.env.SUPABASE_SECRET_KEY) {
  throw new Error("A Supabase secret key cannot be used in browser configuration.");
}

const parsedUrl = new URL(supabaseUrl);
if (parsedUrl.protocol !== "https:") {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS.");
}

const config = {
  SUPABASE_URL: supabaseUrl,
  SUPABASE_KEY: publishableKey,
};

writeFileSync("config.js", `window.CONFIG = ${JSON.stringify(config, null, 2)};\n`);
