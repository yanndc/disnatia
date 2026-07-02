import type { CSSProperties } from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { EodReportData } from "@/features/reports/eod-report-types";
import type {
  SessionTickerRow,
  SessionTickerView,
} from "@/features/portfolio/session-ticker-report-queries";
import { formatTorontoCalendarDate } from "@/lib/market/equity-session";
import { formatCurrency, formatCurrencyDetailed } from "@/lib/utils";

const palette = {
  pageBg: "#f0f4f8",
  cardBg: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  gain: "#059669",
  gainBg: "#ecfdf5",
  loss: "#e11d48",
  lossBg: "#fff1f2",
  neutral: "#475569",
  neutralBg: "#f8fafc",
  accent: "#2563eb",
  accentBg: "#eff6ff",
};

const styles = {
  body: {
    backgroundColor: palette.pageBg,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    margin: 0,
    padding: "24px 0",
  },
  container: {
    backgroundColor: palette.cardBg,
    border: `1px solid ${palette.border}`,
    borderRadius: "12px",
    margin: "0 auto",
    maxWidth: "720px",
    padding: "28px",
  },
  h1: { color: palette.text, fontSize: "24px", fontWeight: 700, margin: "0 0 6px" },
  muted: { color: palette.muted, fontSize: "13px", lineHeight: "20px", margin: 0 },
  sectionTitle: {
    color: palette.text,
    fontSize: "15px",
    fontWeight: 700,
    margin: "28px 0 10px",
  },
  sessionHeader: {
    backgroundColor: palette.accentBg,
    border: `1px solid #bfdbfe`,
    borderRadius: "10px",
    margin: "0 0 12px",
    padding: "12px 14px",
  },
  sessionHeaderTitle: {
    color: palette.text,
    fontSize: "14px",
    fontWeight: 700,
    margin: "0 0 2px",
  },
  sessionHeaderDate: { color: palette.muted, fontSize: "12px", margin: 0 },
  sessionTotal: {
    color: palette.text,
    fontSize: "16px",
    fontWeight: 700,
    margin: 0,
    textAlign: "right" as const,
  },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  th: {
    backgroundColor: palette.neutralBg,
    borderBottom: `1px solid ${palette.border}`,
    color: palette.muted,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    padding: "8px 10px",
    textAlign: "left" as const,
    textTransform: "uppercase" as const,
  },
  td: {
    borderBottom: `1px solid ${palette.border}`,
    color: palette.text,
    padding: "8px 10px",
    verticalAlign: "middle" as const,
  },
  tickerCol: { fontWeight: 600 },
  nameCol: { color: palette.muted, fontSize: "12px", maxWidth: "140px" },
  emptyHint: { color: palette.muted, fontSize: "12px", fontStyle: "italic" as const, margin: "8px 0" },
  footer: { color: "#94a3b8", fontSize: "12px", marginTop: "24px" },
};

function gainTextColor(value: number | null): string {
  if (value === null) return palette.muted;
  if (value > 0) return palette.gain;
  if (value < 0) return palette.loss;
  return palette.neutral;
}

function gainCellStyle(value: number | null): CSSProperties {
  const color = gainTextColor(value);
  const isGain = value !== null && value > 0;
  const isLoss = value !== null && value < 0;
  return {
    ...styles.td,
    color,
    fontWeight: 600,
    textAlign: "right",
    backgroundColor: isGain ? palette.gainBg : isLoss ? palette.lossBg : undefined,
  };
}

function formatSessionDate(iso: string): string {
  return formatTorontoCalendarDate(iso);
}

function TickerTable({
  title,
  rows,
  accentColor,
  accentBg,
  emptyHint,
}: {
  title: string;
  rows: SessionTickerRow[];
  accentColor: string;
  accentBg: string;
  emptyHint: string;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <Text
        style={{
          color: accentColor,
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.05em",
          margin: "0 0 8px",
          textTransform: "uppercase",
        }}
      >
        {title}
      </Text>
      {rows.length === 0 ? (
        <Text style={styles.emptyHint}>{emptyHint}</Text>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Symbole</th>
              <th style={styles.th}>Nom</th>
              <th style={{ ...styles.th, textAlign: "right" }}>Δ $</th>
              <th style={{ ...styles.th, textAlign: "right" }}>P&L jour</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.ticker}-${row.currency}`}>
                <td style={{ ...styles.td, ...styles.tickerCol }}>{row.ticker}</td>
                <td style={{ ...styles.td, ...styles.nameCol }}>{row.securityName}</td>
                <td style={gainCellStyle(row.changePerShare)}>
                  {formatCurrencyDetailed(row.changePerShare, row.currency, 2)}
                </td>
                <td style={gainCellStyle(row.dayGainCad)}>
                  {formatCurrency(row.dayGainCad, "CAD")}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td
                colSpan={4}
                style={{
                  ...styles.td,
                  backgroundColor: accentBg,
                  borderBottom: "none",
                  color: accentColor,
                  fontSize: "12px",
                  fontWeight: 700,
                  textAlign: "right",
                }}
              >
                {rows.length} titre{rows.length > 1 ? "s" : ""} ·{" "}
                {formatCurrency(rows.reduce((sum, row) => sum + row.dayGainCad, 0), "CAD")}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

function SessionTickerBlock({ view }: { view: SessionTickerView }) {
  const titleCount = view.lists.gainers.length + view.lists.losers.length;

  return (
    <Section>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px" }}>
        <tbody>
          <tr>
            <td style={styles.sessionHeader}>
              <Text style={styles.sessionHeaderTitle}>{view.sessionLabel}</Text>
              <Text style={styles.sessionHeaderDate}>{formatSessionDate(view.sessionDate)}</Text>
            </td>
            <td style={{ ...styles.sessionHeader, width: "160px" }}>
              <Text style={styles.sessionHeaderDate}>Total séance</Text>
              <Text style={{ ...styles.sessionTotal, color: gainTextColor(view.totalGainCad) }}>
                {view.totalGainCad !== null ? formatCurrency(view.totalGainCad, "CAD") : "—"}
              </Text>
              {titleCount > 0 ? (
                <Text style={{ ...styles.sessionHeaderDate, textAlign: "right" }}>
                  {titleCount} titre{titleCount > 1 ? "s" : ""}
                </Text>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ verticalAlign: "top", width: "50%", paddingRight: "8px" }}>
              <TickerTable
                title="Hausse"
                rows={view.lists.gainers}
                accentColor={palette.gain}
                accentBg={palette.gainBg}
                emptyHint="Aucun titre en hausse."
              />
            </td>
            <td style={{ verticalAlign: "top", width: "50%", paddingLeft: "8px" }}>
              <TickerTable
                title="Baisse"
                rows={view.lists.losers}
                accentColor={palette.loss}
                accentBg={palette.lossBg}
                emptyHint="Aucun titre en baisse."
              />
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export function EodReportEmail({ data }: { data: EodReportData }) {
  const preview = `DisnatIA — ${data.sessionDate} — titres seulement`;

  return (
    <Html lang="fr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.h1}>Rapport fin de journée — {data.sessionDate}</Heading>
          <Text style={styles.muted}>
            {data.sessionLabel} · généré le{" "}
            {new Date(data.generatedAt).toLocaleString("fr-CA", {
              timeZone: "America/Toronto",
            })} {" "}
            (Toronto)
          </Text>

          <Hr style={{ borderColor: palette.border, margin: "28px 0 20px" }} />

          <Text style={styles.sectionTitle}>Titres — séance courante</Text>
          <SessionTickerBlock view={data.currentSession} />

          <Hr style={{ borderColor: palette.border, margin: "28px 0 20px" }} />

          <Text style={styles.sectionTitle}>Titres — séance précédente</Text>
          <SessionTickerBlock view={data.previousSession} />

          <Hr style={{ borderColor: palette.border, margin: "28px 0 20px" }} />

          <Text style={styles.sectionTitle}>Qualité des données</Text>
          <Text style={styles.muted}>
            Cotations : {data.quoteCoverage.matched} / {data.quoteCoverage.total} positions avec cours live
            {data.quotesAsOf
              ? ` · MAJ ${new Date(data.quotesAsOf).toLocaleString("fr-CA", { timeZone: "America/Toronto" })}`
              : ""}
          </Text>
          {data.driftVsDisnatPct !== null ? (
            <Text style={styles.muted}>
              Écart vs export Disnat : {(data.driftVsDisnatPct).toFixed(2)}%
            </Text>
          ) : null}
          {data.usdToCad !== null ? (
            <Text style={styles.muted}>
              USD→CAD : {data.usdToCad.toFixed(4)}
              {data.usdToCadDate ? ` (${data.usdToCadDate})` : ""}
            </Text>
          ) : null}

          {data.appUrl ? (
            <Text style={styles.footer}>
              <Link href={data.appUrl} style={{ color: palette.accent }}>
                {data.appUrl}
              </Link>
            </Text>
          ) : null}

          <Text style={styles.footer}>DisnatIA — rapport automatique</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default EodReportEmail;
