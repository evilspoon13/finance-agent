"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  removeItemAction,
  createManualAccountAction,
  setManualBalanceAction,
} from "@/app/(dashboard)/connections/actions";

const small =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
const input = "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base sm:text-sm dark:border-zinc-700";

function Pending({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return <>{pending ? busy : idle}</>;
}

/** Two-step remove: the first tap asks for confirmation in place (no browser dialog). */
export function RemoveItemButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={small}>
        Remove
      </button>
    );
  }
  return (
    <form action={removeItemAction} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-red-600 dark:text-red-400">Remove {name} and its history?</span>
      <button type="submit" className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white">
        <Pending idle="Remove" busy="Removing…" />
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={small}>
        Cancel
      </button>
    </form>
  );
}

/** Inline value editor for a manual account's balance. */
export function ManualBalance({ accountId, balanceCents }: { accountId: string; balanceCents: number | null }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="underline decoration-dotted">
        {balanceCents == null ? "Set value" : `$${(balanceCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
      </button>
    );
  }
  return (
    <form
      action={async (fd) => {
        await setManualBalanceAction(fd);
        setEditing(false);
      }}
      className="flex items-center justify-end gap-1.5"
    >
      <input type="hidden" name="accountId" value={accountId} />
      <input
        name="balance"
        type="number"
        step="0.01"
        min={0}
        autoFocus
        defaultValue={balanceCents == null ? "" : balanceCents / 100}
        className="w-28 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-right text-sm dark:border-zinc-700"
      />
      <button type="submit" className={small}>
        <Pending idle="Save" busy="…" />
      </button>
    </form>
  );
}

/** Add an account Plaid can't reach; its value is entered by hand. */
export function ManualAccountForm() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-zinc-500 underline">
        + Add an account by hand
      </button>
    );
  }
  return (
    <form
      action={async (fd) => {
        await createManualAccountAction(fd);
        setOpen(false);
      }}
      className="grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2 dark:border-zinc-800"
    >
      <p className="text-sm text-zinc-500 sm:col-span-2">
        For accounts Plaid can&apos;t see. Sync skips them; update the value here when it changes.
      </p>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Institution
        <input name="institution" required maxLength={80} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Account name
        <input name="name" required maxLength={80} className={input} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Type
        <select name="type" defaultValue="investment" className={input}>
          <option value="depository">Cash (checking, savings)</option>
          <option value="investment">Investment</option>
          <option value="credit">Credit card (amount owed)</option>
          <option value="loan">Loan (amount owed)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Subtype (optional)
        <input name="subtype" maxLength={40} placeholder="e.g. hsa, 401k, roth" className={input} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Current value ($)
        <input name="balance" type="number" step="0.01" min={0} required className={input} />
      </label>
      <div className="flex items-end gap-2">
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          <Pending idle="Add account" busy="Adding…" />
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
