import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from "ai";
import {
  getBertaRulesBody,
  mergeBertaRulesIntoSystemPrompt,
} from "@/features/chat/berta-agent-rules";
import { createBertaTools } from "@/features/chat/berta-tools";
import {
  INSIGHTS_CHAT_MODEL_ID,
  INSIGHTS_CHAT_SYSTEM_PROMPT,
} from "@/features/chat/insights-chat-config";
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

  const customRules = await getBertaRulesBody();
  const systemPrompt = mergeBertaRulesIntoSystemPrompt(INSIGHTS_CHAT_SYSTEM_PROMPT, customRules);

  const result = streamText({
    model: openai(INSIGHTS_CHAT_MODEL_ID),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(12),
    tools: createBertaTools(),
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
      title: "Berta — portefeuille",
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
