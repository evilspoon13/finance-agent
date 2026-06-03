/**
 * Phase 1 self-verification (Sandbox).
 *
 * Mints a Sandbox public_token, posts it through the real /api/plaid/exchange
 * route, and prints the result. Requires the dev server on localhost:3000.
 *
 * Run: npm run dev (in another shell), then: tsx scripts/verify-phase1.ts
 */
import "dotenv/config";
import { Configuration, PlaidApi, PlaidEnvironments, Products } from "plaid";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const INSTITUTION = "ins_109508"; // Plaid Sandbox "First Platypus Bank"

async function main() {
  const env = (process.env.PLAID_ENV ?? "sandbox") as "sandbox" | "production";
  const client = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
          "PLAID-SECRET": process.env.PLAID_SECRET,
        },
      },
    }),
  );

  console.log(`Creating Sandbox public_token for ${INSTITUTION}…`);
  const pt = await client.sandboxPublicTokenCreate({
    institution_id: INSTITUTION,
    initial_products: [Products.Transactions],
  });
  const publicToken = pt.data.public_token;
  console.log("  public_token:", publicToken.slice(0, 24) + "…");

  console.log(`POST ${BASE}/api/plaid/exchange …`);
  const res = await fetch(`${BASE}/api/plaid/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_token: publicToken }),
  });
  const body = await res.json();
  console.log("  status:", res.status);
  console.log("  body:", JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});
