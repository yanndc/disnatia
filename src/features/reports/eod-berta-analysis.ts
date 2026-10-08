import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";
import {
  getBertaRulesBody,
  mergeBertaRulesIntoSystemPrompt,
} from "@/features/chat/berta-agent-rules";
import { createBertaTools } from "@/features/chat/berta-tools";
import {
  INSIGHTS_CHAT_MODEL_ID,
  INSIGHTS_CHAT_SYSTEM_PROMPT,
} from "@/features/chat/insights-chat-config";
import { formatCurrency, formatPercent } from "@/lib/utils";
import type { EodReportData } from "./eod-report-types";

/** Note exigée par l'utilisateur quand l'analyse émet des recommandations d'action. */
export const EOD_BERTA_PRESCRIPTIVE_DISCLAIMER =
  "⚠️ Recommandations prescriptives : à contre-vérifier par Yann avant toute action.";

function buildEodAnalysisPrompt(data: EodReportData): string {
  const { gainCad, gainPct } = data.dayPeriod;
  const dayGain =
    gainCad === null
      ? "non disponible"
      : `${gainCad >= 0 ? "+" : ""}${formatCurrency(gainCad)}` +
        (gainPct === null ? "" : ` (${gainPct >= 0 ? "+" : ""}${formatPercent(gainPct)})`);

  const recentDays = data.dailyPerformance
    .map(
      (row) =>
        `${row.date}: ${row.gainCad >= 0 ? "+" : ""}${formatCurrency(row.gainCad)}` +
        (row.gainPct === null ? "" : ` (${row.gainPct >= 0 ? "+" : ""}${formatPercent(row.gainPct)})`),
    )
    .join(" · ");

  return (
    `Tu rédiges la section « Analyse Berta » du rapport de fin de journée (courriel automatique, ${data.sessionLabel} du ${data.sessionDate}).\n\n` +
    `Contexte déjà calculé côté serveur :\n` +
    `- Valeur totale portefeuille (titres + encaisse) : ${formatCurrency(data.disnatTotalValueCad)}\n` +
    `- Gain/perte de la séance : ${dayGain}\n` +
    (recentDays ? `- Séances récentes : ${recentDays}\n` : "") +
    `\nConsignes :\n` +
    `- Appelle les outils portefeuille (résumé, top positions, concentration, devises) avant toute affirmation factuelle; fetchLiveMarketQuotes et searchWebSources si utile pour expliquer les mouvements importants.\n` +
    `- Indique clairement si une tendance s'installe (titre, secteur, devise ou portefeuille global), en croisant la séance du jour et les séances récentes.\n` +
    `- Signale si des changements devraient être envisagés (rééquilibrage, concentration excessive, position à surveiller). Les recommandations concrètes sont permises et souhaitées.\n` +
    `- Si ta réponse contient au moins une recommandation prescriptive (acheter, vendre, rééquilibrer, alléger, renforcer, etc.), termine par cette note exacte sur sa propre ligne : « ${EOD_BERTA_PRESCRIPTIVE_DISCLAIMER} ». Sinon, n'ajoute pas cette note.\n` +
    `- Format : 3 à 6 puces courtes en français (lignes commençant par « - »), chiffres concrets à l'appui. Aucun titre, aucune salutation, aucune introduction.`
  );
}

/**
 * Génère l'analyse Berta du rapport EOD. Retourne null si la clé OpenAI est
 * absente, si l'appel échoue ou si la réponse est vide : le rapport est alors
 * envoyé sans la section, sans bloquer le job.
 */
export async function generateEodBertaAnalysis(
  data: EodReportData,
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return null;
  }

  try {
    const customRules = await getBertaRulesBody();
    const systemPrompt = mergeBertaRulesIntoSystemPrompt(
      INSIGHTS_CHAT_SYSTEM_PROMPT,
      customRules,
    );

    const { text } = await generateText({
      model: openai(INSIGHTS_CHAT_MODEL_ID),
      system: systemPrompt,
      prompt: buildEodAnalysisPrompt(data),
      tools: createBertaTools(),
      stopWhen: stepCountIs(10),
    });

    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (cause) {
    console.error(
      "[eod-report] Échec de l'analyse Berta (rapport envoyé sans elle) :",
      cause,
    );
    return null;
  }
}
