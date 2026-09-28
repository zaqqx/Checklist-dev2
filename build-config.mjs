import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

// Vérifie au build que toute la configuration serveur nécessaire est présente.
// Ces variables restent côté serveur (fonctions /api) et ne sont jamais envoyées au navigateur.
const required = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "APP_LOGIN", "APP_PASSWORD", "SESSION_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

const parsedUrl = new URL(process.env.SUPABASE_URL);
if (parsedUrl.protocol !== "https:") {
  throw new Error("SUPABASE_URL must use HTTPS.");
}

console.log("Configuration serveur validée.");
