import { CountryCode, type AccountBase } from "plaid";
import { plaid } from "./client";

/**
 * Fetch accounts for an item plus the institution display name. Used at link
 * time (and on demand) to populate the accounts table.
 */

export interface FetchedAccounts {
  institutionName: string;
  itemId: string;
  accounts: AccountBase[];
}

export async function fetchAccounts(accessToken: string): Promise<FetchedAccounts> {
  const res = await plaid().accountsGet({ access_token: accessToken });
  const item = res.data.item;
  const institutionName = await resolveInstitutionName(item.institution_id);
  return {
    institutionName,
    itemId: item.item_id,
    accounts: res.data.accounts,
  };
}

async function resolveInstitutionName(institutionId: string | null | undefined): Promise<string> {
  if (!institutionId) return "Unknown institution";
  try {
    const res = await plaid().institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
    });
    return res.data.institution.name;
  } catch {
    return "Unknown institution";
  }
}
