// Loads the sample lender catalogue (src/data/loans.js) into PostgreSQL.
// Run: npm run seed   (safe to re-run — only adds lenders that are missing, so edits made in the CRM are kept; applies pending migrations first)
import { LENDERS } from "../data/loans.js";
import { lenders } from "../db/schema.js";
import { closeDB, connectDB, db } from "../lib/db.js";

await connectDB();
const rows = LENDERS.map((l, sortOrder) => ({ ...l, sortOrder, active: true }));
const result = await db
  .insert(lenders)
  .values(rows)
  .onConflictDoNothing({ target: lenders.id })
  .returning({ id: lenders.id });
console.log(`Lenders: ${result.length} added (${rows.length - result.length} already there, left as they are)`);
await closeDB();
