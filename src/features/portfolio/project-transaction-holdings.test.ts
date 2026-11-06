import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  resolveListingCurrencyFromEvidence,
  txDate,
  type ListingEvidenceRow,
  type ProjectableTransaction,
} from "./project-transaction-holdings";

/** Ligne Disnat minimale : devise du compte + devise du prix + marché + prix. */
function row(
  ticker: string | null,
  currency: string | null,
  priceDevise: string | null,
  market: string | null,
  price: number | null = null,
): ListingEvidenceRow {
  return { ticker, currency, priceDevise, market, price };
}

describe("resolveListingCurrencyFromEvidence", () => {
  test("titre US acheté dans un compte CAD reste USD malgré un fractionnement libellé -C", () => {
    /* Cas réel : 2022-04-25 ACHAT AMZN (Prix US, marché USA) puis 2022-06-06 FRACTIONNEMENT AMZN-C. */
    const rows = [
      row("AMZN", "CAN", "US", "USA", 2850),
      row("AMZN-C", "CAN", "CAN", null, null),
      row("AMZN-C", "CAN", "CAN", null, null),
    ];
    assert.equal(resolveListingCurrencyFromEvidence(rows), "USD");
  });

  test("CDR coté à Toronto (achat tarifé marché CAN) reste CAD même si la tige existe aussi en USD", () => {
    /* Cas réel : NVDA CORP CDR C$HDG acheté en CAD, alors que NVDA-U existe dans un autre compte. */
    const rows = [
      row("NVDA-C", "CAN", "CAN", "CAN", 38.22),
      row("NVDA-U", "US", "US", "USA", 172.4),
    ];
    assert.equal(resolveListingCurrencyFromEvidence(rows), "CAD");
  });

  test("titre TSX sans opération tarifée : repli sur le suffixe -C", () => {
    const rows = [row("VFV-C", "CAN", "CAN", null, null)];
    assert.equal(resolveListingCurrencyFromEvidence(rows), "CAD");
  });

  test("titre US sans opération tarifée : repli sur le suffixe -U", () => {
    const rows = [row("MSFT-U", "US", "US", null, null)];
    assert.equal(resolveListingCurrencyFromEvidence(rows), "USD");
  });

  test("prix en USD sur une opération tarifée suffit sans marché renseigné", () => {
    const rows = [row("AAPL", "CAN", "US", null, 160)];
    assert.equal(resolveListingCurrencyFromEvidence(rows), "USD");
  });

  test("aucune ligne exploitable → null (l'appelant garde son repli)", () => {
    assert.equal(resolveListingCurrencyFromEvidence([]), null);
    assert.equal(resolveListingCurrencyFromEvidence([row("-", "CAN", "CAN", null)]), null);
  });

describe("txDate (date d'effet d'une position)", () => {
  const base = {
    id: "tx1",
    accountKey: "5KFZEZ2|CAD",
    accountName: "CELI",
    accountNumber: "5KFZEZ2",
    transactionType: "ACHAT",
    txCategory: "BUY" as const,
    ticker: "T-C",
    securityName: "TELUS",
    currency: "CAD",
    priceDevise: "CAD",
    market: "CAN",
    assetClass: null,
    quantity: 200,
    price: 17.32,
    amount: -3464,
    fees: null,
    rawJson: {},
  };

  test("utilise la date d'opération, pas la date de règlement (T+1)", () => {
    // Cas réel : achat exécuté le 26 mai, réglé le 27 → la position existe dès le 26.
    const tx: ProjectableTransaction = {
      ...base,
      tradeDate: new Date("2026-05-26T00:00:00.000Z"),
      settlementDate: new Date("2026-05-27T00:00:00.000Z"),
    };
    assert.equal(txDate(tx)?.toISOString().slice(0, 10), "2026-05-26");
  });

  test("retombe sur la date de règlement quand l'opération n'est pas datée", () => {
    const tx: ProjectableTransaction = {
      ...base,
      tradeDate: null,
      settlementDate: new Date("2026-05-27T00:00:00.000Z"),
    };
    assert.equal(txDate(tx)?.toISOString().slice(0, 10), "2026-05-27");
  });

  test("retourne null quand aucune date n'est disponible", () => {
    const tx: ProjectableTransaction = { ...base, tradeDate: null, settlementDate: null };
    assert.equal(txDate(tx), null);
  });
});

});
