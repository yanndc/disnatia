import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildAccountCashLedgers,
  cashCadAtOrBefore,
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
