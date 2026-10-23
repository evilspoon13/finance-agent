import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · Finance" };

export default async function LoginPage(props: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await props.searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="mt-1 text-sm text-zinc-500">Sign in to continue</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <LoginForm next={typeof next === "string" ? next : "/"} />
        </div>
      </div>
    </main>
  );
}
