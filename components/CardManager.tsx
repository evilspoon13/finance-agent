"use client";

import { useState } from "react";
import { createCardAction, updateCardAction, deleteCardAction } from "@/app/(dashboard)/cards/actions";

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

  return (
    <div className="space-y-4">
      {cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No cards yet. Connect a credit account and sync, or add one manually below.
        </p>
      ) : (
        cards.map((card) => (
          <CardRow key={card.id} card={card} accounts={accounts} categories={categories} />
        ))
      )}

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
              Advanced rule
            </span>
          )}
          <DeleteButton id={card.id} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
          {card.baseBps != null ? `${card.baseBps / 100}% base` : "miles / rotating"}
        </span>
        {bonusList.map(([tag, bps]) => (
          <span
            key={tag}
            className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          >
            {bps / 100}% {categories.find((c) => c.tag === tag)?.label ?? tag}
          </span>
        ))}
      </div>
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
        <span className="mb-1 block text-xs font-medium text-zinc-500">
          Base rate (everything else)
        </span>
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
        <div className="mb-2 text-xs font-medium text-zinc-500">
          Category bonuses (leave blank for none)
        </div>
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
