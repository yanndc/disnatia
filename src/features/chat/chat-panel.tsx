"use client";

import { FormEvent, useState } from "react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const suggestedQuestions = [
  "Quelle est ma valeur totale?",
  "Quelle part est en USD?",
  "Quelles sont mes plus grosses positions?",
  "Quels titres sont trop concentrés?",
  "Si je déplace 2000 CAD de BBD.B vers XEQT, qu'est-ce que ça change?",
];

export function ChatPanel() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

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
          <CardTitle>Chat IA portefeuille</CardTitle>
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
                    Pose une question sur ton portefeuille
                  </p>
                  <p className="mt-2 max-w-md text-sm text-slate-500">
                    Le chat utilise les fonctions serveur pour lire le dernier import,
                    calculer l'exposition, la concentration et simuler un rééquilibrage.
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

          <form onSubmit={submit} className="mt-4 space-y-3">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ex: Quelles sont mes plus grosses positions et mes risques de concentration?"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Statut: {status === "ready" ? "prêt" : status}
              </p>
              <Button disabled={status !== "ready" && status !== "error"}>
                Envoyer
              </Button>
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
