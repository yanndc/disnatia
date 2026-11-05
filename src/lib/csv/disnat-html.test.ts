import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseDisnatHistoryHtml } from "./disnat-html";

function cell(colId: string, value: string): string {
  return `<div role="gridcell" comp-id="1" col-id="${colId}" class="ag-cell">${value}</div>`;
}

function row(index: number, cells: Array<[string, string]>): string {
  return `<div row-index="${index}" class="ag-row">${cells
    .map(([col, value]) => cell(col, value))
    .join("")}</div>`;
}

const HTML = `<!-- saved from url=(0089)https://tmw.secure.vmd.ca/s9web/secure/portfolio/account?clientId=5KFZE&accountId=5KFZES7 -->
<html><body><div class="asset-title"> Vue d’ensemble () </div>
${row(0, [
  ["tradeDate", "-"],
  ["settlementDate", "2026-10-30"],
  ["transactionType", "DIVIDENDE"],
  ["symbol", "SPY"],
  ["amount", "77,44"],
  ["accountBundleCurrency", "US"],
])}
<div class="asset-title"> CRI (5KFZES7) </div>
${row(0, [
  ["tradeDate", "-"],
  ["settlementDate", "2026-10-30"],
  ["transactionType", "DIVIDENDE"],
  ["securityType", "Actions"],
  ["symbol", "SPY"],
  ["description", "STATE STREET SPDR ETF"],
  ["quantity", "41"],
  ["price", "-"],
  ["priceCurrency", "US"],
  ["commission", "0"],
  ["amount", "77,44"],
  ["accountBundleCurrency", "US"],
])}
${row(1, [
  ["tradeDate", "2026-10-08"],
  ["settlementDate", "2026-10-08"],
  ["transactionType", "ACHAT"],
  ["securityType", "Actions"],
  ["symbol", "AAPL"],
  ["description", "APPLE INC"],
  ["quantity", "2"],
  ["price", "260,00"],
  ["priceCurrency", "US"],
  ["commission", "0"],
  ["amount", "-520,00"],
  ["accountBundleCurrency", "US"],
])}
<div class="asset-title"> Comptant (5L3APA5) </div>
<div class="asset-title"> REER (5KFZEU3) </div>
${row(0, [
  ["tradeDate", "-"],
  ["settlementDate", "2026-09-15"],
  ["transactionType", "COTISATION"],
  ["symbol", "-"],
  ["amount", "500,00"],
  ["accountBundleCurrency", "CAN"],
])}
</body></html>`;

describe("parseDisnatHistoryHtml", () => {
  test("extrait une section par compte, ignore l'agrégat et les comptes vides", () => {
    const result = parseDisnatHistoryHtml(HTML);
    assert.equal(result.ok, true);
    assert.equal(result.accounts.length, 2);
    assert.deepEqual(
      result.accounts.map((a) => a.accountKey),
      ["5KFZES7|USD", "5KFZEU3|CAD"],
    );
    assert.equal(result.rowsTotal, 3);
    assert.ok(result.skipped.some((s) => s.title.includes("Vue d’ensemble")));
    assert.ok(result.skipped.some((s) => s.title.includes("5L3APA5") && s.kind === "empty"));
    assert.ok(result.skipped.some((s) => s.kind === "aggregate"));
  });

  test("normalise les devises et construit le CSV attendu", () => {
    const [cri, reer] = parseDisnatHistoryHtml(HTML).accounts;
    assert.equal(cri.currency, "USD");
    assert.equal(reer.currency, "CAD");
    assert.equal(cri.fromDate, "2026-10-08");
    assert.equal(cri.toDate, "2026-10-30");
    const lines = cri.csv.split("\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[0].startsWith("Date de transaction;Date de règlement;Type de transaction"));
    assert.equal(
      lines[1],
      "2026-10-30;2026-10-30;DIVIDENDE;Actions;SPY;STATE STREET SPDR ETF;-;41;-;US;0;77,44;US",
    );
    assert.ok(lines[2].includes(";ACHAT;Actions;AAPL;APPLE INC;-;2;260,00;US;0;-520,00;US"));
  });

  test("refuse un contenu vide ou sans section", () => {
    assert.equal(parseDisnatHistoryHtml("").ok, false);
    assert.equal(parseDisnatHistoryHtml("<html><body>rien</body></html>").ok, false);
  });
});
