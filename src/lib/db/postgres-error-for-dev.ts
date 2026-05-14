/**
 * Affiche la cause réelle des échecs Prisma/pg en dev (sans mots de passe dans l’URI).
 */
export function formatPostgresErrorForDev(error: unknown): string | null {
  if (process.env.NODE_ENV === "production") return null;

  const chunks: string[] = [];
  let cur: unknown = error;
  for (let i = 0; i < 10 && cur; i++) {
    if (cur instanceof Error && cur.message.trim()) {
      chunks.push(sanitizePostgresUrls(cur.message.trim()));
    }
    cur = cur instanceof Error ? cur.cause : undefined;
  }

  const joined = chunks.join(" → ");
  if (!joined) return null;
  return joined.length > 1800 ? `${joined.slice(0, 1800)}…` : joined;
}

function sanitizePostgresUrls(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, "postgresql://…");
}
