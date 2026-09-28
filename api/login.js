import { createHash, timingSafeEqual } from "node:crypto";
import { createSessionCookie } from "./_lib/session.js";

function safeEqual(a, b) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const appLogin = process.env.APP_LOGIN;
  const appPassword = process.env.APP_PASSWORD;
  if (!appLogin || !appPassword) {
    res.status(500).json({ error: "Configuration serveur invalide" });
    return;
  }

  const { login, password } = req.body ?? {};
  if (typeof login !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }

  const loginOk = safeEqual(login.trim().toLowerCase(), appLogin.trim().toLowerCase());
  const passwordOk = safeEqual(password, appPassword);

  if (!loginOk || !passwordOk) {
    res.status(401).json({ error: "Identifiant ou mot de passe incorrect" });
    return;
  }

  res.setHeader("Set-Cookie", createSessionCookie());
  res.status(200).json({ ok: true });
}
