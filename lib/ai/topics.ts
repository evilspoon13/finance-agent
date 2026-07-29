import { PFC_PRIMARIES } from "@/lib/category";

/**
 * Semantic topic layer for the Q&A agent.
 *
 * The model should NOT have to know Plaid's pfc codes — that leaked abstraction
 * is what made "groceries" resolve to the whole FOOD_AND_DRINK category. Instead
 * it passes a plain topic ("groceries", "dining out", "coffee", "gas"…) and we
 * resolve it here to the exact primary code or set of detailed codes. Totals are
 * then computed server-side so answers are exact and grounded.
 *
 * Codes below are grounded in the categories actually present in the data.
 */

export interface TopicScope {
  /** Human label to state back to the user, e.g. "groceries", "dining out". */
  label: string;
  /** pfc_primary code (whole category). */
  primary?: string;
  /** pfc_detailed codes (a specific slice). Takes precedence over `primary`. */
  detailed?: string[];
}

interface TopicDef extends TopicScope {
  canonical: string;
  aliases: string[];
}

// Per the product decision, "dining out / restaurants / eating out" means
// sit-down + fast food + coffee together (excludes groceries).
const DINING = ["FOOD_AND_DRINK_RESTAURANT", "FOOD_AND_DRINK_FAST_FOOD", "FOOD_AND_DRINK_COFFEE"];

const TOPIC_DEFS: TopicDef[] = [
  // Food & drink
  { canonical: "groceries", label: "groceries", detailed: ["FOOD_AND_DRINK_GROCERIES"], aliases: ["grocery", "supermarket", "supermarkets"] },
  { canonical: "dining out", label: "dining out", detailed: DINING, aliases: ["dining", "restaurants", "restaurant", "eating out", "eat out", "going out to eat", "takeout", "take out"] },
  { canonical: "coffee", label: "coffee", detailed: ["FOOD_AND_DRINK_COFFEE"], aliases: ["coffee shops", "cafe", "cafes", "coffee shop"] },
  { canonical: "fast food", label: "fast food", detailed: ["FOOD_AND_DRINK_FAST_FOOD"], aliases: ["fastfood"] },
  { canonical: "alcohol", label: "alcohol (beer/wine/liquor)", detailed: ["FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR"], aliases: ["beer", "wine", "liquor", "booze"] },
  { canonical: "food", label: "food & drink (everything, incl. groceries)", primary: "FOOD_AND_DRINK", aliases: ["food and drink", "food & drink", "food spending", "eating"] },

  // Shopping / merchandise
  { canonical: "shopping", label: "shopping (general merchandise)", primary: "GENERAL_MERCHANDISE", aliases: ["general merchandise", "retail", "merchandise"] },
  { canonical: "clothing", label: "clothing", detailed: ["GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES"], aliases: ["clothes", "apparel"] },

  // Transportation & travel
  { canonical: "transportation", label: "transportation", primary: "TRANSPORTATION", aliases: ["transport", "getting around"] },
  { canonical: "gas", label: "gas", detailed: ["TRANSPORTATION_GAS"], aliases: ["fuel", "gasoline"] },
  { canonical: "rideshare", label: "rideshare/taxis", detailed: ["TRANSPORTATION_TAXIS_AND_RIDE_SHARES"], aliases: ["uber", "lyft", "taxi", "taxis", "rides"] },
  { canonical: "parking", label: "parking", detailed: ["TRANSPORTATION_PARKING"], aliases: [] },
  { canonical: "public transit", label: "public transit", detailed: ["TRANSPORTATION_PUBLIC_TRANSIT"], aliases: ["transit", "bus", "train", "metro"] },
  { canonical: "travel", label: "travel", primary: "TRAVEL", aliases: ["trips", "vacation", "vacations"] },
  { canonical: "flights", label: "flights", detailed: ["TRAVEL_FLIGHTS"], aliases: ["airfare", "plane tickets", "flight"] },
  { canonical: "lodging", label: "lodging", detailed: ["TRAVEL_LODGING"], aliases: ["hotels", "hotel", "airbnb"] },

  // Health & personal
  { canonical: "medical", label: "medical", primary: "MEDICAL", aliases: ["health", "healthcare", "doctor", "medical bills"] },
  { canonical: "pharmacy", label: "pharmacy", detailed: ["MEDICAL_PHARMACIES_AND_SUPPLEMENTS"], aliases: ["pharmacies", "drugstore", "medications", "prescriptions"] },
  { canonical: "personal care", label: "personal care", primary: "PERSONAL_CARE", aliases: ["self care"] },
  { canonical: "gym", label: "gym/fitness", detailed: ["PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS"], aliases: ["gyms", "fitness"] },

  // Services / bills / home
  { canonical: "services", label: "general services", primary: "GENERAL_SERVICES", aliases: ["general services"] },
  { canonical: "education", label: "education", detailed: ["GENERAL_SERVICES_EDUCATION"], aliases: ["tuition", "school"] },
  { canonical: "utilities", label: "rent & utilities", primary: "RENT_AND_UTILITIES", aliases: ["bills", "rent and utilities"] },
  { canonical: "rent", label: "rent", detailed: ["RENT_AND_UTILITIES_RENT"], aliases: [] },
  { canonical: "phone", label: "phone", detailed: ["RENT_AND_UTILITIES_TELEPHONE"], aliases: ["telephone", "cell phone", "cellphone"] },
  { canonical: "home improvement", label: "home improvement", primary: "HOME_IMPROVEMENT", aliases: ["home", "hardware"] },

  // Other primaries
  { canonical: "entertainment", label: "entertainment", primary: "ENTERTAINMENT", aliases: ["fun"] },
  { canonical: "bank fees", label: "bank fees", primary: "BANK_FEES", aliases: ["fees"] },
  { canonical: "income", label: "income", primary: "INCOME", aliases: ["earnings", "paycheck", "paychecks"] },
  { canonical: "loan payments", label: "loan payments", primary: "LOAN_PAYMENTS", aliases: ["loans", "loan"] },
];

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

// alias/canonical (normalized) -> scope
const LOOKUP = new Map<string, TopicScope>();
for (const d of TOPIC_DEFS) {
  const scope: TopicScope = { label: d.label, primary: d.primary, detailed: d.detailed };
  for (const key of [d.canonical, ...d.aliases]) LOOKUP.set(normalize(key), scope);
}

const PRIMARY_SET = new Set<string>(PFC_PRIMARIES);

/** The canonical topic names, for tool descriptions and error hints. */
export const TOPIC_NAMES = TOPIC_DEFS.map((d) => d.canonical);

/**
 * Resolve a free-text topic to a concrete scope, or null if unknown.
 * Also accepts raw pfc codes (a primary like FOOD_AND_DRINK, or a detailed like
 * FOOD_AND_DRINK_GROCERIES) so the model can fall back to codes if it wants.
 */
export function resolveTopic(input: string): TopicScope | null {
  const n = normalize(input);
  if (!n) return null;

  const hit = LOOKUP.get(n) ?? LOOKUP.get(n.replace(/s$/, "")); // light plural fallback
  if (hit) return hit;

  // Raw pfc codes (the alias map uses spaces; codes use underscores).
  const code = input.trim().toUpperCase();
  if (PRIMARY_SET.has(code)) return { label: humanLabel(code), primary: code };
  const primary = PFC_PRIMARIES.find((p) => code.startsWith(`${p}_`));
  if (primary) return { label: humanLabel(code), detailed: [code] };

  return null;
}

function humanLabel(code: string): string {
  return code.toLowerCase().replace(/_/g, " ");
}
