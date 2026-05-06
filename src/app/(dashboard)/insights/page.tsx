import { AgentMemoryPanel } from "@/features/chat/agent-memory-panel";
import { ChatPanel } from "@/features/chat/chat-panel";
import {
  loadPortfolioInsightsMessages,
  PORTFOLIO_INSIGHTS_CHAT_SESSION_ID,
} from "@/features/chat/portfolio-insights-chat";

export default async function InsightsPage() {
  const initialMessages = await loadPortfolioInsightsMessages();

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-slate-500">Analyse assistée</p>
        <h2 className="text-2xl font-semibold text-slate-950">Insights IA</h2>
        <p className="mt-1 text-sm text-slate-500">
          Berta répond en langage naturel via les fonctions métier du portefeuille, avec une mémoire
          persistante que tu peux éditer.
        </p>
      </section>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <ChatPanel
          sessionId={PORTFOLIO_INSIGHTS_CHAT_SESSION_ID}
          initialMessages={initialMessages}
        />
        <div className="space-y-6 xl:sticky xl:top-4 xl:self-start">
          <AgentMemoryPanel />
        </div>
      </div>
    </div>
  );
}
