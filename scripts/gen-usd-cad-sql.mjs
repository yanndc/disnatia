/**
 * Génère un SQL d'upsert (ON CONFLICT) pour usd_cad_daily_rates.
 * Source : Banque du Canada (FXUSDCAD).
 * Usage : node scripts/gen-usd-cad-sql.mjs > /tmp/usd_cad.sql
 */
const HISTORY_START = "2023-12-27";
const TABLE_START = "2024-01-01";
const BOC_BASE =
  "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json";
const CHUNK = 400;
const SOURCE = "bank_of_canada";

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function parse(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function todayUtc() {
  return parse(fmt(new Date()));
}

function cmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function addDays(iso, n) {
  return fmt(new Date(parse(iso).getTime() + n * 86_400_000));
}

async function fetchChunk(start, end) {
  const url = `${BOC_BASE}?start_date=${start}&end_date=${end}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = await res.json();
  const out = {};
  for (const obs of body.observations ?? []) {
    const v = obs.FXUSDCAD?.v;
    if (v == null) continue;
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) out[obs.d] = n;
  }
  return out;
}

async function fetchRaw(start, end) {
  const merged = {};
  let cursor = start;
  while (cmp(cursor, end) <= 0) {
    const chunkEnd = cmp(addDays(cursor, CHUNK - 1), end) > 0 ? end : addDays(cursor, CHUNK - 1);
    Object.assign(merged, await fetchChunk(cursor, chunkEnd));
    if (cmp(chunkEnd, end) >= 0) break;
    cursor = addDays(chunkEnd, 1);
  }
  return merged;
}

function buildSeries(raw, fromIso, toIso) {
  const sortedKeys = Object.keys(raw).sort();
  let last = null;
  for (const k of sortedKeys) {
    if (k < fromIso) last = raw[k];
  }
  if (last === null) {
    const first = sortedKeys.find((k) => k >= fromIso);
    if (first) last = raw[first];
  }
  if (last === null) throw new Error("Pas de taux pour amorcer la série.");

  const end = parse(toIso);
  const rows = [];
  for (
    let d = parse(fromIso);
    d.getTime() <= end.getTime();
    d = new Date(d.getTime() + 86_400_000)
  ) {
    const key = fmt(d);
    if (raw[key] != null) last = raw[key];
    rows.push({ rateDate: key, usdToCad: last });
  }
  return rows;
}

function escLit(s) {
  return s.replaceAll("'", "''");
}

const end = fmt(todayUtc());
const raw = await fetchRaw(HISTORY_START, end);
const series = buildSeries(raw, TABLE_START, end);

const lines = [
  "INSERT INTO usd_cad_daily_rates (id, rate_date, usd_to_cad, source, created_at, updated_at)",
  "VALUES",
];

for (let i = 0; i < series.length; i += 1) {
  const r = series[i];
  const comma = i + 1 < series.length ? "," : "";
  lines.push(
    `(gen_random_uuid()::text, '${escLit(r.rateDate)}'::date, ${r.usdToCad}, '${SOURCE}', NOW(), NOW())${comma}`,
  );
}

lines.push(
  "ON CONFLICT (rate_date) DO UPDATE SET",
  "usd_to_cad = EXCLUDED.usd_to_cad,",
  "source = EXCLUDED.source,",
  "updated_at = NOW();",
);

console.log(lines.join("\n"));
