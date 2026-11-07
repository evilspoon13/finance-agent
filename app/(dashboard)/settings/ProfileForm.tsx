"use client";

import { useActionState } from "react";
import { saveProfileAction } from "./actions";

export function ProfileForm({ initial }: { initial: string }) {
  const [error, action, pending] = useActionState(saveProfileAction, null);
  return (
    <form action={action} className="space-y-2">
      <textarea
        name="profile"
        rows={16}
        defaultValue={initial}
        spellCheck={false}
        className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-mono text-base sm:text-sm dark:border-zinc-700"
      />
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Save profile
      </button>
    </form>
  );
}
