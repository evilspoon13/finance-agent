import type OpenAI from "openai";
import { chatCompletion, aiModel } from "./client";
import { toolSpecs, runTool } from "./tools";

/**
 * Tool-using Q&A agent over the read-only analytics tools. The model plans
 * which tools to call; we execute them against Postgres and feed results back,
 * looping until it produces a final answer. It can only cite numbers the tools
 * return — no SQL, no secrets, no invented figures.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_TOOL_ROUNDS = 4;
// Cap output so a single answer can't eat the free-tier per-minute token budget.
const MAX_ANSWER_TOKENS = 600;

function systemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a personal-finance assistant answering questions about the user's own accounts. Today is ${today}.

TOPICS: tools take a plain "topic" string — you never deal in category codes. Pass the user's words, e.g. groceries, dining out, coffee, fast food, gas, rideshare, travel, shopping, entertainment, medical, utilities, income. The server resolves it.
- "groceries" = grocery stores ONLY. "dining out / restaurants / eating out" = restaurants + fast food + coffee (EXCLUDES groceries). "food" (general) = everything food & drink including groceries. Pick the topic that matches the user's words; if a tool returns "Unknown topic", retry with a listed one.

TOOLS:
- "how much did I spend on X" → get_spending(topic). It returns an exact total + count. Do NOT add up transactions yourself.
- "where do I spend the most / go most often" → get_top_merchants (sort='spend' for dollars, sort='visits' for frequency).
- "how many times / what dates / list my X" → get_transactions, then report EXACTLY the rows returned.
- A specific named place ("how much at Costco / Raising Cane's?") → get_transactions or get_top_merchants with search=<name> and NO topic (it may be categorized unexpectedly). Never say "no spending" for a named merchant until you've searched by name alone.
- "break down my spending / where does my money go" → get_spending_by_category.
- If a tool errors or returns nothing, fix the arguments and retry before concluding there's no data.

TIME WINDOW: if the user gives no dates, tools default to the LAST 3 MONTHS. Every tool result includes a "range" — always tell the user which window the answer covers (e.g. "in the last 3 months (since 2026-03-16)"). If they ask for a specific month/year, pass from/to.

GROUNDING (critical): every number, count, date and merchant name MUST come from a tool result this conversation — never invent or estimate. Use get_spending's total verbatim; a count equals the rows returned. For "per month" over a multi-month range, divide the total by the number of months and show period, total, and average.

STYLE: concise and direct — lead with the answer, then a brief detail. Dollar amounts and plain words, never category codes.`;
}

/**
 * Some OpenAI-compatible providers (e.g. Groq) reject a 400 when the model
 * emits a malformed tool call — gpt-oss leaking a "commentary" channel, Llama
 * emitting `<function=…>`, etc. It's stochastic, so retry with a temperature
 * nudge to break the bad deterministic output instead of failing the request.
 */
function isToolFormatError(err: unknown): boolean {
  const e = err as { status?: number; code?: string; error?: { code?: string; message?: string } };
  if (e?.status !== 400) return false;
  const code = e.code ?? e.error?.code ?? "";
  const msg = e.error?.message ?? "";
  return code === "tool_use_failed" || /tool call validation|not in request\.tools/i.test(msg);
}

async function chatWithRetry(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<OpenAI.Chat.ChatCompletion> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await chatCompletion({
        model: aiModel(),
        // Attempt 0 is deterministic (reduces guessing); retries nudge sampling
        // to escape a malformed tool-call the model keeps emitting.
        temperature: attempt === 0 ? 0 : 0.4,
        max_tokens: MAX_ANSWER_TOKENS,
        messages,
        tools: toolSpecs(),
        tool_choice: "auto",
      });
    } catch (err) {
      if (isToolFormatError(err) && attempt < MAX_ATTEMPTS - 1) {
        if (process.env.AI_DEBUG) console.error(`[ai] malformed tool call, retry ${attempt + 1}/${MAX_ATTEMPTS - 1}`);
        continue;
      }
      throw err;
    }
  }
  // Unreachable: the loop either returns a completion or throws.
  throw new Error("chat retry exhausted");
}

export async function runAgent(question: string, history: ChatTurn[] = []): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt() },
    ...history.slice(-6).map((t) => ({ role: t.role, content: t.content }) as const),
    { role: "user", content: question },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const completion = await chatWithRetry(messages);

    const msg = completion.choices[0]?.message;
    if (!msg) return "I couldn't generate a response.";

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push(msg);
      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        let args: unknown = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }
        const result = await runTool(call.function.name, args);
        if (process.env.AI_DEBUG) {
          console.error(`[ai] round ${round} -> ${call.function.name}(${call.function.arguments}) => ${JSON.stringify(result)}`);
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      continue; // let the model read the tool results
    }

    if (process.env.AI_DEBUG) console.error(`[ai] final answer:\n${msg.content?.trim()}`);
    return msg.content?.trim() || "I don't have an answer for that.";
  }

  return "I wasn't able to finish answering that — try narrowing the question.";
}
