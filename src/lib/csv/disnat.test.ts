import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeDisnatRows } from "./disnat";
import type { ParsedDisnatRow } from "@/types/portfolio";

describe("normalizeDisnatRows — transactions", () => {
  test("réplique le fallback tradeDate ?? settlementDate pour un dividende Disnat", () => {
    // Reproduit le format réel des fichiers "Historique (XX).xlsx" : Disnat écrit "-" dans
    // la colonne date de transaction pour les dividendes/contributions, seule la date de
    // règlement est renseignée.
    const row: ParsedDisnatRow = {
      "Compte": "5KFZES7",
      "Type de transaction": "DIVIDENDE",
      "Date de transaction": "-",
      "Date de règlement": "2026-08-13",
      "Montant": "8.37",
      "Symbole": "AAPL",
    };

    const result = normalizeDisnatRows([row]);

    assert.equal(result.transactions.length, 1);
    const tx = result.transactions[0]!;
    assert.ok(tx.tradeDate, "tradeDate devrait être renseignée via le repli sur settlementDate");
    assert.equal(tx.tradeDate?.toISOString().slice(0, 10), "2026-08-13");
  });
});

describe("normalizeDisnatRows — positions", () => {
  test("avertit quand la quantité est manquante pour une position", () => {
    const row: ParsedDisnatRow = {
      "Nom du compte": "CELI",
      "Compte": "5KFZEY4",
      "Symbole": "ATD-C",
      "Devise du compte": "CAD",
      "Valeur marchande": "9354.07",
      // Pas de colonne quantité.
    };

    const result = normalizeDisnatRows([row]);

    assert.equal(result.positions.length, 1);
    assert.equal(result.positions[0]!.quantity, 0);
    assert.ok(
      result.warnings.some((w) => w.includes("quantité manquante")),
      `attendu un avertissement de quantité manquante, reçu: ${JSON.stringify(result.warnings)}`,
    );
  });

  test("aucun avertissement de quantité quand elle est présente", () => {
    const row: ParsedDisnatRow = {
      "Nom du compte": "CELI",
      "Compte": "5KFZEY4",
      "Symbole": "ATD-C",
      "Devise du compte": "CAD",
      "Quantité": "103",
      "Valeur marchande": "9354.07",
    };

    const result = normalizeDisnatRows([row]);

    assert.equal(result.positions.length, 1);
    assert.equal(result.positions[0]!.quantity, 103);
    assert.ok(!result.warnings.some((w) => w.includes("quantité manquante")));
  });
});
