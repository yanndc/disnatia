import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildPerformanceCashFlowsFromTxRows,
  dedupeNearDuplicateFlows,
  netExternalFlowsCad,
  resolveFlowEffectiveDate,
} from "./performance-cash-flows";

describe("resolveFlowEffectiveDate", () => {
  test("utilise tradeDate quand présent", () => {
    const d = new Date("2026-04-15T12:00:00Z");
    const s = new Date("2026-04-16T12:00:00Z");
    assert.equal(resolveFlowEffectiveDate(d, s), d);
  });

  test("retombe sur settlementDate si tradeDate absent", () => {
    const s = new Date("2026-04-16T12:00:00Z");
    assert.equal(resolveFlowEffectiveDate(null, s), s);
  });
});

describe("buildPerformanceCashFlowsFromTxRows", () => {
  test("inclut les cotisations avec settlementDate seulement", () => {
    const flows = buildPerformanceCashFlowsFromTxRows(
      [
        {
          accountKey: "5KFZEZ2|CAD",
          tradeDate: null,
          settlementDate: new Date("2026-04-24T12:00:00Z"),
          txCategory: "CONTRIBUTION",
          amount: 7100.78,
          currency: "CAD",
        },
        {
          accountKey: "5KFZEZ2|CAD",
          tradeDate: new Date("2025-12-11T12:00:00Z"),
          settlementDate: null,
          txCategory: "CONTRIBUTION",
          amount: 4000,
          currency: "CAD",
        },
        {
          accountKey: "5KFZEZ2|CAD",
          tradeDate: new Date("2026-05-01T12:00:00Z"),
          settlementDate: new Date("2026-05-02T12:00:00Z"),
          txCategory: "BUY",
          amount: 5000,
          currency: "CAD",
        },
      ],
      null,
    );
    assert.equal(flows.length, 2);
    const amounts = flows.map((f) => f.amountCad).toSorted((a, b) => a - b);
    assert.deepEqual(amounts, [4000, 7100.78]);
  });

  test("déduplique les réimportations à 1 jour (trade vs settlement)", () => {
    const flows = buildPerformanceCashFlowsFromTxRows(
      [
        {
          accountKey: "5KFZEZ2|CAD",
          tradeDate: null,
          settlementDate: new Date("2026-04-06T04:00:00Z"),
          txCategory: "CONTRIBUTION",
          amount: 2000,
          currency: "CAD",
          fingerprint: "fp-a",
        },
        {
          accountKey: "5KFZEZ2|CAD",
          tradeDate: null,
          settlementDate: new Date("2026-04-06T12:00:00Z"),
          txCategory: "CONTRIBUTION",
          amount: 2000,
          currency: "CAD",
          fingerprint: "fp-b",
        },
        {
          accountKey: "5KFZEZ2|CAD",
          tradeDate: null,
          settlementDate: new Date("2026-05-14T12:00:00Z"),
          txCategory: "CONTRIBUTION",
          amount: 400,
          currency: "CAD",
          fingerprint: "fp-c",
        },
        {
          accountKey: "5KFZEZ2|CAD",
          tradeDate: null,
          settlementDate: new Date("2026-05-28T12:00:00Z"),
          txCategory: "CONTRIBUTION",
          amount: 400,
          currency: "CAD",
          fingerprint: "fp-d",
        },
      ],
      null,
    );
    assert.equal(flows.length, 3);
    const ytd = netExternalFlowsCad(flows, ["5KFZEZ2|CAD"], "2026-01-01", "2026-06-12");
    assert.equal(ytd, 2800);
  });

  test("déduplique les réimportations identiques", () => {
    const row = {
      accountKey: "ACC|CAD",
      tradeDate: null,
      settlementDate: new Date("2026-04-24T12:00:00Z"),
      transactionType: "COTISATION",
      txCategory: "CONTRIBUTION",
      amount: 7100.78,
      currency: "CAD",
      quantity: 0,
      ticker: null,
    };
    const flows = buildPerformanceCashFlowsFromTxRows([row, { ...row }], null);
    assert.equal(flows.length, 1);
  });
});

describe("netExternalFlowsCad", () => {
  test("somme les cotisations sur la période", () => {
    const flows = buildPerformanceCashFlowsFromTxRows(
      [
        {
          accountKey: "ACC|CAD",
          tradeDate: null,
          settlementDate: new Date("2026-04-01T12:00:00Z"),
          txCategory: "CONTRIBUTION",
          amount: 4000,
          currency: "CAD",
        },
        {
          accountKey: "ACC|CAD",
          tradeDate: null,
          settlementDate: new Date("2026-05-01T12:00:00Z"),
          txCategory: "CONTRIBUTION",
          amount: 900,
          currency: "CAD",
        },
        {
          accountKey: "OTHER|CAD",
          tradeDate: null,
          settlementDate: new Date("2026-04-15T12:00:00Z"),
          txCategory: "CONTRIBUTION",
          amount: 999,
          currency: "CAD",
        },
      ],
      null,
    );
    const net = netExternalFlowsCad(flows, ["ACC|CAD"], "2026-01-01", "2026-06-12");
    assert.equal(net, 4900);
  });
});

describe("dedupeNearDuplicateFlows", () => {
  test("conserve deux petites cotisations récurrentes à quelques jours d'écart", () => {
    const flows = dedupeNearDuplicateFlows([
      {
        accountKey: "ACC|CAD",
        tradeDate: "2026-04-06",
        txCategory: "CONTRIBUTION",
        amountCad: 400,
      },
      {
        accountKey: "ACC|CAD",
        tradeDate: "2026-04-16",
        txCategory: "CONTRIBUTION",
        amountCad: 400,
      },
    ]);
    assert.equal(flows.length, 2);
  });

  test("conserve deux grosses cotisations du même montant à >8 jours d'écart", () => {
    const flows = dedupeNearDuplicateFlows([
      {
        accountKey: "ACC|CAD",
        tradeDate: "2026-04-06",
        txCategory: "CONTRIBUTION",
        amountCad: 400,
      },
      {
        accountKey: "ACC|CAD",
        tradeDate: "2026-05-28",
        txCategory: "CONTRIBUTION",
        amountCad: 400,
      },
    ]);
    assert.equal(flows.length, 2);
  });
});
