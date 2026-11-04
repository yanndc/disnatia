export type DashboardNavIconName =
  | "layout-dashboard"
  | "shield-check"
  | "landmark"
  | "table2"
  | "arrow-left-right"
  | "trending-up"
  | "file-up"
  | "newspaper"
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
  { href: "/nouvelles", label: "Nouvelles", icon: "newspaper" },
  { href: "/revenus", label: "Revenus de placement", icon: "trending-up" },
  { href: "/transactions", label: "Transactions", icon: "arrow-left-right" },
  { href: "/imports", label: "Administration", icon: "file-up" },
  { href: "/insights", label: "Discuter avec Pinocchio", icon: "sparkles" },
];
