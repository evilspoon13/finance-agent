import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Nav, MobileNav } from "@/components/Nav";
import { P2PReviewBanner } from "@/components/P2PReviewBanner";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts already gates every request; this is a second check in case a
  // route ever slips past its matcher.
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value))) redirect("/login");

  return (
    <>
      <header className="sticky top-0 z-20 hidden justify-center px-4 pt-4 sm:flex">
        {/* Centered floating capsule — glassy, rounded, with a soft shadow. */}
        <div className="flex max-w-[calc(100vw-2rem)] items-center overflow-x-auto rounded-full border border-zinc-200/70 bg-white/70 px-2 py-1.5 shadow-lg shadow-zinc-900/5 backdrop-blur-md dark:border-zinc-800/70 dark:bg-zinc-900/70">
          <Nav />
        </div>
      </header>
      <P2PReviewBanner />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
        {children}
      </main>
      <MobileNav />
    </>
  );
}
