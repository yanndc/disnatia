import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
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
});
