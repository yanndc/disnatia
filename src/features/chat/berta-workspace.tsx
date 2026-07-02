"use client";

import { FormEvent, useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { Gauge, MessageSquare, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { BertaRulesPanel } from "@/features/chat/berta-rules-panel";
import {
  estimateInsightsChatPromptTokens,
  INSIGHTS_CHAT_CONTEXT_LIMIT_TOKENS,
  INSIGHTS_CHAT_MODEL_LABEL,
} from "@/features/chat/insights-chat-config";
import { cn } from "@/lib/utils";

type MobileTab = "chat" | "rules" | "infos";

const MOBILE_TABS: { id: MobileTab; label: string; Icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", Icon: MessageSquare },
  { id: "rules", label: "Règles", Icon: SlidersHorizontal },
  { id: "infos", label: "Infos", Icon: Gauge },
];

export function BertaWorkspace({
  sessionId,
  initialMessages,
}: {
  sessionId: string;
  initialMessages: UIMessage[];
}) {
  const [input, setInput] = useState("");
  const [resetting, setResetting] = useState(false);
  const [tab, setTab] = useState<MobileTab>("chat");
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
        "Vider la conversation avec Berta ? Les messages seront supprimés ; les règles permanentes (onglet « Règles ») restent en place.",
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
    <div>
      {/* Barre d'onglets — mobile / tablette uniquement */}
      <div className="sticky top-14 z-30 -mx-5 mb-4 border-b border-slate-200 bg-slate-50/95 px-5 backdrop-blur xl:hidden">
        <div className="flex gap-1">
          {MOBILE_TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                tab === id
                  ? "border-slate-950 text-slate-950"
                  : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="xl:grid xl:grid-cols-[1fr_360px] xl:gap-6">
        {/* Colonne gauche : conversation + infos */}
        <div className="space-y-6">
          {/* Onglet « Chat » */}
          <section className={cn(tab !== "chat" && "hidden", "xl:block")}>
            <Card className="flex w-full flex-col xl:min-h-[680px]">
              <CardHeader className="hidden xl:block">
                <CardTitle>Berta</CardTitle>
                <p className="text-xs text-slate-500">
                  Assistante portefeuille — les instructions durables sont dans « Règles de Berta »
                  sur cette page.
                </p>
              </CardHeader>
              <CardContent className="flex min-w-0 flex-col xl:min-h-[600px] xl:flex-1 xl:min-h-0">
                <div className="min-w-0 space-y-4 xl:flex-1 xl:overflow-y-auto">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "w-fit max-w-[85%] rounded-lg border px-4 py-3 text-sm leading-6 sm:max-w-3xl",
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
                    <div className="flex min-h-[50vh] items-center justify-center text-center xl:h-full xl:min-h-40">
                      <div>
                        <p className="text-lg font-semibold text-slate-950">
                          Discute avec Berta de ton portefeuille
                        </p>
                        <p className="mt-2 max-w-md text-sm text-slate-500">
                          Berta appelle les fonctions serveur pour lire le dernier import,
                          l&apos;exposition, la concentration et simuler un rééquilibrage.
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

                <form
                  onSubmit={submit}
                  className="sticky bottom-0 z-20 mt-4 flex shrink-0 items-end gap-2 border-t border-slate-200 bg-white pt-3 pb-[env(safe-area-inset-bottom)] xl:static xl:border-t-0 xl:bg-transparent xl:pt-0 xl:pb-0"
                >
                  <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder="Ex: Quelles sont mes plus grosses positions et mes risques de concentration?"
                    className="min-h-[44px] flex-1"
                  />
                  <Button disabled={busy} className="shrink-0">
                    Envoyer
                  </Button>
                </form>
              </CardContent>
            </Card>
          </section>

          {/* Onglet « Infos » */}
          <section className={cn(tab !== "infos" && "hidden", "xl:block")}>
            <Card>
              <CardHeader className="hidden xl:block">
                <CardTitle>Modèle &amp; contexte</CardTitle>
              </CardHeader>
              <CardContent className="pt-5 xl:pt-2">
                <div className="flex flex-col gap-3">
                  <div className="space-y-1 text-xs text-slate-600">
                    <p>
                      <span className="font-medium text-slate-800">Modèle :</span>{" "}
                      {INSIGHTS_CHAT_MODEL_LABEL}
                    </p>
                    <p>
                      <span className="font-medium text-slate-800">Statut :</span>{" "}
                      {status === "ready" ? "prêt" : status}
                    </p>
                    <p>
                      <span className="font-medium text-slate-800">Contexte (estimation) :</span>{" "}
                      ~{tokenEstimate.total.toLocaleString("fr-CA")} tokens (messages ~
                      {tokenEstimate.messageTokens.toLocaleString("fr-CA")} + prompt système ~
                      {tokenEstimate.systemTokens.toLocaleString("fr-CA")}) sur un plafond indicatif ~
                      {INSIGHTS_CHAT_CONTEXT_LIMIT_TOKENS.toLocaleString("fr-CA")} tokens ({contextPct}
                      %)
                    </p>
                    <p className="text-slate-500">
                      La requête réelle inclut aussi les définitions d&apos;outils et les résultats
                      d&apos;appels ; l&apos;estimation est donc en général <em>inférieure</em> au
                      total facturé. Les règles personnalisées ne sont pas comptées ici.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full shrink-0 xl:w-auto xl:self-start"
                    disabled={busy || resetting}
                    onClick={() => void resetConversation()}
                  >
                    {resetting ? "Réinitialisation…" : "Nouvelle conversation"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>

        {/* Colonne droite : règles permanentes */}
        <div className="xl:sticky xl:top-4 xl:self-start">
          <section className={cn(tab !== "rules" && "hidden", "xl:block")}>
            <BertaRulesPanel />
          </section>
        </div>
      </div>
    </div>
  );
}
