"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { BERTA_RULES_BODY_MAX } from "@/features/chat/berta-agent-rules-constants";
import { cn } from "@/lib/utils";

export function BertaRulesPanel({ className }: { className?: string }) {
  const [body, setBody] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/chat/berta-rules");
        if (!res.ok) {
          if (!cancelled) {
            setError("Impossible de charger les règles.");
          }
          return;
        }
        const data = (await res.json()) as { body: string; updatedAt: string };
        if (!cancelled) {
          setBody(data.body);
          setUpdatedAt(data.updatedAt);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/berta-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? "Enregistrement impossible.");
      }
      const data = (await res.json()) as { body: string; updatedAt: string };
      setBody(data.body);
      setUpdatedAt(data.updatedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>Règles de Berta</CardTitle>
        <p className="text-xs leading-5 text-slate-500">
          Texte permanent ajouté au prompt système (comme des « AI rules ») : ton, sujets à éviter,
          rappels métier, etc. Ce n&apos;est pas l&apos;historique du chat.
        </p>
        {updatedAt ? (
          <p className="text-xs text-slate-400">
            Dernière mise à jour :{" "}
            {new Date(updatedAt).toLocaleString("fr-CA", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="mb-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>
        ) : null}
        {loading ? (
          <p className="text-xs text-slate-500">Chargement…</p>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                "Ex. : Tutoyer l'utilisateur. Toujours rappeler que je suis en phase d'accumulation.\nÉviter le jargon sans l'expliquer."
              }
              className="min-h-[280px] font-mono text-sm"
              maxLength={BERTA_RULES_BODY_MAX}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {body.length.toLocaleString("fr-CA")} / {BERTA_RULES_BODY_MAX.toLocaleString("fr-CA")}{" "}
                caractères
              </span>
              <Button type="submit" disabled={saving} className="text-sm">
                {saving ? "Enregistrement…" : "Enregistrer les règles"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
