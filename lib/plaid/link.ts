import { randomUUID } from "node:crypto";
import { CountryCode, Products } from "plaid";
import { plaid } from "./client";
import { plaidEnv, env } from "@/lib/env";

/**
 * Plaid Link lifecycle wrappers: create a link_token, and exchange a
 * public_token for a long-lived access_token + item_id.
 */

/** Stable per-user client_user_id for a single-user app. */
function clientUserId(): string {
  return `owner:${env().APP_OWNER_NAME}`;
}

export async function createLinkToken(): Promise<string> {
  const { PLAID_WEBHOOK_URL } = plaidEnv();
  const res = await plaid().linkTokenCreate({
    user: { client_user_id: clientUserId() },
    client_name: "Finance Aggregator",
    products: [Products.Transactions, Products.Investments],
    country_codes: [CountryCode.Us],
    language: "en",
    ...(PLAID_WEBHOOK_URL ? { webhook: PLAID_WEBHOOK_URL } : {}),
  });
  return res.data.link_token;
}

/**
 * Create a link_token in update mode to repair an item that needs
 * re-authentication (ITEM_LOGIN_REQUIRED). Used by the reconnect flow.
 */
export async function createUpdateLinkToken(accessToken: string): Promise<string> {
  const { PLAID_WEBHOOK_URL } = plaidEnv();
  const res = await plaid().linkTokenCreate({
    user: { client_user_id: clientUserId() },
    client_name: "Finance Aggregator",
    country_codes: [CountryCode.Us],
    language: "en",
    access_token: accessToken,
    ...(PLAID_WEBHOOK_URL ? { webhook: PLAID_WEBHOOK_URL } : {}),
  });
  return res.data.link_token;
}

export interface ExchangeResult {
  accessToken: string;
  itemId: string;
}

export async function exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
  const res = await plaid().itemPublicTokenExchange({ public_token: publicToken });
  return { accessToken: res.data.access_token, itemId: res.data.item_id };
}

/** Generate an app-internal id for a new item row. */
export function newItemId(): string {
  return randomUUID();
}
