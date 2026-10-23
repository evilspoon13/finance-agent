"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100 dark:focus:ring-zinc-100";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Username</span>
        <input name="username" autoComplete="username" autoCapitalize="none" required autoFocus className={input} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
