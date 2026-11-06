import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  favoriAdjustedCashByAccount,
  favoriCoversScope,
  favoriReferenceForClient,
  favoriReportDates,
  groupAccountKeysByClient,
} from "./favori-reference";
import type {
  PerformanceAccountRef,
  PerformanceClientCashSnapshot,
} from "./performance-indicator-types";

function snap(
  clientCode: string,
  asOf: string,
  securitiesCad: number,
  cashCad = 0,
): PerformanceClientCashSnapshot {
  return {
    clientCode,
    asOf,
    securitiesCad,
    cashCad,
    totalCad: securitiesCad + cashCad,
  };
}

function account(accountKey: string, isExternal = false): PerformanceAccountRef {
  return {
    accountKey,
    label: accountKey,
    owner: "YANN DE CHAMPLAIN",
    accountType: "CELI",
    currency: "CAD",
    isExternal,
  };
}

describe("groupAccountKeysByClient", () => {
  test("regroupe les comptes par code client Disnat", () => {
    const groups = groupAccountKeysByClient([
      "5KFZEZ2|CAD",
      "5KFZEU3|USD",
      "5L3APY0|CAD",
    ]);
    assert.equal(groups.length, 2);
    const yann = groups.find((group) => group.clientCode === "5KFZE");
    assert.deepEqual(yann?.accountKeys, ["5KFZEZ2|CAD", "5KFZEU3|USD"]);
  });

  test("ignore les clés vides", () => {
    assert.deepEqual(groupAccountKeysByClient([]), []);
  });
});

describe("favoriReferenceForClient", () => {
  const snapshots = [snap("5KFZE", "2026-11-05", 169_277), snap("5KFZE", "2026-11-06", 170_749.52)];

  test("retourne la capture la plus récente ≤ date de rapport", () => {
    const best = favoriReferenceForClient(snapshots, "5kfze", "2026-11-06", "2026-10-30");
    assert.equal(best?.asOf, "2026-11-06");
  });

  test("ignore une capture postérieure à la date de rapport", () => {
    const best = favoriReferenceForClient(snapshots, "5KFZE", "2026-11-05", "2026-10-30");
    assert.equal(best?.asOf, "2026-11-05");
  });

  test("ignore une capture périmée (plus vieille que la tolérance)", () => {
    const best = favoriReferenceForClient(snapshots, "5KFZE", "2026-11-30", "2026-11-20");
    assert.equal(best, null);
  });

  test("retourne null sans capture pour ce client", () => {
    assert.equal(favoriReferenceForClient(snapshots, "5L3AP", "2026-11-06", "2026-10-30"), null);
    assert.equal(favoriReferenceForClient(undefined, "5KFZE", "2026-11-06", "2026-10-30"), null);
  });
});

describe("favoriReportDates", () => {
  test("liste les dates distinctes, du plus récent au plus ancien", () => {
    const dates = favoriReportDates([
      snap("5KFZE", "2026-11-05", 1),
      snap("5KFZE", "2026-11-06", 2),
      snap("5L3AP", "2026-11-06", 3),
    ]);
    assert.deepEqual(dates, ["2026-11-06", "2026-11-05"]);
  });

  test("retourne un tableau vide sans capture", () => {
    assert.deepEqual(favoriReportDates(undefined), []);
  });
});

describe("favoriCoversScope", () => {
  const accounts = [
    account("5KFZEZ2|CAD"),
    account("5KFZEU3|USD"),
    account("5L3APY0|CAD"),
    account("EXT-1|CAD", true),
  ];

  test("vrai quand tous les comptes Disnat du client sont dans la portée", () => {
    assert.equal(favoriCoversScope(accounts, "5KFZE", ["5KFZEZ2|CAD", "5KFZEU3|USD"]), true);
  });

  test("faux quand un compte du client est exclu des filtres", () => {
    assert.equal(favoriCoversScope(accounts, "5KFZE", ["5KFZEZ2|CAD"]), false);
  });

  test("faux quand le client n'a aucun compte connu", () => {
    assert.equal(favoriCoversScope(accounts, "9ZZZZ", ["9ZZZZ1|CAD"]), false);
  });

describe("favoriAdjustedCashByAccount", () => {
  const usdToCad = 1.4;

  test("remplace l'encaisse par celle du favori quand elle est plus récente", () => {
    const cash = favoriAdjustedCashByAccount(
      [
        { accountKey: "5KFZEZ2|CAD", currency: "CAD", cashValue: 100, csvAsOfMs: 1_000 },
        { accountKey: "5KFZE19|CAD", currency: "CAD", cashValue: 0, csvAsOfMs: 1_000 },
      ],
      [{ clientCode: "5KFZE", asOfMs: 2_000, cashCad: 400 }],
      usdToCad,
    );
    // Écart +300 réparti au prorata de l'encaisse du fichier (100 % sur le compte qui en a)
    assert.equal(cash.get("5KFZEZ2|CAD"), 400);
    assert.equal(cash.get("5KFZE19|CAD"), 0);
  });

  test("répartit à parts égales quand toutes les encaisses sont nulles", () => {
    const cash = favoriAdjustedCashByAccount(
      [
        { accountKey: "5KFZEZ2|CAD", currency: "CAD", cashValue: 0, csvAsOfMs: 1_000 },
        { accountKey: "5KFZEA9|CAD", currency: "CAD", cashValue: 0, csvAsOfMs: 1_000 },
      ],
      [{ clientCode: "5KFZE", asOfMs: 2_000, cashCad: 100 }],
      usdToCad,
    );
    assert.equal(cash.get("5KFZEZ2|CAD"), 50);
    assert.equal(cash.get("5KFZEA9|CAD"), 50);
  });

  test("garde l'encaisse du fichier quand le favori est plus ancien", () => {
    const cash = favoriAdjustedCashByAccount(
      [{ accountKey: "5KFZEZ2|CAD", currency: "CAD", cashValue: 100, csvAsOfMs: 5_000 }],
      [{ clientCode: "5KFZE", asOfMs: 2_000, cashCad: 400 }],
      usdToCad,
    );
    assert.equal(cash.get("5KFZEZ2|CAD"), 100);
  });

  test("convertit l'ajustement dans la devise du compte", () => {
    const cash = favoriAdjustedCashByAccount(
      [{ accountKey: "5KFZEB7|USD", currency: "USD", cashValue: 100, csvAsOfMs: 1_000 }],
      [{ clientCode: "5KFZE", asOfMs: 2_000, cashCad: 280 }],
      usdToCad,
    );
    // 100 USD = 140 CAD ; l'encaisse officielle est 280 CAD → +140 CAD = +100 USD
    assert.equal(cash.get("5KFZEB7|USD"), 200);
  });

  test("ne touche pas un client sans capture favori", () => {
    const cash = favoriAdjustedCashByAccount(
      [{ accountKey: "5L3APY0|CAD", currency: "CAD", cashValue: 210, csvAsOfMs: 1_000 }],
      [],
      usdToCad,
    );
    assert.equal(cash.get("5L3APY0|CAD"), 210);
  });
});

});
