/**
 * Applies generated Drizzle migrations. Uses DATABASE_URL_UNPOOLED when set
 * (a pooled connection, e.g. Neon's pooler, can't run DDL reliably), else
 * DATABASE_URL. Run with: npm run db:migrate
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to run migrations");

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
