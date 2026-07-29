"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createCardAction,
  updateCardAction,
  deleteCardAction,
  lookupCardRewardsAction,
  confirmCardAction,
} from "@/app/(dashboard)/cards/actions";

interface SuggestedBonus {
  category: string;
  ratePct: number;
  capAmount?: number | null;
  capPeriod?: string | null;
}
interface CardRewardSuggestion {
  currency: string;
  baseRatePct: number;
  bonuses: SuggestedBonus[];
  rotating: {
    bonusRatePct: number;
    capAmount?: number | null;
    quarters: { quarter: string; categories: string[] }[];
  } | null;
  annualFee: number | null;
  signupBonus: string | null;
  notes: string;
  confidence: "high" | "medium" | "low";
}
interface ManagedCard {
  id: string;
  label: string;
  accountId: string | null;
  accountName: string | null;
  institution: string | null;
  network: string;
  ruleKind: string;
  baseBps: number | null;
  bonuses: Record<string, number>;
  caps: Record<string, { cents: number; period: string }>;
  rotating: {
    bonusBps: number;
    baseBps: number;
    capCents: number | null;
    capPeriod: string | null;
    schedule: Record<string, string[]>;
  } | null;
  rewardsConfirmed: boolean;
  annualFeeCents: number | null;
  signupBonus: string | null;
  aiNotes: string | null;
  aiSuggestion: CardRewardSuggestion | null;
}
interface AccountOption {
  id: string;
  name: string;
  institution: string | null;
}
interface Category {
  tag: string;
  label: string;
}

const pct = (bps: number | null | undefined) => (bps == null ? "" : String(bps / 100));
const accountLabel = (a: AccountOption) => (a.institution ? `${a.institution} · ${a.name}` : a.name);
const catLabel = (cats: Category[], tag: string) => cats.find((c) => c.tag === tag)?.label ?? tag;
const dollars = (cents: number | null) => (cents == null ? null : `$${(cents / 100).toLocaleString()}`);

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  low: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export function CardManager({
  cards,
  accounts,
  categories,
}: {
  cards: ManagedCard[];
  accounts: AccountOption[];
  categories: Category[];
}) {
  const [adding, setAdding] = useState(false);
  const unconfirmed = cards.filter((c) => !c.rewardsConfirmed);
  const confirmed = cards.filter((c) => c.rewardsConfirmed);

  return (
    <div className="space-y-8">
      {unconfirmed.length > 0 ? (
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Needs your confirmation</h3>
            <p className="text-xs text-zinc-500">
              The AI looked up each card&apos;s rewards. Review and confirm — these don&apos;t count
              toward recommendations until you do.
            </p>
          </div>
          {unconfirmed.map((card) => (
            <ConfirmCard key={card.id} card={card} categories={categories} />
          ))}
        </section>
      ) : null}

      <section className="space-y-4">
        {confirmed.length > 0 ? (
          <h3 className="text-sm font-semibold">Your cards</h3>
        ) : unconfirmed.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No cards yet. Connect a credit account and sync, or add one manually below.
          </p>
        ) : null}

        {confirmed.map((card) => (
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
      </section>
    </div>
  );
}

function SubmitButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary"
      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
      : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${cls}`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

/** Unconfirmed card: auto-look-up rewards on mount, then show a confirm form. */
function ConfirmCard({ card, categories }: { card: ManagedCard; categories: Category[] }) {
  if (!card.aiSuggestion) return <AutoLookup card={card} />;
  return <ConfirmForm card={card} categories={categories} />;
}

function AutoLookup({ card }: { card: ManagedCard }) {
  const formRef = useRef<HTMLFormElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    formRef.current?.requestSubmit();
  }, []);

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="font-medium">{card.label}</div>
      <form ref={formRef} action={lookupCardRewardsAction} className="mt-2">
        <input type="hidden" name="id" value={card.id} />
        <LookupStatus />
      </form>
    </div>
  );
}

function LookupStatus() {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500">
      <span className={pending ? "animate-pulse" : ""}>
        {pending ? "Looking up rewards with AI…" : "Preparing lookup…"}
      </span>
    </div>
  );
}

function ConfirmForm({ card, categories }: { card: ManagedCard; categories: Category[] }) {
  const s = card.aiSuggestion!;
  const bonusByTag = new Map(s.bonuses.map((b) => [b.category, b]));

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/40 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium">{card.label}</div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[s.confidence]}`}>
          {s.confidence} confidence
        </span>
      </div>
      {s.notes ? <p className="mt-1 text-xs text-zinc-500">{s.notes}</p> : null}

      <form action={confirmCardAction} className="mt-3 space-y-4">
        <input type="hidden" name="id" value={card.id} />

        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Base rate (everything else)</span>
          <div className="flex items-center gap-2">
            <input
              name="baseRate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue={s.baseRatePct}
              className="w-24 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
            <span className="text-sm text-zinc-500">% {s.currency === "cashback" ? "cash back" : `${s.currency} (as % value)`}</span>
          </div>
        </label>

        {s.rotating ? (
          <RotatingPreview rotating={s.rotating} categories={categories} />
        ) : (
          <div>
            <div className="mb-2 text-xs font-medium text-zinc-500">Category bonuses (edit if wrong)</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {categories.map((c) => {
                const b = bonusByTag.get(c.tag);
                return (
                  <div key={c.tag} className="flex items-center gap-2 text-xs">
                    <span className="w-28 shrink-0 text-zinc-500">{c.label}</span>
                    <input
                      name={`bonus_${c.tag}`}
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      defaultValue={b ? b.ratePct : ""}
                      placeholder="—"
                      className="w-16 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                    />
                    <span className="text-zinc-400">%</span>
                    <input
                      name={`cap_${c.tag}`}
                      type="number"
                      step="1"
                      min="0"
                      defaultValue={b?.capAmount ?? ""}
                      placeholder="cap $"
                      title="Spend cap ($) for this bonus, if any"
                      className="w-20 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                    />
                    <select
                      name={`capPeriod_${c.tag}`}
                      defaultValue={b?.capPeriod ?? "year"}
                      className="rounded-md border border-zinc-300 bg-transparent px-1 py-1.5 dark:border-zinc-700"
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
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Annual fee ($)</span>
            <input
              name="annualFee"
              type="number"
              step="1"
              min="0"
              defaultValue={s.annualFee ?? ""}
              placeholder="0"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Signup bonus</span>
            <input
              name="signupBonus"
              defaultValue={s.signupBonus ?? ""}
              placeholder="e.g. $200 after $500 in 3 months"
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <SubmitButton>Confirm rewards</SubmitButton>
        </div>
      </form>

      <form action={lookupCardRewardsAction} className="mt-2">
        <input type="hidden" name="id" value={card.id} />
        <SubmitButton variant="secondary">Re-run AI lookup</SubmitButton>
      </form>
    </div>
  );
}

function RotatingPreview({
  rotating,
  categories,
}: {
  rotating: NonNullable<CardRewardSuggestion["rotating"]>;
  categories: Category[];
}) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800">
      <div className="mb-2 font-medium">
        Rotating {rotating.bonusRatePct}% categories
        {rotating.capAmount ? ` (up to $${rotating.capAmount.toLocaleString()}/quarter)` : ""}
      </div>
      {rotating.quarters.length === 0 ? (
        <p className="text-zinc-500">No quarters known yet — re-run lookup later in the year.</p>
      ) : (
        <ul className="space-y-1">
          {rotating.quarters.map((q) => (
            <li key={q.quarter} className="flex gap-2">
              <span className="w-16 shrink-0 font-medium text-zinc-500">{q.quarter}</span>
              <span>{q.categories.map((t) => catLabel(categories, t)).join(", ") || "—"}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-zinc-400">
        Rotating schedules are applied as found. Re-run the lookup to refresh as new quarters are
        announced.
      </p>
    </div>
  );
}

function CardRow({
  card,
  accounts,
  categories,
}: {
  card: ManagedCard;
  accounts: AccountOption[];
  categories: Category[];
}) {
  const [editing, setEditing] = useState(false);
  const editable = card.ruleKind === "category" || card.ruleKind === "flat";
  const bonusList = Object.entries(card.bonuses);

  if (editing) {
    return <CardForm card={card} accounts={accounts} categories={categories} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{card.label}</div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {card.accountName
              ? card.institution
                ? `${card.institution} · ${card.accountName}`
                : card.accountName
              : "Not linked to an account"}
            {card.annualFeeCents != null ? ` · ${dollars(card.annualFeeCents)}/yr fee` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editable ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Edit
            </button>
          ) : (
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-500 dark:bg-zinc-800">
              {card.rotating ? "Rotating" : "Advanced rule"}
            </span>
          )}
          <DeleteButton id={card.id} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
          {card.baseBps != null ? `${card.baseBps / 100}% base` : "miles"}
        </span>
        {card.rotating ? (
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {card.rotating.bonusBps / 100}% rotating
          </span>
        ) : null}
        {bonusList.map(([tag, bps]) => (
          <span
            key={tag}
            className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          >
            {bps / 100}% {catLabel(categories, tag)}
            {card.caps[tag] ? ` (≤$${(card.caps[tag].cents / 100).toLocaleString()}/${card.caps[tag].period})` : ""}
          </span>
        ))}
      </div>

      {card.rotating && Object.keys(card.rotating.schedule).length > 0 ? (
        <div className="mt-2 text-xs text-zinc-500">
          {Object.entries(card.rotating.schedule)
            .sort()
            .map(([q, tags]) => `${q}: ${tags.map((t) => catLabel(categories, t)).join(", ")}`)
            .join(" · ")}
        </div>
      ) : null}

      {card.aiNotes ? <p className="mt-2 text-xs text-zinc-400">{card.aiNotes}</p> : null}
    </div>
  );
}

function CardForm({
  card,
  accounts,
  categories,
  onDone,
}: {
  card?: ManagedCard;
  accounts: AccountOption[];
  categories: Category[];
  onDone: () => void;
}) {
  return (
    <form
      action={card ? updateCardAction : createCardAction}
      className="rounded-lg border border-zinc-300 p-4 dark:border-zinc-700"
    >
      {card ? <input type="hidden" name="id" value={card.id} /> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Card name</span>
          <input
            name="label"
            defaultValue={card?.label ?? ""}
            required
            placeholder="e.g. Chase Sapphire Preferred"
            className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Linked account</span>
          <select
            name="accountId"
            defaultValue={card?.accountId ?? ""}
            className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          >
            <option value="">— not linked —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-xs font-medium text-zinc-500">Base rate (everything else)</span>
        <div className="flex items-center gap-2">
          <input
            name="baseRate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            defaultValue={pct(card?.baseBps) || "1"}
            className="w-24 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
          <span className="text-sm text-zinc-500">% cash back</span>
        </div>
      </label>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-zinc-500">Category bonuses (leave blank for none)</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {categories.map((c) => (
            <label key={c.tag} className="text-xs">
              <span className="mb-1 block text-zinc-500">{c.label}</span>
              <div className="flex items-center gap-1">
                <input
                  name={`bonus_${c.tag}`}
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  defaultValue={pct(card?.bonuses[c.tag])}
                  placeholder="—"
                  className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
                />
                <span className="text-zinc-400">%</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {card ? "Save changes" : "Add card"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteButton({ id }: { id: string }) {
  return (
    <form action={deleteCardAction}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        onClick={(e) => {
          if (!confirm("Delete this card?")) e.preventDefault();
        }}
        className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
      >
        Delete
      </button>
    </form>
  );
}
