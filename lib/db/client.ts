import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Singleton Drizzle client over a postgres-js connection pool.
 *
 * Created on first use, not at import: `next build` imports every page module
 * and must work without DATABASE_URL. Reused across hot reloads in dev (cached
 * on globalThis) so we don't exhaust Postgres connections during fast refresh.
 */

function create() {
  return drizzle(
    postgres(env().DATABASE_URL, {
      max: 5,
      // A transaction-mode pooler (e.g. Neon's pooled URL) can't keep prepared
      // statements across connections.
      prepare: false,
      // Close connections idle for 20s. The host suspends the machine only after
      // minutes without traffic, so the pool is always empty by then; otherwise
      // it resumes holding sockets the server dropped meanwhile, and every query
      // hangs on them.
      idle_timeout: 20,
      connect_timeout: 15,
    }),
    { schema },
  );
}

type Db = ReturnType<typeof create>;

const globalForDb = globalThis as unknown as { __db?: Db };

function instance(): Db {
  if (globalForDb.__db) return globalForDb.__db;
  const created = create();
  // Cache in production too: one pool per process.
  globalForDb.__db = created;
  return created;
}

export const db = new Proxy({} as Db, {
  get(_, prop) {
    const real = instance();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
