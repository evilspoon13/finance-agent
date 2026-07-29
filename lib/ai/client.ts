import OpenAI from "openai";
import { env } from "@/lib/env";

/**
 * Provider-agnostic LLM client. Points at an OpenAI-compatible endpoint —
 * local Ollama by default (free, on-device) — so financial data never leaves
 * the machine. Swap providers by changing AI_BASE_URL / AI_MODEL / AI_API_KEY.
 */

const globalForAi = globalThis as unknown as { __ai?: OpenAI };

export function ai(): OpenAI {
  if (globalForAi.__ai) return globalForAi.__ai;
  const client = new OpenAI({
    baseURL: env().AI_BASE_URL,
    apiKey: env().AI_API_KEY,
  });
  if (process.env.NODE_ENV !== "production") globalForAi.__ai = client;
  return client;
}

export function aiModel(): string {
  return env().AI_MODEL;
}

/** Friendly error if the local model server isn't reachable. */
export function aiUnavailableMessage(): string {
  return `AI model server not reachable at ${env().AI_BASE_URL}. Is Ollama running? (ollama serve, and pull ${env().AI_MODEL})`;
}

/**
 * Free hosted tiers (e.g. Groq gpt-oss-120b at 8000 TPM) rate-limit aggressively.
 * Two defenses live here so every caller benefits:
 *  1. Serialize all completions through one promise chain so the Spending
 *     insight and the chat agent never burn the per-minute budget at once.
 *  2. On a 429, wait the provider-suggested delay and retry a couple of times;
 *     if it's still rate-limited, throw a friendly RateLimitedError instead of
 *     a raw 500 so the UI can show "try again in a moment".
 */

export class RateLimitedError extends Error {
  readonly rateLimited = true;
  constructor(message = "The AI is rate-limited right now. Please try again in a moment.") {
    super(message);
    this.name = "RateLimitedError";
  }
}

export function isRateLimited(err: unknown): err is RateLimitedError {
  return Boolean((err as { rateLimited?: boolean })?.rateLimited);
}

/** Extract the retry delay (ms) a 429 wants us to wait, or null if not a 429. */
function retryDelayMs(err: unknown): number | null {
  const e = err as {
    status?: number;
    headers?: Record<string, string>;
    message?: string;
    error?: { message?: string };
  };
  if (e?.status !== 429) return null;
  const headerRA = Number(e.headers?.["retry-after"]);
  if (!Number.isNaN(headerRA) && headerRA > 0) return Math.ceil(headerRA * 1000);
  // Groq embeds the hint in the message, e.g. "Please try again in 24.18s".
  const m = /try again in ([\d.]+)\s*s/i.exec(e.error?.message ?? e.message ?? "");
  return m?.[1] ? Math.ceil(parseFloat(m[1]) * 1000) : 1000;
}

const MAX_429_RETRIES = 2;
const MAX_WAIT_MS = 8000; // don't make a request hang longer than this for a retry

async function attempt(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  tries = 0,
): Promise<OpenAI.Chat.ChatCompletion> {
  try {
    return await ai().chat.completions.create(params);
  } catch (err) {
    const delay = retryDelayMs(err);
    if (delay === null) throw err; // not a rate-limit; let the caller handle it
    if (tries < MAX_429_RETRIES && delay <= MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, delay));
      return attempt(params, tries + 1);
    }
    throw new RateLimitedError();
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialized, rate-limit-aware chat completion. All AI features should call this. */
export function chatCompletion(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.ChatCompletion> {
  const run = queue.then(() => attempt(params));
  // Keep the chain alive whether this call resolves or rejects.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
