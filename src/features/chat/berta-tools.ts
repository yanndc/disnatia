import { z } from "zod";
import {
  getConcentrationRisk,
  getCurrencyExposure,
  getLatestImportInfo,
  getPortfolioSummary,
  getTopPositions,
  simulateRebalance,
} from "@/features/portfolio/queries";
import {
  fetchLiveMarketQuotesForChat,
  searchWebForBerta,
  type FetchLiveMarketQuotesInput,
} from "@/features/chat/berta-external-sources";

/**
 * Outils d'analyse portefeuille de Berta, partagés entre le chat (/api/chat)
 * et l'analyse automatique du rapport de fin de journée.
 */
export function createBertaTools() {
  return {
    getPortfolioSummary: {
      description:
        "Résumé du portefeuille : valeur titres avec cours stockés (Yahoo) si disponibles + encaisse du fichier; écart vs total fichier; variation entre imports = totaux Disnat fichier.",
      inputSchema: z.object({}),
      execute: async () => getPortfolioSummary(),
    },
    getTopPositions: {
      description: "Retourne les plus grosses positions du portefeuille.",
      inputSchema: z.object({ limit: z.number().min(1).max(20).optional() }),
      execute: async ({ limit }: { limit?: number }) => getTopPositions(limit ?? 5),
    },
    getCurrencyExposure: {
      description: "Retourne l'exposition par devise CAD/USD/autres.",
      inputSchema: z.object({}),
      execute: async () => getCurrencyExposure(),
    },
    getConcentrationRisk: {
      description:
        "Analyse les risques de concentration du portefeuille. Les poids sont calculés sur le total des placements Disnat (tous comptes combinés, titres + encaisse), excluant maison et comptes externes.",
      inputSchema: z.object({}),
      execute: async () => getConcentrationRisk(),
    },
    getLatestImportInfo: {
      description: "Retourne les informations du dernier import Disnat.",
      inputSchema: z.object({}),
      execute: async () => getLatestImportInfo(),
    },
    simulateRebalance: {
      description:
        "Simule le déplacement d'un montant CAD d'un ticker vers un autre.",
      inputSchema: z.object({
        fromTicker: z.string(),
        toTicker: z.string(),
        amountCad: z.number().positive(),
      }),
      execute: async (input: {
        fromTicker: string;
        toTicker: string;
        amountCad: number;
      }) => simulateRebalance(input),
    },
    fetchLiveMarketQuotes: {
      description:
        "Cours de marché en direct (hors import Disnat) pour un ou plusieurs symboles. Utilise soit des symboles Yahoo (AAPL, MSFT, XEG.TO), soit ticker Disnat + devise (ex. BCE-C + CAD). À appeler avant toute affirmation sur un titre qui n'est pas couvert par les outils portefeuille.",
      inputSchema: z
        .object({
          yahooSymbols: z.array(z.string().min(1)).max(20).optional(),
          disnatTickers: z
            .array(
              z.object({
                ticker: z.string().min(1),
                currency: z
                  .string()
                  .min(1)
                  .describe("Devise de la ligne Disnat, souvent CAD ou USD"),
              }),
            )
            .max(20)
            .optional(),
        })
        .refine(
          (v) => (v.yahooSymbols?.length ?? 0) + (v.disnatTickers?.length ?? 0) > 0,
          { message: "Fournir yahooSymbols et/ou disnatTickers." },
        ),
      execute: async (input: FetchLiveMarketQuotesInput) =>
        fetchLiveMarketQuotesForChat(input),
    },
    searchWebSources: {
      description:
        "Recherche web pour actualités, contexte macro ou entreprise (résultats avec titres, extraits, URL). topic=finance pour cours/marchés, news pour fil d'actualité; general sinon. Si la réponse indique que la clé API manque, explique-le brièvement.",
      inputSchema: z.object({
        query: z.string().min(3).max(400),
        topic: z.enum(["general", "news", "finance"]).optional(),
      }),
      execute: async (input: { query: string; topic?: "general" | "news" | "finance" }) =>
        searchWebForBerta(input.query, input.topic ?? "general"),
    },
  };
}
