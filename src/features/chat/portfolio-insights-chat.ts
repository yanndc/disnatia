import type { UIMessage } from "ai";
import { prisma } from "@/lib/db/prisma";

/** Session unique (app mono-utilisateur V1) — alignée sur `body.id` envoyé par le transport du chat. */
export const PORTFOLIO_INSIGHTS_CHAT_SESSION_ID = "portfolio-insights-v1";

export async function loadPortfolioInsightsMessages(): Promise<UIMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      sessionId: PORTFOLIO_INSIGHTS_CHAT_SESSION_ID,
      role: { in: ["user", "assistant"] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
  });

  return rows.map((row) => ({
    id: row.id,
    role: row.role as "user" | "assistant",
    parts: [{ type: "text" as const, text: row.content }],
  }));
}
