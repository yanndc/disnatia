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
          Questions en langage naturel branchées sur les fonctions métier du
          portefeuille.
        </p>
      </section>
      <ChatPanel
        sessionId={PORTFOLIO_INSIGHTS_CHAT_SESSION_ID}
        initialMessages={initialMessages}
      />
    </div>
  );
}
