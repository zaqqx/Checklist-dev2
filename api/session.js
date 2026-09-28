import { isAuthenticated } from "./_lib/session.js";

export default async function handler(req, res) {
  res.status(200).json({ authenticated: isAuthenticated(req) });
}
