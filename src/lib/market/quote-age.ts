/** Âge d'un fetch de cotation (affichage « il y a X min »). */
export function quoteAgeFromFetchedAt(
  fetchedAt: Date | string | null,
  nowMs = Date.now(),
): { ageMinutes: number; shortLabel: string } | null {
  if (!fetchedAt) return null;
  const date = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) return null;

  const ageMinutes = Math.max(0, Math.round((nowMs - date.getTime()) / 60_000));
  if (ageMinutes < 60) {
    return { ageMinutes, shortLabel: `${ageMinutes} min` };
  }
  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 48) {
    return { ageMinutes, shortLabel: `${ageHours} h` };
  }
  return { ageMinutes, shortLabel: `${Math.round(ageHours / 24)} j` };
}
