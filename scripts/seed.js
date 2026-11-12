// Load the fake demo parties into the database in POSTGRES_URL. Wipes existing tee-khao rows.
import { db, ensure } from "../api/_lib.js";
import { seedDemo } from "../lib/seed.js";

await ensure();
const n = await seedDemo(db());
console.log(`seeded ${n} demo parties`);
await db().end();
