import Link from "next/link";
import {
  BarChart3,
  FileUp,
  LayoutDashboard,
  MessageSquareText,
  Table2,
  Landmark,
  ArrowLeftRight,
  TrendingUp,
} from "lucide-react";

const navigation = [
  { href: "/overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { href: "/comptes", label: "Comptes", icon: Landmark },
  { href: "/positions", label: "Positions", icon: Table2 },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/revenus", label: "Revenus", icon: TrendingUp },
  { href: "/imports", label: "Imports", icon: FileUp },
  { href: "/insights", label: "Insights IA", icon: MessageSquareText },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white px-4 py-5 lg:block">
        <Link href="/overview" className="flex items-center gap-3 px-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-slate-950 text-white">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-950">DisnatIA</p>
            <p className="text-xs text-slate-500">Portefeuille Disnat</p>
          </div>
        </Link>
        <nav className="mt-8 space-y-1">
          {navigation.map((item) => (
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
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Dashboard portefeuille
              </p>
              <h1 className="text-lg font-semibold text-slate-950">DisnatIA</h1>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>Mono-utilisateur V1</p>
              <p>Données persistées via Prisma</p>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-5 py-6">{children}</main>
      </div>
    </div>
  );
}
