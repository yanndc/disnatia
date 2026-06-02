import { subDays } from "date-fns";

const TORONTO_TZ = "America/Toronto";

/** Heures régulières TSX / NYSE en heure de Toronto (9 h 30 – 16 h). */
const SESSION_OPEN_MINUTES = 9 * 60 + 30;
const SESSION_CLOSE_MINUTES = 16 * 60;

export function isoDateInToronto(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Date calendrier ISO ancrée à midi UTC (évite les décalages fuseau sur @db.Date et itérations). */
export function parseIsoCalendarDate(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

function isoDateFromUtcParts(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function subtractCalendarDays(iso: string, days: number): string {
  const d = parseIsoCalendarDate(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return isoDateFromUtcParts(d);
}

export function addCalendarDays(iso: string, days: number): string {
  const d = parseIsoCalendarDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDateFromUtcParts(d);
}

/** Premier jour ouvré (lun–ven) à partir de `fromIso` inclus. */
export function firstTradingDayOnOrAfterIso(fromIso: string): string {
  let cursor = fromIso;
  while (!isTradingDayIso(cursor)) {
    cursor = addCalendarDays(cursor, 1);
  }
  return cursor;
}

/** Jour ouvré suivant strictement après `fromIso`. */
export function nextTradingDayIso(fromIso: string): string {
  let cursor = fromIso;
  do {
    cursor = addCalendarDays(cursor, 1);
  } while (!isTradingDayIso(cursor));
  return cursor;
}

/**
 * Dernière date acceptable pour la 1re séance d'une période :
 * 1re séance ouvrée attendue, ou la suivante (jour férié sur la séance attendue).
 */
export function latestAllowedFirstSessionDate(periodStartIso: string): string {
  return nextTradingDayIso(firstTradingDayOnOrAfterIso(periodStartIso));
}

function torontoClock(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);

  const dayByWeekday: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    day: dayByWeekday[weekday] ?? 0,
    minutes: hour * 60 + minute,
  };
}

/** Jour ouvré lun–ven pour une date ISO (weekday évalué à Toronto). */
export function isTradingDayIso(iso: string): boolean {
  const wd = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TZ,
    weekday: "short",
  }).format(parseIsoCalendarDate(iso));
  return wd !== "Sat" && wd !== "Sun";
}

/** Jour ouvré actions (lun–ven, heure de Toronto) — pour un instant « maintenant ». */
export function isTradingDay(now: Date): boolean {
  const { day } = torontoClock(now);
  return day >= 1 && day <= 5;
}

/** Jour ouvré pour une date ISO `YYYY-MM-DD` (calendrier Toronto). */
export function isTradingDayDate(isoDate: string): boolean {
  return isTradingDayIso(isoDate);
}

/** Séance actions en cours (lun–ven, 9 h 30–16 h, heure de Toronto). */
export function isEquityMarketSessionOpen(now = new Date()): boolean {
  const { day, minutes } = torontoClock(now);
  if (day === 0 || day === 6) return false;
  return minutes >= SESSION_OPEN_MINUTES && minutes < SESSION_CLOSE_MINUTES;
}

/** Jour ouvré précédent (n séances en arrière), en ISO Toronto. */
export function previousTradingDayIso(fromIso: string, steps = 1): string {
  let cursor = fromIso;
  for (let i = 0; i < steps; i++) {
    do {
      cursor = subtractCalendarDays(cursor, 1);
    } while (!isTradingDayIso(cursor));
  }
  return cursor;
}

/**
 * Séance de référence pour le P&L « jour » :
 * séance en cours, ou dernière séance complétée (week-end / avant l'ouverture / après la clôture).
 */
export function referenceTradingSessionDayIso(now = new Date()): string {
  const today = isoDateInToronto(now);
  if (!isTradingDayIso(today)) {
    return previousTradingDayIso(today, 1);
  }
  const { minutes } = torontoClock(now);
  if (minutes < SESSION_OPEN_MINUTES) {
    return previousTradingDayIso(today, 1);
  }
  return today;
}

/**
 * Date de la clôture précédente (previous close) pour la variation du jour :
 * dernier jour ouvré avant aujourd’hui (Toronto), comme Disnat / Yahoo — pas « séance de référence − 1 »
 * (sinon lundi avant l’ouverture → jeudi au lieu de vendredi, ~3 jours d’écart).
 */
export function priorSessionDateIso(now = new Date()): string {
  return previousTradingDayIso(isoDateInToronto(now), 1);
}

/** Jour ouvré précédent (n séances en arrière). */
export function previousTradingDay(from: Date, steps = 1): Date {
  return parseIsoCalendarDate(previousTradingDayIso(isoDateInToronto(from), steps));
}

export function referenceTradingSessionDay(now = new Date()): Date {
  return parseIsoCalendarDate(referenceTradingSessionDayIso(now));
}

/** Séance complétée immédiatement avant la séance de référence du jour. */
export function yesterdayTradingSessionDay(now = new Date()): Date {
  return parseIsoCalendarDate(priorSessionDateIso(now));
}

export function resolveDayPeriodLabels(now = new Date()): {
  label: string;
  shortLabel: string;
} {
  if (isEquityMarketSessionOpen(now)) {
    return { label: "Aujourd'hui", shortLabel: "Jour" };
  }
  return { label: "Dernière séance", shortLabel: "Séance" };
}
