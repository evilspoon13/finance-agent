/**
 * Manual eval for the Q&A agent. Runs a few questions end-to-end against the
 * real DB and the configured model, printing tool calls (AI_DEBUG) + answers.
 * Run with: AI_DEBUG=1 npx tsx scripts/ai-eval.ts
 */
import "dotenv/config";
import { runAgent } from "@/lib/ai/agent";

const QUESTIONS =
  process.argv.slice(2).length > 0
    ? [process.argv.slice(2).join(" ")]
    : [
        "which restaurant do i go to the most, and how much do i spend there monthly?",
        "how many times did i go to chimys from january to june?",
        "what are the dates that i went to chimys?",
      ];

async function main() {
  for (const q of QUESTIONS) {
    console.error(`\n=================\nQ: ${q}\n=================`);
    const t = Date.now();
    const a = await runAgent(q);
    console.log(`\nA (${((Date.now() - t) / 1000).toFixed(1)}s): ${a}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
