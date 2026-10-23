"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/login/actions";

const LINKS = [
  { href: "/", label: "Net Worth" },
  { href: "/investments", label: "Investments" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/rewards", label: "Rewards" },
  { href: "/briefings", label: "Briefings" },
  { href: "/cards", label: "Cards" },
  { href: "/connections", label: "Connections" },
  { href: "/settings", label: "Settings" },
] as const;

/** Bottom-bar tabs on phones; everything else lives under "More". */
const PRIMARY = new Set<string>(["/", "/budgets", "/transactions", "/rewards"]);

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/** Floating pill at the top on sm+ screens. */
export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            isActive(pathname, link.href)
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
          }`}
        >
          {link.label}
        </Link>
      ))}
      <form action={logoutAction}>
        <button
          type="submit"
          className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
        >
          Log out
        </button>
      </form>
    </nav>
  );
}

/** Fixed bottom tab bar on phones, with a "More" sheet for the rest. */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = !LINKS.some((l) => PRIMARY.has(l.href) && isActive(pathname, l.href));

  const tab = (active: boolean) =>
    `flex flex-1 flex-col items-center justify-center py-2 text-[11px] font-medium ${
      active ? "text-zinc-900 dark:text-white" : "text-zinc-400"
    }`;

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 sm:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <div className="grid grid-cols-2 gap-2">
              {LINKS.filter((l) => !PRIMARY.has(l.href)).map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={`rounded-xl px-4 py-3 text-sm font-medium ${
                    isActive(pathname, l.href)
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                      : "bg-zinc-100 dark:bg-zinc-800"
                  }`}
                >
                  {l.label}
                </Link>
              ))}
              <Link
                href="/review"
                onClick={() => setOpen(false)}
                className="rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium dark:bg-zinc-800"
              >
                Review payments
              </Link>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-zinc-100 px-4 py-3 text-left text-sm font-medium text-red-600 dark:bg-zinc-800 dark:text-red-400"
                >
                  Log out
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden dark:border-zinc-800 dark:bg-zinc-950/90">
        {LINKS.filter((l) => PRIMARY.has(l.href)).map((l) => (
          <Link key={l.href} href={l.href} className={tab(isActive(pathname, l.href))}>
            <span className={`mb-0.5 h-1 w-1 rounded-full ${isActive(pathname, l.href) ? "bg-current" : ""}`} />
            {l.label}
          </Link>
        ))}
        <button type="button" onClick={() => setOpen(true)} className={tab(moreActive)}>
          <span className={`mb-0.5 h-1 w-1 rounded-full ${moreActive ? "bg-current" : ""}`} />
          More
        </button>
      </nav>
    </>
  );
}
