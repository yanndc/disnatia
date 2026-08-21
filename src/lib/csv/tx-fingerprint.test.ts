import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { txFingerprint } from "./tx-fingerprint";

describe("txFingerprint", () => {
  test("même empreinte pour une cotisation importée avec des tickers placeholder différents", () => {
    // Reproduit un cas réel : la même cotisation de 2 000 $ apparaît dans deux fichiers
    // "Historique" Disnat différents, l'un avec le ticker placeholder "-", l'autre "--C".
    const base = {
      tradeDate: null,
      settlementDate: new Date("2026-04-06"),
      transactionType: "COTISATION",
      amount: 2000,
      currency: "CAD",
      quantity: 0,
      price: null,
      securityName: null,
    };
    const fpA = txFingerprint("5KFZEZ2|CAD", { ...base, ticker: "-" });
    const fpB = txFingerprint("5KFZEZ2|CAD", { ...base, ticker: "--C" });

    assert.equal(fpA, fpB, "les deux imports du même dépôt devraient produire la même empreinte");
  });

  test("distingue toujours deux dépôts réellement différents (montant différent)", () => {
    const base = {
      tradeDate: null,
      settlementDate: new Date("2026-04-06"),
      transactionType: "COTISATION",
      currency: "CAD",
      quantity: 0,
      price: null,
      securityName: null,
      ticker: "-",
    };
    const fpA = txFingerprint("5KFZEZ2|CAD", { ...base, amount: 2000 });
    const fpB = txFingerprint("5KFZEZ2|CAD", { ...base, amount: 400 });

    assert.notEqual(fpA, fpB);
  });

  test("garde le ticker distinctif pour un vrai symbole boursier (dividende)", () => {
    const base = {
      tradeDate: null,
      settlementDate: new Date("2026-04-06"),
      transactionType: "DIVIDENDE",
      amount: 5.09,
      currency: "CAD",
      quantity: 12,
      price: null,
      securityName: null,
    };
    const fpVfv = txFingerprint("5KFZEZ2|CAD", { ...base, ticker: "VFV-C" });
    const fpOther = txFingerprint("5KFZEZ2|CAD", { ...base, ticker: "XEQT-C" });

    assert.notEqual(fpVfv, fpOther, "un vrai symbole boursier reste distinctif, seul un placeholder est ignoré");
  });

  test("distingue un virement en nature de deux titres différents le même jour (montant $0)", () => {
    // Cas réel trouvé en base : transfert de AAPL et de AMZN le même jour, même compte,
    // montant 0 $ (transfert en nature, pas de cash) — ce sont deux événements distincts,
    // pas un doublon d'import, même si le montant/catégorie/date sont identiques.
    const base = {
      tradeDate: null,
      settlementDate: new Date("2024-03-28"),
      transactionType: "TRANSFERT",
      amount: 0,
      currency: "USD",
      quantity: 10,
      price: null,
      securityName: null,
    };
    const fpAapl = txFingerprint("5KFZEU3|USD", { ...base, ticker: "AAPL" });
    const fpAmzn = txFingerprint("5KFZEU3|USD", { ...base, ticker: "AMZN" });

    assert.notEqual(fpAapl, fpAmzn);
  });
});
