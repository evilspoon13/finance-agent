import type OpenAI from "openai";
import { ai, aiModel } from "./client";
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

const MAX_TOOL_ROUNDS = 6;

function systemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a personal-finance assistant answering questions about the user's own accounts.
Today is ${today}.

TRANSLATE, NEVER ASK FOR CODES
- Category codes (e.g. FOOD_AND_DRINK, FOOD_AND_DRINK_RESTAURANT) are an INTERNAL detail for calling tools. NEVER show a code to the user and NEVER ask the user to supply one. Map their everyday words to the right code yourself.
- If a request is ambiguous, pick the most reasonable interpretation, answer, and state your assumption in plain English (e.g. "counting sit-down restaurants, not groceries") — do not bounce the question back.
- The tool category argument MUST be one of these exact pfc_primary codes: INCOME, TRANSFER_IN, TRANSFER_OUT, LOAN_PAYMENTS, BANK_FEES, ENTERTAINMENT, FOOD_AND_DRINK, GENERAL_MERCHANDISE, HOME_IMPROVEMENT, MEDICAL, PERSONAL_CARE, GENERAL_SERVICES, GOVERNMENT_AND_NON_PROFIT, TRANSPORTATION, TRAVEL, RENT_AND_UTILITIES. Never invent codes.
- "Food / food spending / eating" (general) = the WHOLE FOOD_AND_DRINK category. Pass category FOOD_AND_DRINK with NO subcategory so EVERYTHING is included — restaurants, fast food, coffee, AND groceries. Never split restaurants from fast food.
- "Restaurants / eating out / dining out" = restaurants + fast food + coffee together, excluding groceries: pass the subcategory ARRAY ["FOOD_AND_DRINK_RESTAURANT","FOOD_AND_DRINK_FAST_FOOD","FOOD_AND_DRINK_COFFEE"].
- Only narrow to a single subcategory when the user explicitly asks for one, e.g. "just groceries" = FOOD_AND_DRINK_GROCERIES, "just coffee" = FOOD_AND_DRINK_COFFEE.

CHOOSING TOOLS
- "Most often / most frequently / where do I go the most" is about COUNT → call get_top_merchants with sort='visits'. "Spend the most / biggest" is about dollars → sort='spend'.
- For a SPECIFIC named place ("what about Raising Cane's?", "how much at Costco?"), search get_transactions/get_top_merchants by name (search=) with NO category/subcategory filter — that merchant may be classified differently than you expect (e.g. Raising Cane's is fast food, not RESTAURANT). Never answer "no spending" for a named merchant until you've searched by name alone.
- To answer "how many times" or "what dates", call get_transactions for that merchant/category and report EXACTLY the rows it returns.
- If a tool errors or returns nothing, fix your arguments and retry before concluding there's no data.

GROUNDING — this is critical
- Every number, count, date, and merchant name you state MUST come from a tool result in this conversation. NEVER invent, estimate, or pattern-fill dates or counts.
- A count of occurrences MUST equal the number of rows the tool returned. If get_transactions returns 3 rows, the answer is 3 — never a different number, and list only those 3 dates.
- "Monthly" / "per month" over a multi-month range = total ÷ number of months in the range. Never present a multi-month total as a monthly figure; if asked for monthly, show the period, the total, and the per-month average.

STYLE
- Be concise and direct. Lead with the answer, then a brief supporting detail. Use dollar amounts and plain category names, never codes.`;
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
      return await ai().chat.completions.create({
        model: aiModel(),
        // Attempt 0 is deterministic (reduces guessing); retries nudge sampling
        // to escape a malformed tool-call the model keeps emitting.
        temperature: attempt === 0 ? 0 : 0.4,
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
    ...history.slice(-8).map((t) => ({ role: t.role, content: t.content }) as const),
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
