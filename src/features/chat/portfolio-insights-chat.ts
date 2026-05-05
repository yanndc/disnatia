import type { UIMessage } from "ai";
import { prisma } from "@/lib/db/prisma";
import { PORTFOLIO_INSIGHTS_CHAT_SESSION_ID } from "./insights-chat-config";

export { PORTFOLIO_INSIGHTS_CHAT_SESSION_ID } from "./insights-chat-config";

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
