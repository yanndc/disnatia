import Link from "next/link";
import { DisnatiaLogo } from "@/components/brand/disnatia-logo";
import { AppVersionBadge } from "@/components/dashboard/app-version-badge";
import { dashboardNavigation } from "@/components/dashboard/dashboard-navigation";
import { dashboardNavIcons } from "@/components/dashboard/dashboard-nav-icons";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { NavBadge } from "@/components/dashboard/nav-badge";
import { loadAccountCoverageBadge } from "@/features/portfolio/account-coverage-summary";

/**
 * Pastille « comptes à confirmer » sur le lien Administration : elle évite d'ouvrir la session
 * guidée pour savoir si un compte manque une preuve de mise à jour.
 */
async function navigationWithBadges() {
  const coverage = await loadAccountCoverageBadge().catch(() => null);
  const toConfirm = coverage?.summary.toConfirm ?? 0;
  if (toConfirm <= 0) return dashboardNavigation;

  return dashboardNavigation.map((item) =>
    item.href === "/imports"
      ? {
          ...item,
          badgeCount: toConfirm,
          badgeLabel: `${toConfirm} compte(s) à confirmer — Session guidée, étape 1 « Comptes »`,
        }
      : item,
  );
}

export async function DashboardShell({ children }: { children: React.ReactNode }) {
  const items = await navigationWithBadges();

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
        <Link href="/overview" className="flex flex-col gap-2 px-2">
          <DisnatiaLogo className="h-9 w-auto text-slate-950" />
          <p className="text-xs text-slate-500">Assistant portefeuille DisnatIA</p>
        </Link>
        <nav className="mt-8 flex-1 space-y-1 overflow-y-auto">
          {items.map((item) => {
            const Icon = dashboardNavIcons[item.icon];
            return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            >
              <Icon className="size-4" />
              {item.label}
              <NavBadge count={item.badgeCount} label={item.badgeLabel} />
            </Link>
            );
          })}
        </nav>
        <div className="mt-4 border-t border-slate-100 pt-3">
          <AppVersionBadge showCalculation />
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <Link href="/overview" className="min-w-0">
              <DisnatiaLogo className="h-6 w-auto max-w-[9rem] text-slate-950" />
            </Link>
            <MobileNav items={items} />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-5 py-6">{children}</main>
      </div>
    </div>
  );
}
