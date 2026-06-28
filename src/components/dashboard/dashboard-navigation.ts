export type DashboardNavIconName =
  | "layout-dashboard"
  | "shield-check"
  | "landmark"
  | "table2"
  | "arrow-left-right"
  | "trending-up"
  | "file-up"
  | "sparkles";

export type DashboardNavItem = {
  href: string;
  label: string;
  icon: DashboardNavIconName;
};

export const dashboardNavigation: DashboardNavItem[] = [
  { href: "/overview", label: "Vue d'ensemble", icon: "layout-dashboard" },
  { href: "/comptes", label: "Comptes", icon: "landmark" },
  { href: "/positions", label: "Positions", icon: "table2" },
  { href: "/transactions", label: "Transactions", icon: "arrow-left-right" },
  { href: "/revenus", label: "Revenus", icon: "trending-up" },
  { href: "/imports", label: "Administration", icon: "file-up" },
  { href: "/insights", label: "Discuter avec Berta", icon: "sparkles" },
];
