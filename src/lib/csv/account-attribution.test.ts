import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  attributionFactsFromSnapshot,
  bestAttributionSuggestion,
  fileAttributionSignature,
  suggestAccountAttribution,
  type AttributionAccount,
} from "./account-attribution";

const celi: AttributionAccount = {
  accountKey: "5KFZEY4|CAD",
  label: "CELI",
  accountNumber: "5KFZEY4",
  accountType: "CELI",
  owner: "YANN DE CHAMPLAIN",
  currency: "CAD",
  holdings: [{ ticker: "ATD", currency: "CAD" }, { ticker: "XEQT", currency: "CAD" }],
};

const reer: AttributionAccount = {
  accountKey: "5KFZES7|CAD",
  label: "REER",
  accountNumber: "5KFZES7",
  accountType: "REER",
  owner: "VALERIE TREMBLAY",
  currency: "CAD",
  holdings: [{ ticker: "AAPL", currency: "USD" }, { ticker: "XEQT", currency: "CAD" }],
};

describe("fileAttributionSignature", () => {
  test("neutralise les numéros de téléchargement et la casse", () => {
    const a = fileAttributionSignature("Historique (3).xlsx", ["Date", "Type de transaction"]);
    const b = fileAttributionSignature("historique (12).XLSX", ["Date", "Type de transaction"]);
    assert.equal(a, b);
  });

  test("distingue deux formes de fichiers différentes", () => {
    const a = fileAttributionSignature("export.csv", ["Date", "Type de transaction"]);
    const b = fileAttributionSignature("export.csv", ["Symbole", "Quantité"]);
    assert.notEqual(a, b);
  });
});

describe("suggestAccountAttribution", () => {
  test("numéro de compte présent dans le fichier → attribution exacte", () => {
    const suggestions = suggestAccountAttribution(
      { fileName: "export-portefeuille.csv", accountNumbers: ["5KFZES7"] },
      [celi, reer],
    );

    assert.equal(suggestions[0]!.accountKey, reer.accountKey);
    assert.equal(suggestions[0]!.confidence, "EXACTE");
    assert.ok(suggestions[0]!.reasons.some((r) => r.includes("numéro de compte")));
  });

  test("aucun signal exploitable → aucune proposition", () => {
    const suggestions = suggestAccountAttribution(
      { fileName: "Historique (4).xlsx", tickers: [{ ticker: "ZZZZ", currency: "CAD" }] },
      [celi, reer],
    );

    assert.equal(bestAttributionSuggestion(suggestions), null);
  });

  test("nom de fichier avec type + propriétaire → proposition probable", () => {
    const suggestions = suggestAccountAttribution(
      {
        fileName: "2026-10_CELI_YANN_historique.csv",
        tickers: [{ ticker: "ATD", currency: "CAD" }],
      },
      [celi, reer],
    );

    assert.equal(suggestions[0]!.accountKey, celi.accountKey);
    assert.equal(suggestions[0]!.confidence, "PROBABLE");
  });

  test("mêmes titres dans deux comptes et nom générique → ambigu (choix humain requis)", () => {
    const suggestions = suggestAccountAttribution(
      {
        fileName: "Historique (7).xlsx",
        tickers: [{ ticker: "XEQT", currency: "CAD" }],
      },
      [
        { ...celi, holdings: [{ ticker: "XEQT", currency: "CAD" }] },
        { ...reer, holdings: [{ ticker: "XEQT", currency: "CAD" }] },
      ],
    );

    assert.equal(suggestions[0]!.confidence, "AMBIGUE");
    assert.equal(suggestions[1]!.confidence, "AMBIGUE");
    assert.equal(suggestions[0]!.score, suggestions[1]!.score);
  });

  test("un titre détenu par un seul compte tranche l'attribution", () => {
    const suggestions = suggestAccountAttribution(
      {
        fileName: "Historique (7).xlsx",
        tickers: [
          { ticker: "XEQT", currency: "CAD" },
          { ticker: "AAPL", currency: "USD" },
        ],
      },
      [celi, reer],
    );

    assert.equal(suggestions[0]!.accountKey, reer.accountKey);
    assert.notEqual(suggestions[0]!.confidence, "AMBIGUE");
    assert.ok(
      suggestions[0]!.reasons.some((r) => r.includes("exclusif")),
      `raisons: ${JSON.stringify(suggestions[0]!.reasons)}`,
    );
  });

  test("la règle mémorisée gagne sur le recouvrement de titres", () => {
    const suggestions = suggestAccountAttribution(
      { fileName: "Historique (9).xlsx", tickers: [{ ticker: "AAPL", currency: "USD" }] },
      [celi, reer],
      { rememberedAccountKey: celi.accountKey },
    );

    assert.equal(suggestions[0]!.accountKey, celi.accountKey);
    assert.ok(suggestions[0]!.reasons.some((r) => r.includes("mémorisée")));
  });
});

describe("attributionFactsFromSnapshot", () => {
  test("collecte numéros de compte, titres et devises des transactions", () => {
    const facts = attributionFactsFromSnapshot(
      "Historique (2).xlsx",
      {
        positions: [],
        transactions: [
          { ticker: "AAPL", currency: "USD" },
          { currency: "CAD" },
          { ticker: "AAPL", currency: "USD" },
        ],
      },
      ["Date", "Type de transaction"],
    );

    assert.equal(facts.fileName, "Historique (2).xlsx");
    assert.deepEqual(facts.currencies?.toSorted(), ["CAD", "USD"]);
    assert.equal(facts.tickers?.length, 2);
    assert.deepEqual(facts.headers, ["Date", "Type de transaction"]);
  });
});
