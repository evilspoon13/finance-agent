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

- Use the provided tools to fetch data before answering. Prefer the most specific tool.
- Category arguments use Plaid pfc_primary codes (e.g. FOOD_AND_DRINK); call get_spending_by_category first to discover codes if unsure.
- Only state numbers returned by tools. NEVER invent or estimate figures. If the tools don't have it, say so.
- Be concise and direct. Lead with the answer, then a brief supporting detail.`;
}

export async function runAgent(question: string, history: ChatTurn[] = []): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt() },
    ...history.slice(-8).map((t) => ({ role: t.role, content: t.content }) as const),
    { role: "user", content: question },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const completion = await ai().chat.completions.create({
      model: aiModel(),
      temperature: 0.2,
      messages,
      tools: toolSpecs(),
      tool_choice: "auto",
    });

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
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      continue; // let the model read the tool results
    }

    return msg.content?.trim() || "I don't have an answer for that.";
  }

  return "I wasn't able to finish answering that — try narrowing the question.";
}
