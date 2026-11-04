import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clientCodeFromAccountKey,
  parseDisnatReferenceCsv,
  reconciliationTone,
} from "./performance-reconciliation";

describe("clientCodeFromAccountKey", () => {
  test("extrait le préfixe client du numéro de compte", () => {
    assert.equal(clientCodeFromAccountKey("5KFZEA9|CAD"), "5KFZE");
    assert.equal(clientCodeFromAccountKey("5L3APY0|CAD"), "5L3AP");
    assert.equal(clientCodeFromAccountKey(""), "");
  });
});

describe("reconciliationTone", () => {
  test("paliers d'écart en points de %", () => {
    assert.equal(reconciliationTone(0.2), "ok");
    assert.equal(reconciliationTone(-0.4), "ok");
    assert.equal(reconciliationTone(1.2), "warning");
    assert.equal(reconciliationTone(-3), "error");
    assert.equal(reconciliationTone(null), "unknown");
  });
});

describe("parseDisnatReferenceCsv", () => {
  test("lit le tableau Disnat collé (tabulations, virgules, %)", () => {
    const csv = [
      "Client\t1 mois\t3 mois\t1 an\t3 ans\tAnnée à date\tDepuis le début*",
      "5KFZE\t1,47 %\t1,19 %\t19,99 %\t25,97 %\t15,84 %\t22,80 %",
      "5L3AP\t2,41 %\t2,48 %\t20,64 %\t-\t18,12 %\t24,70 %",
    ].join("\n");
    const { rows, errors } = parseDisnatReferenceCsv(csv);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 11);
    assert.deepEqual(rows[0], { clientCode: "5KFZE", period: "MONTH", valuePct: 1.47 });
    assert.deepEqual(
      rows.filter((row) => row.clientCode === "5L3AP").map((row) => row.period),
      ["MONTH", "MONTH3", "YEAR", "YTD", "ALL"],
    );
  });

  test("accepte le point-virgule et signale les lignes illisibles", () => {
    const { rows, errors } = parseDisnatReferenceCsv(
      ["5KFZE;1,47;1,19", "ligne parasite"].join("\n"),
    );
    assert.equal(rows.length, 2);
    assert.equal(errors.length, 1);
  });
});
