import { db, ensure, handle, httpError } from "./_lib.js";
import { seedDemo } from "../lib/seed.js";

// Daily demo reset (Vercel Cron sends "Authorization: Bearer $CRON_SECRET").
// Does nothing on the real site: without DEMO_MODE=1 it is a 404.
export default handle(async (req, res) => {
  if (process.env.DEMO_MODE !== "1") throw httpError(404, "Not found");
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers && req.headers.authorization) || "";
  if (!secret || auth !== "Bearer " + secret) throw httpError(401, "Unauthorized");
  await ensure();
  const n = await seedDemo(db());
  res.status(200).json({ ok: true, parties: n });
});
