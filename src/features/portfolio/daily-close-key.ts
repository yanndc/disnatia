export type DailyCloseKey = `${string}|${string}|${string}`;

export function dailyCloseKey(
  ticker: string,
  currency: string,
  date: string,
): DailyCloseKey {
  return `${ticker.toUpperCase()}|${currency.toUpperCase()}|${date}`;
}

export function parseIsoDateLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Colonnes Prisma `@db.Date` (minuit UTC) → ISO calendrier sans décalage fuseau. */
export function isoDateFromDbDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
