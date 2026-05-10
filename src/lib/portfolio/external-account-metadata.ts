import type { Prisma } from "@/generated/prisma/client";

/**
 * Métadonnées JSON pour les comptes externes : clés documentées côté app.
 * `sourceSummary` : profil / répartition copiés du site.
 * `transactionUpdateInstructions` : comment retrouver historique / transactions pour mise à jour.
 */
export function buildInitialMetadata(input: {
  sourceSummary?: string | null;
  transactionUpdateInstructions?: string | null;
}): Prisma.InputJsonValue | undefined {
  const m: Record<string, string> = {};
  if (input.sourceSummary?.trim()) m.sourceSummary = input.sourceSummary.trim();
  if (input.transactionUpdateInstructions?.trim()) {
    m.transactionUpdateInstructions = input.transactionUpdateInstructions.trim();
  }
  return Object.keys(m).length > 0 ? m : undefined;
}

/** Fusionne uniquement les champs fournis dans `patch` (clé absente = laisser tel quel). */
export function mergeExternalAccountMetadata(
  existing: unknown,
  patch: {
    sourceSummary?: string | null;
    transactionUpdateInstructions?: string | null;
  },
): Prisma.InputJsonValue | null {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  if ("sourceSummary" in patch) {
    const v = patch.sourceSummary;
    if (v === null || v === undefined || String(v).trim() === "") {
      delete base.sourceSummary;
    } else {
      base.sourceSummary = String(v).trim();
    }
  }
  if ("transactionUpdateInstructions" in patch) {
    const v = patch.transactionUpdateInstructions;
    if (v === null || v === undefined || String(v).trim() === "") {
      delete base.transactionUpdateInstructions;
    } else {
      base.transactionUpdateInstructions = String(v).trim();
    }
  }

  if (Object.keys(base).length === 0) return null;
  return base as Prisma.InputJsonValue;
}

export function readMetaString(metadata: unknown, key: string): string {
  if (
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    key in metadata &&
    typeof (metadata as Record<string, unknown>)[key] === "string"
  ) {
    return (metadata as Record<string, string>)[key];
  }
  return "";
}
