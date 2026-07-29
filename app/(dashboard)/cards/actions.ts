"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createManagedCard,
  updateManagedCard,
  deleteManagedCard,
  getCardById,
  setCardSuggestion,
  getCardSuggestion,
  confirmCard,
  type CardInput,
} from "@/lib/db/rewards-queries";
import { recomputeAndPersist } from "@/lib/rewards/compute";
import { REWARD_CATEGORY_TAGS } from "@/lib/rewards/reward-categories";
import {
  lookupCardRewards,
  suggestionToEarnRules,
  type CardRewardSuggestion,
  type SuggestedBonus,
} from "@/lib/ai/card-rewards";

const pctSchema = z.coerce.number().min(0).max(100);
const pctToBps = (pct: number) => Math.round(pct * 100);

const EMPTY_SUGGESTION: CardRewardSuggestion = {
  currency: "cashback",
  baseRatePct: 1,
  bonuses: [],
  rotating: null,
  annualFee: null,
  signupBonus: null,
  cashbackMatchYearOne: false,
  notes: "",
  confidence: "low",
};

/** Build a CardInput from form fields: label, accountId, baseRate, bonus_<tag>. */
function parseCardInput(formData: FormData): CardInput | null {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return null;

  const base = pctSchema.safeParse(formData.get("baseRate"));
  if (!base.success) return null;

  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  const accountId = accountIdRaw || null;

  const bonuses: Record<string, number> = {};
  for (const tag of REWARD_CATEGORY_TAGS) {
    const raw = formData.get(`bonus_${tag}`);
    if (raw == null || String(raw).trim() === "") continue;
    const parsed = pctSchema.safeParse(raw);
    if (parsed.success && parsed.data > 0) bonuses[tag] = pctToBps(parsed.data);
  }

  return { label, accountId, network: "card", baseBps: pctToBps(base.data), bonuses };
}

async function refresh() {
  await recomputeAndPersist();
  revalidatePath("/cards");
  revalidatePath("/rewards");
}

export async function createCardAction(formData: FormData): Promise<void> {
  const input = parseCardInput(formData);
  if (!input) return;
  await createManagedCard(input);
  await refresh();
}

export async function updateCardAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  const input = parseCardInput(formData);
  if (!id || !input) return;
  await updateManagedCard(id, input);
  await refresh();
}

export async function deleteCardAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await deleteManagedCard(id);
  await refresh();
}

/** Run the AI rewards lookup for a card and cache the suggestion for confirming. */
export async function lookupCardRewardsAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const card = await getCardById(id);
  if (!card) return;
  const suggestion = await lookupCardRewards(card.label);
  await setCardSuggestion(id, suggestion);
  revalidatePath("/cards");
}

const amountOpt = (v: FormDataEntryValue | null): number | null => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Confirm a card's rewards. Starts from the server-trusted cached AI suggestion
 * and overlays the user's edits (base rate, per-category bonuses + caps, fee,
 * signup) for category cards; rotating schedules are carried through from the
 * suggestion. Marks the card confirmed so it counts toward recommendations.
 */
export async function confirmCardAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const base = (await getCardSuggestion(id)) ?? EMPTY_SUGGESTION;

  const baseRate = pctSchema.safeParse(formData.get("baseRate"));
  const baseRatePct = baseRate.success ? baseRate.data : base.baseRatePct;

  // Editable category bonuses (only for non-rotating cards; rotating carries through).
  let bonuses: SuggestedBonus[] = base.bonuses;
  if (!base.rotating) {
    bonuses = [];
    for (const tag of REWARD_CATEGORY_TAGS) {
      const rate = pctSchema.safeParse(formData.get(`bonus_${tag}`));
      if (!rate.success || rate.data <= 0) continue;
      const cap = amountOpt(formData.get(`cap_${tag}`));
      const periodRaw = String(formData.get(`capPeriod_${tag}`) ?? "");
      const capPeriod =
        cap && (periodRaw === "year" || periodRaw === "quarter" || periodRaw === "month")
          ? periodRaw
          : null;
      bonuses.push({ category: tag, ratePct: rate.data, capAmount: cap, capPeriod });
    }
  }

  const signup = String(formData.get("signupBonus") ?? "").trim();
  const suggestion: CardRewardSuggestion = {
    ...base,
    baseRatePct,
    bonuses,
    annualFee: amountOpt(formData.get("annualFee")),
    signupBonus: signup || null,
  };

  await confirmCard(id, suggestionToEarnRules(suggestion));
  await refresh();
}
