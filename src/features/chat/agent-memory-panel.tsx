"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type MemoryEntry = {
  id: string;
  title: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export function AgentMemoryPanel({ className }: { className?: string }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/chat/agent-memory");
    if (!res.ok) {
      setError("Impossible de charger la mémoire.");
      return;
    }
    const data = (await res.json()) as { entries: MemoryEntry[] };
    setEntries(data.entries);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/chat/agent-memory");
        if (!res.ok) {
          if (!cancelled) {
            setError("Impossible de charger la mémoire.");
          }
          return;
        }
        const data = (await res.json()) as { entries: MemoryEntry[] };
        if (!cancelled) {
          setEntries(data.entries);
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

  async function submitNew(event: FormEvent) {
    event.preventDefault();
    if (!newContent.trim()) {
      return;
    }
    setSavingNew(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/agent-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim() || undefined,
          content: newContent.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Création impossible.");
      }
      setNewTitle("");
      setNewContent("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setSavingNew(false);
    }
  }

  function startEdit(entry: MemoryEntry) {
    setEditingId(entry.id);
    setEditTitle(entry.title ?? "");
    setEditContent(entry.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
  }

  async function saveEdit() {
    if (!editingId || !editContent.trim()) {
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/agent-memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          content: editContent.trim(),
          title: editTitle.trim() ? editTitle.trim() : null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Mise à jour impossible.");
      }
      cancelEdit();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeEntry(id: string) {
    if (!confirm("Supprimer cette entrée de la mémoire ?")) {
      return;
    }
    setError(null);
    const res = await fetch(`/api/chat/agent-memory?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError("Suppression impossible.");
      return;
    }
    if (editingId === id) {
      cancelEdit();
    }
    await refresh();
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>Mémoire de Berta</CardTitle>
        <p className="text-xs leading-5 text-slate-500">
          Ces faits sont injectés dans le prompt à chaque message. Tu peux aussi dire à Berta de
          mémoriser ou d&apos;oublier quelque chose dans le chat.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>
        ) : null}

        <form onSubmit={(e) => void submitNew(e)} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-800">Ajouter</p>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Titre court (optionnel)"
            className="text-sm"
          />
          <Textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Ce que Berta doit retenir…"
            className="min-h-20 text-sm"
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={savingNew || !newContent.trim()} className="text-sm">
              {savingNew ? "Enregistrement…" : "Ajouter"}
            </Button>
          </div>
        </form>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">
            Entrées {loading ? "" : `(${entries.length})`}
          </p>
          {loading ? (
            <p className="text-xs text-slate-500">Chargement…</p>
          ) : entries.length === 0 ? (
            <p className="text-xs text-slate-500">Aucune entrée pour l&apos;instant.</p>
          ) : (
            <ul className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800"
                >
                  {editingId === entry.id ? (
                    <div className="space-y-2">
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Titre"
                        className="text-sm"
                      />
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-24 text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={() => void saveEdit()} disabled={savingEdit} className="text-sm">
                          {savingEdit ? "Enregistrement…" : "Enregistrer"}
                        </Button>
                        <Button type="button" variant="secondary" onClick={cancelEdit} className="text-sm">
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-mono text-slate-400">{entry.id}</p>
                      {entry.title ? (
                        <p className="mt-1 font-medium text-slate-900">{entry.title}</p>
                      ) : null}
                      <p className="mt-1 whitespace-pre-wrap text-slate-700">{entry.content}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" onClick={() => startEdit(entry)} className="text-sm">
                          Modifier
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="text-sm text-red-700 hover:bg-red-50"
                          onClick={() => void removeEntry(entry.id)}
                        >
                          Supprimer
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
