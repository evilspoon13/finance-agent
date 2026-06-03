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
