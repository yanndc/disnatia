/**
 * Une ligne lisible pour l’UI (sans stack Turbopack / Prisma, sans mot de passe dans l’URI).
 */
export function formatPostgresConnectionErrorDetail(error: unknown): string | null {
  const raw = collectErrorMessages(error);
  if (!raw) return null;
  const compressed = compressPrismaNoise(sanitizePostgresUrls(raw));
  if (!compressed) return null;
  return compressed.length > 320 ? `${compressed.slice(0, 320)}…` : compressed;
}

function collectErrorMessages(error: unknown): string {
  const parts: string[] = [];
  let cur: unknown = error;
  for (let i = 0; i < 10 && cur; i++) {
    if (cur instanceof Error && cur.message.trim()) {
      parts.push(cur.message.trim());
    }
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return parts.join("\n");
}

/** Garde surtout la vraie cause (TLS, auth, réseau) et jette le bruit d’invocation Prisma. */
function compressPrismaNoise(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const scored = lines.filter(
    (l) =>
      !/__TURBOPACK__|Invalid `|invocation in|\[root-of-the-server\]|\.js:\d+:\d+/.test(
        l,
      ),
  );

  const prefer = scored.find((l) =>
    /Error opening|password authentication|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|certificate|self-signed|28P01|^P\d{4}\b/i.test(
      l,
    ),
  );
  if (prefer) return prefer;

  const short = scored.filter((l) => l.length < 220);
  if (short.length) return short[short.length - 1] ?? "";

  return scored.length ? scored[scored.length - 1]! : text.slice(0, 240);
}

function sanitizePostgresUrls(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, "postgresql://…");
}
