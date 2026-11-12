// Start every e2e run from an empty database.
import postgres from "postgres";

export default async function () {
  const sql = postgres(process.env.TEST_DATABASE_URL || "postgres://tk:tk@localhost:54329/tk", { ssl: false, onnotice: () => {} });
  try {
    await sql`create schema if not exists teekhao`;
    const [t] = await sql`select to_regclass('teekhao.parties') as t`;
    if (t.t) await sql`truncate teekhao.parties, teekhao.scans cascade`;
  } finally { await sql.end(); }
}
