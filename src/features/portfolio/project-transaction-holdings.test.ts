import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  resolveListingCurrencyFromEvidence,
  type ListingEvidenceRow,
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
});
