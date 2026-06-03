import { Nav } from "@/components/Nav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const owner = process.env.APP_OWNER_NAME || "Owner";
  return (
    <div className="flex flex-1">
      <aside className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800">
        <div className="px-4 py-5">
          <h1 className="text-base font-semibold tracking-tight">Finance</h1>
          <p className="text-xs text-zinc-500">{owner}</p>
        </div>
        <Nav />
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
