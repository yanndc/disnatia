/**
 * Génère un SQL d'upsert (ON CONFLICT) pour usd_cad_daily_rates.
 * Usage : node scripts/gen-usd-cad-sql.mjs > /tmp/usd_cad.sql
 */
const HISTORY_START = "2023-12-27";
const TABLE_START = "2024-01-01";

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function parse(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}

function todayUtc() {
  return parse(fmt(new Date()));
}

async function fetchRaw(start, end) {
  const url = `https://api.frankfurter.app/${start}..${end}?from=USD&to=CAD`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = await res.json();
  const out = {};
  for (const [day, pair] of Object.entries(body.rates ?? {})) {
    if (typeof pair?.CAD === "number") out[day] = pair.CAD;
  }
  return out;
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
    d = new Date(d.getTime() + 86400000)
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
    `(gen_random_uuid()::text, '${escLit(r.rateDate)}'::date, ${r.usdToCad}, 'frankfurter', NOW(), NOW())${comma}`,
  );
}

lines.push(
  "ON CONFLICT (rate_date) DO UPDATE SET",
  "usd_to_cad = EXCLUDED.usd_to_cad,",
  "source = EXCLUDED.source,",
  "updated_at = NOW();",
);

console.log(lines.join("\n"));
