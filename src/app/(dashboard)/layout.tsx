import { BackgroundQuotesRefresh } from "@/features/portfolio/background-quotes-refresh";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardShell>
      <BackgroundQuotesRefresh />
      {children}
    </DashboardShell>
  );
}
