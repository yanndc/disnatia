import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildAccountCashLedgers,
  cashCadAtOrBefore,
  cashLedgerReliableForAccount,
} from "./performance-cash-ledger";

describe("buildAccountCashLedgers", () => {
  test("solde cash au 31 déc inclut cotisations non encore investies", () => {
    const ledgers = buildAccountCashLedgers(
      [
        {
          accountKey: "ACC|CAD",
          tradeDate: null,
          settlementDate: new Date("2025-12-11T12:00:00Z"),
          txCategory: "CONTRIBUTION",
          amount: 4000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          tradeDate: null,
          settlementDate: new Date("2026-04-16T12:00:00Z"),
          txCategory: "BUY",
          amount: -2000,
          currency: "CAD",
        },
      ],
      null,
    );
    assert.equal(cashCadAtOrBefore(["ACC|CAD"], ledgers, "2025-12-31"), 4000);
    assert.equal(cashCadAtOrBefore(["ACC|CAD"], ledgers, "2026-04-20"), 2000);
  });
});

describe("cashLedgerReliableForAccount — garde-fous (audit 2026-11)", () => {
  const series = [
    { date: "2025-01-15", balanceCad: 500 },
    { date: "2025-06-30", balanceCad: 1_200 },
    { date: "2025-12-31", balanceCad: 800 },
  ];
  const ledgers = { "ACC|CAD": series };

  test("fiable quand le solde est plausible et proche de l'encaisse importée", () => {
    assert.equal(
      cashLedgerReliableForAccount("ACC|CAD", ledgers, "2025-01-10", "2025-12-31", {
        asOf: "2025-12-31",
        cad: 800,
      }),
      true,
    );
  });

  test("rejette un solde d'encaisse négatif (financement initial manquant)", () => {
    assert.equal(
      cashLedgerReliableForAccount(
        "ACC|CAD",
        { "ACC|CAD": [{ date: "2025-01-15", balanceCad: -3_992 }] },
        "2025-01-10",
        "2025-12-31",
      ),
      false,
    );
  });

  test("rejette un ledger très éloigné de l'encaisse réelle du dernier import", () => {
    assert.equal(
      cashLedgerReliableForAccount("ACC|CAD", ledgers, "2025-01-10", "2025-12-31", {
        asOf: "2025-12-31",
        cad: 83, // réel : 83 $ → ledger 800 $ ⇒ incohérent
      }),
      false,
    );
  });

  test("rejette un ledger périmé de plus de 90 jours vs l'historique titres", () => {
    assert.equal(
      cashLedgerReliableForAccount("ACC|CAD", ledgers, "2025-01-10", "2026-06-30"),
      false,
    );
  });

  test("rejette un ledger qui démarre plus de 45 jours après l'historique titres", () => {
    assert.equal(
      cashLedgerReliableForAccount("ACC|CAD", ledgers, "2024-10-01", "2025-12-31"),
      false,
    );
  });

  test("compte sans série d'encaisse : considéré fiable (aucun effet sur le delta)", () => {
    assert.equal(cashLedgerReliableForAccount("OTHER|CAD", ledgers, null, null), true);
  });
});
