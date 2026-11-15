import { db, ensure } from "../../api/_lib.js";

export const hasDb = !!process.env.TEST_DATABASE_URL;

export async function resetDb() {
  await ensure();
  const s = db();
  await s`truncate teekhao.parties, teekhao.scans, teekhao.hits cascade`;
  return s;
}
