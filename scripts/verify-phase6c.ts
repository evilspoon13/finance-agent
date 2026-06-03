/**
 * Phase 6c verification: run the tool-using Q&A agent against real data via
 * local Ollama. Confirms tool calling works and answers are grounded.
 *
 * Run: npm run verify:phase6c
 */
import "dotenv/config";
import { runAgent } from "@/lib/ai/agent";

const QUESTIONS = [
  "What restaurant did I spend the most on?",
  "What am I overspending on according to my budget?",
  "How much did I spend on food and drink in the last 3 months?",
  "Which card should I use for dining right now?",
];

async function main() {
  for (const q of QUESTIONS) {
    console.log(`\n❯ ${q}`);
    const t0 = Date.now();
    const answer = await runAgent(q);
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(answer);
    console.log("―".repeat(60));
  }
  console.log("\nPHASE 6c OK ✅ (check that the figures match your data)");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nFailed:", err instanceof Error ? err.message : err);
  console.error("Is Ollama running with a tool-capable model? (e.g. ollama pull qwen2.5:7b)");
  process.exit(1);
});
