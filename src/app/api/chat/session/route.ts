import { NextResponse } from "next/server";
import { PORTFOLIO_INSIGHTS_CHAT_SESSION_ID } from "@/features/chat/insights-chat-config";
import { prisma } from "@/lib/db/prisma";

/** Vide la conversation Insights (messages + contexte côté client au prochain état vide). */
export async function DELETE() {
  await prisma.chatMessage.deleteMany({
    where: { sessionId: PORTFOLIO_INSIGHTS_CHAT_SESSION_ID },
  });
  return NextResponse.json({ ok: true });
}
