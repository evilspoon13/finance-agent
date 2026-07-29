import { Nav } from "@/components/Nav";
import { ChatDock } from "@/components/ai/ChatDock";
import { P2PReviewBanner } from "@/components/P2PReviewBanner";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 flex justify-center px-4 pt-4">
        {/* Centered floating capsule — glassy, rounded, with a soft shadow. */}
        <div className="flex max-w-[calc(100vw-2rem)] items-center rounded-full border border-zinc-200/70 bg-white/70 px-2 py-1.5 shadow-lg shadow-zinc-900/5 backdrop-blur-md dark:border-zinc-800/70 dark:bg-zinc-900/70">
          <Nav />
        </div>
      </header>
      <P2PReviewBanner />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      <ChatDock />
    </>
  );
}
