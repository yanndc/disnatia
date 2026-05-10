import type { UIMessage } from "ai";

/** Session unique mono-utilisateur (alignée sur `body.id` du transport). */
export const PORTFOLIO_INSIGHTS_CHAT_SESSION_ID = "portfolio-insights-v1";

/** Identifiant exact côté provider (AI SDK). Plein format 4.1, plus solide que gpt-4.1-mini. */
export const INSIGHTS_CHAT_MODEL_ID = "gpt-4.1" as const;

/** Libellé affiché dans l’UI. */
export const INSIGHTS_CHAT_MODEL_LABEL = "GPT-4.1 · OpenAI";

/**
 * Plafond de contexte indicatif (GPT-4.1 : fenêtre large selon la doc ; ajuste si OpenAI change les limites).
 */
export const INSIGHTS_CHAT_CONTEXT_LIMIT_TOKENS = 1_000_000;

/** Prompt de base ; les règles personnalisées sont fusionnées côté serveur (`berta_agent_rules`). */
export const INSIGHTS_CHAT_SYSTEM_PROMPT =
  "Tu es Berta, une assistante sobre pour analyser un portefeuille de placements." +
  "Réponds en français, avec chiffres concrets. Utilise les outils portefeuille avant de donner une réponse factuelle sur le portefeuille importé. " +
  "Pour un titre ou un cours hors données importées, appelle fetchLiveMarketQuotes (symboles Yahoo ou ticker Disnat + devise). " +
  "Pour actualités ou contexte récent (macro, entreprise, marché), appelle searchWebSources et cite titres + domaines des sources retournées; " +
  "si l'outil signale l'absence de clé API, dis-le clairement sans inventer des articles. " +
  "Les KPI et poids utilisent des cours rafraîchis (stockés) quand disponibles, avec encaisse toujours issue du dernier import; " +
  "la variation « vs import précédent » compare les totaux fichier Disnat, pas les cours du marché. " +
  "Présente les risques, hypothèses et limites. " +
  "Les préférences durables de l'utilisateur figurent sous « Règles personnalisées » si présentes : respecte-les.";

/** ~4 caractères par token (heuristique, texte FR/EN mélangé). */
export function estimateInsightsChatPromptTokens(messages: UIMessage[]): {
  messageTokens: number;
  systemTokens: number;
  total: number;
} {
  const msgChars = messages.reduce(
    (acc, m) =>
      acc + m.parts.reduce((a, p) => a + (p.type === "text" ? p.text.length : 0), 0),
    0,
  );
  const messageTokens = Math.ceil(msgChars / 4);
  const systemTokens = Math.ceil(INSIGHTS_CHAT_SYSTEM_PROMPT.length / 4);
  return { messageTokens, systemTokens, total: messageTokens + systemTokens };
}
