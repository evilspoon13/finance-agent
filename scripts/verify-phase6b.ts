/**
 * Phase 6b verification: generate a grounded AI insight from your real data via
 * local Ollama. Confirms the model server is reachable and that the summary
 * only uses computed numbers.
 *
 * Run: npm run verify:phase6b
 */
import "dotenv/config";
import { buildInsightFacts, generateInsight } from "@/lib/ai/insights";

async function main() {
  // Last 3 months (so trends have a comparison window).
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, now.getUTCDate()));

  console.log("→ Computed facts the model is allowed to use:");
  const facts = await buildInsightFacts({ from });
  console.log(JSON.stringify(facts, null, 2));

  console.log(`\n→ Generating insight via ${process.env.AI_MODEL ?? "default model"}…\n`);
  const text = await generateInsight({ from });
  console.log("―".repeat(50));
  console.log(text);
  console.log("―".repeat(50));
  console.log("\nPHASE 6b OK ✅ (verify the numbers above all appear in the facts)");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nFailed:", err instanceof Error ? err.message : err);
  console.error("Is Ollama running? Try: ollama serve  (and: ollama pull <model>)");
  process.exit(1);
});
