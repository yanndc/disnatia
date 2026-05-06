import { prisma } from "@/lib/db/prisma";

const CONTENT_MAX = 8_000;
const TITLE_MAX = 200;

export { CONTENT_MAX as AGENT_MEMORY_CONTENT_MAX, TITLE_MAX as AGENT_MEMORY_TITLE_MAX };

export function sanitizeAgentMemoryInput(content: string, title?: string | null) {
  const t = title?.trim().slice(0, TITLE_MAX) || null;
  const c = content.trim();
  if (!c) {
    throw new Error("Le contenu est requis.");
  }
  if (c.length > CONTENT_MAX) {
    throw new Error(`Le contenu dépasse ${CONTENT_MAX} caractères.`);
  }
  return { title: t, content: c };
}

export async function listAgentMemoryEntries() {
  return prisma.agentMemoryEntry.findMany({
    orderBy: [{ updatedAt: "desc" }],
  });
}

export async function formatAgentMemoryForSystemPrompt(): Promise<string> {
  const entries = await prisma.agentMemoryEntry.findMany({
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, title: true, content: true },
  });

  if (entries.length === 0) {
    return [
      "## Mémoire persistante",
      "Aucune entrée pour l'instant. Quand l'utilisateur te demande de mémoriser un fait durable, utilise l'outil `sauvegarderMemoire`.",
      "Il peut aussi ajouter ou modifier des entrées dans le panneau « Mémoire de Berta ».",
    ].join("\n");
  }

  const lines = entries.map((e) => {
    const label = e.title?.trim() ? `${e.title.trim()} — ` : "";
    return `- [${e.id}] ${label}${e.content.trim()}`;
  });

  return [
    "## Mémoire persistante",
    "Faits à prendre en compte dans tes réponses (enregistrés par l'utilisateur ou par toi).",
    "Les identifiants entre crochets servent à `supprimerMemoire` ou `mettreAJourMemoire`.",
    "L'utilisateur peut éditer cette liste dans l'interface.",
    ...lines,
  ].join("\n");
}
