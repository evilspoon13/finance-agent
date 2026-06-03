import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Singleton Drizzle client over a postgres-js connection pool.
 *
 * Reused across hot reloads in dev (cached on globalThis) so we don't exhaust
 * Postgres connections during Next.js fast refresh.
 */

const globalForDb = globalThis as unknown as {
  __pg?: ReturnType<typeof postgres>;
};

const sql = globalForDb.__pg ?? postgres(env().DATABASE_URL, { max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.__pg = sql;

export const db = drizzle(sql, { schema });
export { schema };
