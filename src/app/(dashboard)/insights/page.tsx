import { ChatPanel } from "@/features/chat/chat-panel";

export default function InsightsPage() {
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
      <ChatPanel />
    </div>
  );
}
