import { isAuthenticated } from "./session.js";

export function requireAuth(req, res) {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: "Non authentifié" });
    return false;
  }
  return true;
}
