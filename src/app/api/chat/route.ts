import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import {
  getConcentrationRisk,
  getCurrencyExposure,
  getLatestImportInfo,
  getPortfolioSummary,
  getTopPositions,
  simulateRebalance,
} from "@/features/portfolio/queries";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response("OPENAI_API_KEY est manquant.", { status: 503 });
  }

  const body = (await request.json()) as {
    id?: string;
    messages: UIMessage[];
  };
  const messages = body.messages ?? [];
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const sessionId = await ensureChatSession(body.id);

  if (latestUserMessage) {
    await persistMessage(sessionId, "user", extractText(latestUserMessage));
  }

  const result = streamText({
    model: openai("gpt-4.1-mini"),
    system:
      "Tu es DisnatIA, un assistant sobre pour analyser un portefeuille Disnat canadien. " +
      "Réponds en français, avec chiffres concrets. Utilise les outils portefeuille avant de donner une réponse factuelle. " +
      "Ne donne pas de conseil financier personnalisé; présente les risques, hypothèses et limites.",
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    tools: {
      getPortfolioSummary: {
        description: "Résumé global du dernier portefeuille importé.",
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
        description: "Analyse les risques de concentration du portefeuille.",
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
    },
    onFinish: async (event) => {
      await persistMessage(sessionId, "assistant", event.text, {
        toolCalls: event.toolCalls.map((toolCall) => toolCall.toolName),
      });
    },
  });

  return result.toUIMessageStreamResponse();
}

async function ensureChatSession(preferredId?: string) {
  if (preferredId) {
    const existing = await prisma.chatSession.findUnique({
      where: { id: preferredId },
    });
    if (existing) {
      return existing.id;
    }
  }

  const session = await prisma.chatSession.create({
    data: {
      id: preferredId,
      title: "Conversation portefeuille",
    },
  });

  return session.id;
}

async function persistMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  metadataJson?: Record<string, unknown>,
) {
  if (!content.trim()) {
    return;
  }

  await prisma.chatMessage.create({
    data: {
      sessionId,
      role,
      content,
      metadataJson: metadataJson as Prisma.InputJsonValue | undefined,
    },
  });
}

function extractText(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}
