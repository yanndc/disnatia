"use client";

import { FormEvent, useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  estimateInsightsChatPromptTokens,
  INSIGHTS_CHAT_CONTEXT_LIMIT_TOKENS,
  INSIGHTS_CHAT_MODEL_LABEL,
} from "@/features/chat/insights-chat-config";
import { cn } from "@/lib/utils";

export function ChatPanel({
  sessionId,
  initialMessages,
}: {
  sessionId: string;
  initialMessages: UIMessage[];
}) {
  const [input, setInput] = useState("");
  const [resetting, setResetting] = useState(false);
  const { messages, sendMessage, status, error, setMessages } = useChat({
    id: sessionId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const tokenEstimate = useMemo(() => estimateInsightsChatPromptTokens(messages), [messages]);
  const contextPct = Math.min(
    100,
    Math.round((tokenEstimate.total / INSIGHTS_CHAT_CONTEXT_LIMIT_TOKENS) * 100),
  );
  const busy = status !== "ready" && status !== "error";

  async function resetConversation() {
    if (
      !confirm(
        "Vider la conversation avec Berta ? Les messages seront supprimés ; les règles permanentes (panneau à droite) restent en place.",
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      const res = await fetch("/api/chat/session", { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Échec de la réinitialisation.");
      }
      setMessages([]);
      setInput("");
    } catch {
      alert("Impossible de réinitialiser la conversation. Réessaie plus tard.");
    } finally {
      setResetting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text) {
      return;
    }
    setInput("");
    await sendMessage({ text });
  }

  return (
    <Card className="min-h-[680px] w-full">
      <CardHeader>
        <CardTitle>Berta</CardTitle>
        <p className="text-xs text-slate-500">
          Assistante portefeuille — les instructions durables sont dans « Règles de Berta » sur cette page.
        </p>
      </CardHeader>
      <CardContent className="flex min-h-[600px] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-3xl rounded-lg border px-4 py-3 text-sm leading-6",
                message.role === "user"
                  ? "ml-auto border-slate-900 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-800",
              )}
            >
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  return (
                    <p key={index} className="whitespace-pre-wrap">
                      {part.text}
                    </p>
                  );
                }

                if (part.type.startsWith("tool-")) {
                  return (
                    <p key={index} className="text-xs text-slate-500">
                      Fonction portefeuille appelée.
                    </p>
                  );
                }

                return null;
              })}
            </div>
          ))}
          {messages.length === 0 ? (
            <div className="flex h-full min-h-80 items-center justify-center text-center">
              <div>
                <p className="text-lg font-semibold text-slate-950">
                  Discute avec Berta de ton portefeuille
                </p>
                <p className="mt-2 max-w-md text-sm text-slate-500">
                  Berta appelle les fonctions serveur pour lire le dernier import, l&apos;exposition, la
                  concentration et simuler un rééquilibrage.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error.message}</p>
        ) : null}

        <form onSubmit={submit} className="mt-4 space-y-3">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ex: Quelles sont mes plus grosses positions et mes risques de concentration?"
          />
          <div className="flex items-center justify-end">
            <Button disabled={busy}>Envoyer</Button>
          </div>
        </form>

        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1 text-xs text-slate-600">
              <p>
                <span className="font-medium text-slate-800">Modèle :</span>{" "}
                {INSIGHTS_CHAT_MODEL_LABEL}
              </p>
              <p>
                <span className="font-medium text-slate-800">Contexte (estimation) :</span>{" "}
                ~{tokenEstimate.total.toLocaleString("fr-CA")} tokens affichés (messages ~
                {tokenEstimate.messageTokens.toLocaleString("fr-CA")} + prompt système ~
                {tokenEstimate.systemTokens.toLocaleString("fr-CA")}) sur un plafond indicatif ~
                {INSIGHTS_CHAT_CONTEXT_LIMIT_TOKENS.toLocaleString("fr-CA")} tokens ({contextPct}%)
              </p>
              <p className="text-slate-500">
                La requête réelle inclut aussi les définitions d&apos;outils et les résultats
                d&apos;appels ; l&apos;estimation est donc en général <em>inférieure</em> au total
                facturé. Les règles personnalisées ne sont pas comptées ici.
              </p>
              <p>
                <span className="font-medium text-slate-800">Statut :</span>{" "}
                {status === "ready" ? "prêt" : status}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              disabled={busy || resetting}
              onClick={() => void resetConversation()}
            >
              {resetting ? "Réinitialisation…" : "Nouvelle conversation"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
