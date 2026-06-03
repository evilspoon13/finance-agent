import { eq } from "drizzle-orm";
import { db } from "./client";
import { aiCache } from "./schema";

/** Read a cached entry for a scope key, if present. */
export async function getAiCache(
  scope: string,
): Promise<{ fingerprint: string; model: string; content: string; updatedAt: Date } | undefined> {
  const [row] = await db.select().from(aiCache).where(eq(aiCache.scope, scope)).limit(1);
  return row;
}

/** Upsert a cached entry for a scope key. */
export async function setAiCache(
  scope: string,
  fingerprint: string,
  model: string,
  content: string,
): Promise<void> {
  await db
    .insert(aiCache)
    .values({ scope, fingerprint, model, content, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: aiCache.scope,
      set: { fingerprint, model, content, updatedAt: new Date() },
    });
}
