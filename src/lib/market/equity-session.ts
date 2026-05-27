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

function parseIsoDateLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
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

/** Jour ouvré actions (lun–ven, heure de Toronto). */
export function isTradingDay(now: Date): boolean {
  const { day } = torontoClock(now);
  return day >= 1 && day <= 5;
}

/** Jour ouvré pour une date ISO `YYYY-MM-DD` (interprétée en calendrier local). */
export function isTradingDayDate(isoDate: string): boolean {
  return isTradingDay(parseIsoDateLocal(isoDate));
}

const EOD_REPORT_WINDOW_START_MINUTES = 17 * 60 + 15;
const EOD_REPORT_WINDOW_END_MINUTES = 19 * 60;

/**
 * Fenêtre d'envoi du rapport EOD : jour ouvré Toronto, entre 17 h 15 et 19 h
 * (après clôture 16 h, marge pour cotations / clôtures).
 */
export function shouldSendEodReport(now = new Date()): boolean {
  if (!isTradingDay(now)) return false;
  const { minutes } = torontoClock(now);
  return (
    minutes >= EOD_REPORT_WINDOW_START_MINUTES &&
    minutes < EOD_REPORT_WINDOW_END_MINUTES
  );
}

/** Séance actions en cours (lun–ven, 9 h 30–16 h, heure de Toronto). */
export function isEquityMarketSessionOpen(now = new Date()): boolean {
  const { day, minutes } = torontoClock(now);
  if (day === 0 || day === 6) return false;
  return minutes >= SESSION_OPEN_MINUTES && minutes < SESSION_CLOSE_MINUTES;
}

/** Jour ouvré précédent (n séances en arrière). */
export function previousTradingDay(from: Date, steps = 1): Date {
  let cursor = parseIsoDateLocal(isoDateInToronto(from));
  for (let i = 0; i < steps; i++) {
    do {
      cursor = subDays(cursor, 1);
    } while (!isTradingDay(cursor));
  }
  return cursor;
}

/**
 * Séance de référence pour le P&L « jour » :
 * séance en cours, ou dernière séance complétée (week-end / avant l'ouverture / après la clôture).
 */
export function referenceTradingSessionDay(now = new Date()): Date {
  const today = parseIsoDateLocal(isoDateInToronto(now));
  if (!isTradingDay(today)) {
    return previousTradingDay(today, 1);
  }
  const { minutes } = torontoClock(now);
  if (minutes < SESSION_OPEN_MINUTES) {
    return previousTradingDay(today, 1);
  }
  return today;
}

/** Séance complétée immédiatement avant la séance de référence du jour. */
export function yesterdayTradingSessionDay(now = new Date()): Date {
  return previousTradingDay(referenceTradingSessionDay(now), 1);
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
