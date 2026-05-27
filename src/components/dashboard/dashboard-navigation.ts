import {
  FileUp,
  LayoutDashboard,
  Sparkles,
  Table2,
  Landmark,
  ArrowLeftRight,
  TrendingUp,
} from "lucide-react";
import type { MobileNavItem } from "./mobile-nav";

export const dashboardNavigation: MobileNavItem[] = [
  { href: "/overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { href: "/comptes", label: "Comptes", icon: Landmark },
  { href: "/positions", label: "Positions", icon: Table2 },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/revenus", label: "Revenus", icon: TrendingUp },
  { href: "/imports", label: "Imports", icon: FileUp },
  { href: "/insights", label: "Discuter avec Berta", icon: Sparkles },
];
