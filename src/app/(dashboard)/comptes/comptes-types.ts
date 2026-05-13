import type { getAccountsWithStats } from "@/features/portfolio/queries";

export type AccountWithStats = Awaited<ReturnType<typeof getAccountsWithStats>>[number];
