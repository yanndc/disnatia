import type { UIMessage } from "ai";

/** Session unique mono-utilisateur (alignée sur `body.id` du transport). */
export const PORTFOLIO_INSIGHTS_CHAT_SESSION_ID = "portfolio-insights-v1";

/** Identifiant exact côté provider (AI SDK). */
export const INSIGHTS_CHAT_MODEL_ID = "gpt-4.1-mini" as const;

/** Libellé affiché dans l’UI. */
export const INSIGHTS_CHAT_MODEL_LABEL = "GPT-4.1 mini · OpenAI";

/**
 * Plafond de contexte indicatif (documentation OpenAI pour la famille 4.1 ; peut évoluer).
 */
export const INSIGHTS_CHAT_CONTEXT_LIMIT_TOKENS = 128_000;

export const INSIGHTS_CHAT_SYSTEM_PROMPT =
  "Tu es DisnatIA, un assistant sobre pour analyser un portefeuille Disnat canadien. " +
  "Réponds en français, avec chiffres concrets. Utilise les outils portefeuille avant de donner une réponse factuelle. " +
  "Les KPI et poids utilisent des cours rafraîchis (stockés) quand disponibles, avec encaisse toujours issue du dernier import; " +
  "la variation « vs import précédent » compare les totaux fichier Disnat, pas les cours du marché. " +
  "Ne donne pas de conseil financier personnalisé; présente les risques, hypothèses et limites.";

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
