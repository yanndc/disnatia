import Link from "next/link";
import { DisnatiaLogo } from "@/components/brand/disnatia-logo";
import { dashboardNavigation } from "@/components/dashboard/dashboard-navigation";
import { MobileNav } from "@/components/dashboard/mobile-nav";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white px-4 py-5 lg:block">
        <Link href="/overview" className="flex flex-col gap-2 px-2">
          <DisnatiaLogo className="h-9 w-auto text-slate-950" />
          <p className="text-xs text-slate-500">Assistant portefeuille DisnatIA</p>
        </Link>
        <nav className="mt-8 space-y-1">
          {dashboardNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <Link href="/overview" className="min-w-0">
              <DisnatiaLogo className="h-6 w-auto max-w-[9rem] text-slate-950" />
            </Link>
            <MobileNav items={dashboardNavigation} />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-5 py-6">{children}</main>
      </div>
    </div>
  );
}
