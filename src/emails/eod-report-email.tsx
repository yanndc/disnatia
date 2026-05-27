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
import type { PerformancePeriodResult } from "@/features/portfolio/performance-indicator-types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

const styles = {
  body: {
    backgroundColor: "#f4f4f5",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    margin: 0,
    padding: "24px 0",
  },
  container: {
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    margin: "0 auto",
    maxWidth: "640px",
    padding: "24px",
  },
  h1: { color: "#18181b", fontSize: "22px", fontWeight: 600, margin: "0 0 8px" },
  muted: { color: "#71717a", fontSize: "13px", lineHeight: "20px", margin: "0 0 16px" },
  kpiRow: { margin: "0 0 12px" },
  kpiLabel: { color: "#52525b", fontSize: "13px", margin: "0 0 4px" },
  kpiValue: { color: "#18181b", fontSize: "18px", fontWeight: 600, margin: 0 },
  sectionTitle: {
    color: "#18181b",
    fontSize: "16px",
    fontWeight: 600,
    margin: "24px 0 12px",
  },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  th: {
    borderBottom: "1px solid #e4e4e7",
    color: "#52525b",
    fontWeight: 600,
    padding: "8px 6px",
    textAlign: "left" as const,
  },
  td: {
    borderBottom: "1px solid #f4f4f5",
    color: "#3f3f46",
    padding: "8px 6px",
    verticalAlign: "top" as const,
  },
  note: { color: "#a16207", fontSize: "12px", margin: "8px 0 0" },
  footer: { color: "#a1a1aa", fontSize: "12px", marginTop: "24px" },
};

function formatGain(value: number | null, pct: number | null): string {
  if (value === null) return "—";
  const sign = value >= 0 ? "+" : "";
  const main = `${sign}${formatCurrency(value, "CAD")}`;
  if (pct === null) return main;
  const pctSign = pct >= 0 ? "+" : "";
  return `${main} (${pctSign}${formatPercent(pct)})`;
}

function periodBlock(title: string, period: PerformancePeriodResult) {
  return (
    <Section style={styles.kpiRow} key={title}>
      <Text style={styles.kpiLabel}>{title}</Text>
      <Text style={styles.kpiValue}>
        {formatGain(period.gainCad, period.gainPct)}
      </Text>
      {period.note ? (
        <Text style={styles.note}>{period.note}</Text>
      ) : null}
      {period.incomplete ? (
        <Text style={styles.note}>Données incomplètes ({period.method})</Text>
      ) : null}
    </Section>
  );
}

export function EodReportEmail({ data }: { data: EodReportData }) {
  const preview = `DisnatIA — ${data.sessionDate} — ${formatCurrency(data.totalValueCad, "CAD")}`;

  return (
    <Html lang="fr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.h1}>
            Rapport fin de journée — {data.sessionDate}
          </Heading>
          <Text style={styles.muted}>
            {data.sessionLabel} · généré le{" "}
            {new Date(data.generatedAt).toLocaleString("fr-CA", {
              timeZone: "America/Toronto",
            })}{" "}
            (Toronto)
          </Text>

          <Section>
            <Text style={styles.kpiLabel}>Valeur totale (CAD)</Text>
            <Text style={styles.kpiValue}>
              {formatCurrency(data.totalValueCad, "CAD")}
            </Text>
          </Section>

          {periodBlock(data.dayPeriod.label, data.dayPeriod)}
          {periodBlock(data.yesterdayPeriod.label, data.yesterdayPeriod)}

          <Hr style={{ borderColor: "#e4e4e7", margin: "24px 0" }} />

          <Text style={styles.sectionTitle}>Par compte</Text>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Compte</th>
                <th style={styles.th}>Total</th>
                <th style={styles.th}>Titres</th>
                <th style={styles.th}>Cash</th>
                <th style={styles.th}>P&L jour</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.accountKey}>
                  <td style={styles.td}>
                    {a.label}
                    {a.owner ? (
                      <>
                        <br />
                        <span style={{ color: "#a1a1aa", fontSize: "12px" }}>
                          {a.owner}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td style={styles.td}>{formatCurrency(a.totalCad, "CAD")}</td>
                  <td style={styles.td}>
                    {formatCurrency(a.positionsCad, "CAD")}
                  </td>
                  <td style={styles.td}>{formatCurrency(a.cashCad, "CAD")}</td>
                  <td style={styles.td}>
                    {a.dayGainCad !== null
                      ? formatGain(a.dayGainCad, null)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Text style={styles.sectionTitle}>Positions</Text>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Titre</th>
                <th style={styles.th}>Compte</th>
                <th style={styles.th}>Qté</th>
                <th style={styles.th}>Valeur CAD</th>
                <th style={styles.th}>P&L jour</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map((p) => (
                <tr key={`${p.accountKey}-${p.ticker}-${p.currency}`}>
                  <td style={styles.td}>
                    <strong>{p.ticker}</strong>
                    {p.securityName ? (
                      <>
                        <br />
                        <span style={{ fontSize: "12px", color: "#a1a1aa" }}>
                          {p.securityName}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td style={styles.td}>{p.accountLabel}</td>
                  <td style={styles.td}>{formatNumber(p.quantity, 4)}</td>
                  <td style={styles.td}>
                    {formatCurrency(p.marketValueCad, "CAD")}
                    {!p.usesLiveQuote ? (
                      <>
                        <br />
                        <span style={{ fontSize: "11px", color: "#a1a1aa" }}>
                          snapshot
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td style={styles.td}>
                    {p.dayGainCad !== null
                      ? formatGain(p.dayGainCad, null)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Hr style={{ borderColor: "#e4e4e7", margin: "24px 0" }} />

          <Text style={styles.sectionTitle}>Qualité des données</Text>
          <Text style={styles.muted}>
            Cotations : {data.quoteCoverage.matched} / {data.quoteCoverage.total}{" "}
            positions avec cours live
            {data.quotesAsOf
              ? ` · MAJ ${new Date(data.quotesAsOf).toLocaleString("fr-CA", { timeZone: "America/Toronto" })}`
              : ""}
          </Text>
          {data.driftVsDisnatPct !== null ? (
            <Text style={styles.muted}>
              Écart vs export Disnat : {formatPercent(data.driftVsDisnatPct)}
            </Text>
          ) : null}
          {data.usdToCad !== null ? (
            <Text style={styles.muted}>
              USD→CAD : {formatNumber(data.usdToCad, 4)}
              {data.usdToCadDate ? ` (${data.usdToCadDate})` : ""}
            </Text>
          ) : null}

          {data.appUrl ? (
            <Text style={styles.footer}>
              <Link href={data.appUrl}>{data.appUrl}</Link>
            </Text>
          ) : null}

          <Text style={styles.footer}>DisnatIA — rapport automatique</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default EodReportEmail;
