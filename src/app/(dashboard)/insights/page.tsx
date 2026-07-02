import { BertaWorkspace } from "@/features/chat/berta-workspace";
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
        <h2 className="text-2xl font-semibold text-slate-950">Discuter avec Berta</h2>
        <p className="mt-1 text-sm text-slate-500">
          Berta s&apos;appuie sur les fonctions métier du portefeuille ; tu peux fixer des règles
          permanentes (onglet « Règles » en mobile, panneau de droite sur grand écran).
        </p>
      </section>
      <BertaWorkspace
        sessionId={PORTFOLIO_INSIGHTS_CHAT_SESSION_ID}
        initialMessages={initialMessages}
      />
    </div>
  );
}
