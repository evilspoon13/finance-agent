"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createCardAction, updateCardAction, deleteCardAction } from "@/app/(dashboard)/cards/actions";
import type { ManagedCard, CreditAccountOption } from "@/lib/db/rewards-queries";
import type { EarnRules } from "@/lib/rewards/rules";
import { quarterKey } from "@/lib/rewards/config";

interface Category {
  tag: string;
  label: string;
}

const pct = (bps: number | null | undefined) => (bps == null ? "" : String(bps / 100));
const dollarsInput = (cents: number | null | undefined) => (cents == null ? "" : String(cents / 100));
const dollars = (cents: number) => `$${(cents / 100).toLocaleString()}`;
const accountLabel = (a: CreditAccountOption) => (a.institution ? `${a.institution} · ${a.name}` : a.name);
const catLabel = (cats: Category[], tag: string) => cats.find((c) => c.tag === tag)?.label ?? tag;

const input =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
const smallInput = "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
const fieldLabel = "mb-1 block text-xs font-medium text-zinc-500";

export function CardManager({
  cards,
  accounts,
  categories,
}: {
  cards: ManagedCard[];
  accounts: CreditAccountOption[];
  categories: Category[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      {cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No cards yet. Connect a credit account and sync, or add one below.
        </p>
      ) : null}

      {cards.map((card) => (
        <CardRow key={card.id} card={card} accounts={accounts} categories={categories} />
      ))}

      {adding ? (
        <CardForm accounts={accounts} categories={categories} onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          + Add a card
        </button>
      )}
    </div>
  );
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

/** One-line summary of a card's rules, for the collapsed view. */
function rulesSummary(rules: EarnRules, categories: Category[]): string {
  if (rules.kind === "rotating") {
    const active = rules.schedule[quarterKey(new Date())] ?? [];
    const now = active.length ? active.map((t) => catLabel(categories, t)).join(", ") : "not set this quarter";
    const cap = rules.capCents ? ` up to ${dollars(rules.capCents)}/${rules.capPeriod ?? "quarter"}` : "";
    return `${rules.bonusBps / 100}% rotating (${now})${cap} · ${rules.baseBps / 100}% everything else`;
  }
  const bonuses = Object.entries(rules.bonuses)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([tag, bps]) => {
      const cap = rules.caps?.[tag as keyof typeof rules.caps];
      return `${(bps ?? 0) / 100}% ${catLabel(categories, tag)}${cap ? ` (to ${dollars(cap.cents)}/${cap.period})` : ""}`;
    });
  return [...bonuses, `${rules.baseBps / 100}% everything else`].join(" · ");
}

function CardRow({
  card,
  accounts,
  categories,
}: {
  card: ManagedCard;
  accounts: CreditAccountOption[];
  categories: Category[];
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <CardForm card={card} accounts={accounts} categories={categories} onDone={() => setEditing(false)} />;
  }
  const extras = [
    card.annualFeeCents ? `${dollars(card.annualFeeCents)}/yr fee` : null,
    card.signupBonus ? `Sign-up: ${card.signupBonus}` : null,
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{card.label}</div>
          <div className="text-xs text-zinc-500">
            {card.accountName
              ? `${card.institution ? `${card.institution} · ` : ""}${card.accountName}`
              : "Not linked to an account"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Edit
        </button>
      </div>
      <p className="mt-2 text-sm">{rulesSummary(card.earnRules, categories)}</p>
      {extras.length ? <p className="mt-1 text-xs text-zinc-500">{extras.join(" · ")}</p> : null}
      {card.notes ? <p className="mt-1 text-xs text-zinc-500">{card.notes}</p> : null}
    </div>
  );
}

/** The current quarter plus the next one, as YYYY-Qn keys. */
function upcomingQuarters(): string[] {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 1));
  return [quarterKey(now), quarterKey(next)];
}

function CardForm({
  card,
  accounts,
  categories,
  onDone,
}: {
  card?: ManagedCard;
  accounts: CreditAccountOption[];
  categories: Category[];
  onDone: () => void;
}) {
  const rules = card?.earnRules;
  const [kind, setKind] = useState<EarnRules["kind"]>(rules?.kind ?? "category");
  const rotating = rules?.kind === "rotating" ? rules : null;
  const category = rules?.kind === "category" ? rules : null;

  // Every quarter already on the schedule (kept so history stays correct) plus
  // the current and next quarter, newest first.
  const quarters = [...new Set([...Object.keys(rotating?.schedule ?? {}), ...upcomingQuarters()])]
    .sort()
    .reverse();
  const [showOld, setShowOld] = useState(false);
  const current = quarterKey(new Date());
  const visibleQuarters = showOld ? quarters : quarters.filter((q) => q >= current);
  const hiddenQuarters = quarters.filter((q) => !visibleQuarters.includes(q));

  async function submit(formData: FormData) {
    await (card ? updateCardAction(formData) : createCardAction(formData));
    onDone();
  }

  return (
    <div className="rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
      <form action={submit} className="space-y-4">
        {card ? <input type="hidden" name="id" value={card.id} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className={fieldLabel}>Card name</span>
            <input
              name="label"
              required
              defaultValue={card?.label ?? ""}
              placeholder="e.g. Everyday Cash Card"
              className={`w-full ${input}`}
            />
          </label>
          <label className="text-sm">
            <span className={fieldLabel}>Linked account</span>
            <select name="accountId" defaultValue={card?.accountId ?? ""} className={`w-full ${input}`}>
              <option value="">— none —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className={fieldLabel}>Reward type</span>
            <select
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as EarnRules["kind"])}
              className={input}
            >
              <option value="category">Fixed categories</option>
              <option value="rotating">Rotating quarterly categories</option>
            </select>
          </label>
          <label className="text-sm">
            <span className={fieldLabel}>Base rate (everything else)</span>
            <span className="flex items-center gap-2">
              <input
                name="baseRate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                required
                defaultValue={pct(rules?.baseBps ?? 100)}
                className={`w-24 ${input}`}
              />
              <span className="text-sm text-zinc-500">%</span>
            </span>
          </label>
        </div>

        {kind === "category" ? (
          <div>
            <div className={fieldLabel}>Category bonuses (leave blank for none; cap is optional)</div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {categories.map((c) => {
                const cap = category?.caps?.[c.tag as keyof NonNullable<typeof category.caps>];
                return (
                  <div key={c.tag} className="flex flex-wrap items-center gap-2">
                    <span className="w-36 shrink-0 text-xs text-zinc-500">{c.label}</span>
                    <input
                      name={`bonus_${c.tag}`}
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      defaultValue={pct(category?.bonuses[c.tag as keyof typeof category.bonuses])}
                      placeholder="—"
                      aria-label={`${c.label} bonus %`}
                      className={`w-16 ${smallInput}`}
                    />
                    <span className="text-xs text-zinc-400">%</span>
                    <input
                      name={`cap_${c.tag}`}
                      type="number"
                      step="1"
                      min="0"
                      defaultValue={dollarsInput(cap?.cents)}
                      placeholder="cap $"
                      aria-label={`${c.label} spend cap in dollars`}
                      className={`w-20 ${smallInput}`}
                    />
                    <select
                      name={`capPeriod_${c.tag}`}
                      defaultValue={cap?.period ?? "year"}
                      aria-label={`${c.label} cap period`}
                      className={smallInput}
                    >
                      <option value="year">/yr</option>
                      <option value="quarter">/qtr</option>
                      <option value="month">/mo</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm">
                <span className={fieldLabel}>Bonus rate</span>
                <span className="flex items-center gap-2">
                  <input
                    name="bonusRate"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    required
                    defaultValue={pct(rotating?.bonusBps ?? 500)}
                    className={`w-24 ${input}`}
                  />
                  <span className="text-sm text-zinc-500">%</span>
                </span>
              </label>
              <label className="text-sm">
                <span className={fieldLabel}>Bonus spend cap (optional)</span>
                <span className="flex items-center gap-2">
                  <span className="text-sm text-zinc-500">$</span>
                  <input
                    name="rotCap"
                    type="number"
                    step="1"
                    min="0"
                    defaultValue={dollarsInput(rotating?.capCents ?? 150_000)}
                    className={`w-28 ${input}`}
                  />
                  <select name="rotCapPeriod" defaultValue={rotating?.capPeriod ?? "quarter"} className={input}>
                    <option value="quarter">per quarter</option>
                    <option value="year">per year</option>
                    <option value="month">per month</option>
                  </select>
                </span>
              </label>
            </div>
            <div>
              <div className={fieldLabel}>Bonus categories by quarter</div>
              <div className="space-y-2">
                {visibleQuarters.map((q) => (
                  <QuarterRow key={q} quarter={q} selected={rotating?.schedule[q] ?? []} categories={categories} />
                ))}
                {/* Past quarters stay in the form (hidden) so saving never drops history. */}
                {hiddenQuarters.flatMap((q) =>
                  (rotating?.schedule[q] ?? []).map((t) => (
                    <input key={`${q}-${t}`} type="hidden" name={`sched_${q}`} value={t} />
                  )),
                )}
              </div>
              {hiddenQuarters.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowOld(true)}
                  className="mt-2 text-xs text-zinc-500 underline"
                >
                  Show {hiddenQuarters.length} past quarter{hiddenQuarters.length === 1 ? "" : "s"}
                </button>
              ) : null}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className={fieldLabel}>Annual fee ($)</span>
            <input
              name="annualFee"
              type="number"
              step="1"
              min="0"
              defaultValue={dollarsInput(card?.annualFeeCents)}
              className={`w-full ${input}`}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className={fieldLabel}>Sign-up bonus</span>
            <input name="signupBonus" defaultValue={card?.signupBonus ?? ""} className={`w-full ${input}`} />
          </label>
        </div>
        <label className="block text-sm">
          <span className={fieldLabel}>Notes</span>
          <textarea name="notes" rows={2} defaultValue={card?.notes ?? ""} className={`w-full ${input}`} />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton>{card ? "Save" : "Add card"}</SubmitButton>
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          {card ? (
            <button
              type="submit"
              formAction={async (fd) => {
                await deleteCardAction(fd);
                onDone();
              }}
              className="ml-auto rounded-md px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              Delete card
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function QuarterRow({
  quarter,
  selected,
  categories,
}: {
  quarter: string;
  selected: string[];
  categories: Category[];
}) {
  return (
    <fieldset className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
      <legend className="px-1 text-xs font-medium">{quarter}</legend>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <label
            key={c.tag}
            className="flex cursor-pointer items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1 text-xs has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-900 has-[:checked]:text-white dark:border-zinc-700 dark:has-[:checked]:border-zinc-100 dark:has-[:checked]:bg-zinc-100 dark:has-[:checked]:text-zinc-900"
          >
            <input
              type="checkbox"
              name={`sched_${quarter}`}
              value={c.tag}
              defaultChecked={selected.includes(c.tag)}
              className="sr-only"
            />
            {c.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
