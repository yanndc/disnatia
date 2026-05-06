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

const suggestedQuestions = [
  "Quelle est ma valeur totale?",
  "Quelle part est en USD?",
  "Quelles sont mes plus grosses positions?",
  "Quels titres sont trop concentrés?",
  "Si je déplace 2000 CAD de BBD.B vers XEQT, qu'est-ce que ça change?",
];

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
        "Vider la conversation avec Berta ? Les messages seront supprimés ; la mémoire persistante (panneau à droite) est conservée.",
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
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="min-h-[680px]">
        <CardHeader>
          <CardTitle>Berta</CardTitle>
          <p className="text-xs text-slate-500">
            Assistante portefeuille — la mémoire persistante est dans le panneau « Mémoire de Berta » sur cette
            page.
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
                    Berta appelle les fonctions serveur pour lire le dernier import, l&apos;exposition,
                    la concentration et simuler un rééquilibrage. Demande-lui de mémoriser des faits pour
                    les prochains échanges.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {error ? (
            <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error.message}
            </p>
          ) : null}

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
                  {INSIGHTS_CHAT_CONTEXT_LIMIT_TOKENS.toLocaleString("fr-CA")} tokens ({contextPct}
                  %)
                </p>
                <p className="text-slate-500">
                  La requête réelle inclut aussi les définitions d&apos;outils et les résultats
                  d&apos;appels ; l&apos;estimation est donc en général <em>inférieure</em> au total
                  facturé.
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Questions utiles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {suggestedQuestions.map((question) => (
            <button
              key={question}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setInput(question)}
            >
              {question}
            </button>
          ))}
          <p className="pt-3 text-xs leading-5 text-slate-500">
            Les réponses sont analytiques et ne remplacent pas un conseil financier
            personnalisé.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
