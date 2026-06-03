/**
 * Wipe all synced data (items cascade to accounts, transactions, holdings, cards).
 * Use before switching from Sandbox to Production so fake data doesn't mix in.
 *
 * Run: npm run db:reset
 */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`truncate table items cascade`;
  console.log("Reset: items/accounts/transactions/holdings/cards truncated.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
