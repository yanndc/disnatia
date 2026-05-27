import {
  ArrowLeftRight,
  FileUp,
  Landmark,
  LayoutDashboard,
  Sparkles,
  Table2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { DashboardNavIconName } from "./dashboard-navigation";

export const dashboardNavIcons: Record<DashboardNavIconName, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  landmark: Landmark,
  table2: Table2,
  "arrow-left-right": ArrowLeftRight,
  "trending-up": TrendingUp,
  "file-up": FileUp,
  sparkles: Sparkles,
};
