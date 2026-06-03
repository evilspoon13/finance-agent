import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { plaidEnv } from "@/lib/env";

/**
 * Singleton Plaid API client, configured from env. The environment switch
 * (sandbox|production) is driven by PLAID_ENV. Reused across hot reloads.
 */

const globalForPlaid = globalThis as unknown as { __plaid?: PlaidApi };

function build(): PlaidApi {
  const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV } = plaidEnv();
  const configuration = new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": PLAID_CLIENT_ID,
        "PLAID-SECRET": PLAID_SECRET,
      },
    },
  });
  return new PlaidApi(configuration);
}

export function plaid(): PlaidApi {
  if (globalForPlaid.__plaid) return globalForPlaid.__plaid;
  const client = build();
  if (process.env.NODE_ENV !== "production") globalForPlaid.__plaid = client;
  return client;
}
