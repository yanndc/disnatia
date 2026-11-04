import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  disnatAccountTypeRank,
  groupAccountsByOwnerLikeDisnat,
  sortAccountsLikeDisnat,
  type DisnatOrderableAccount,
} from "./disnat-account-order";

type Row = DisnatOrderableAccount & { accountKey: string };

function row(partial: Partial<Row> & { accountKey: string }): Row {
  return {
    accountKey: partial.accountKey,
    owner: partial.owner ?? null,
    accountType: partial.accountType ?? null,
    accountName: partial.accountName ?? partial.accountType ?? "Compte",
    accountNumber: partial.accountNumber ?? null,
    currency: partial.currency ?? "CAD",
    totalValue: partial.totalValue ?? 0,
  };
}

describe("disnatAccountTypeRank", () => {
  test("respecte l'ordre Disnat : Comptant, CRI, REER, CELI, puis conjoints", () => {
    const ranks = ["Comptant", "CRI", "REER", "CELI", "REER conjoint"].map(
      disnatAccountTypeRank,
    );
    assert.deepEqual([...ranks].sort((a, b) => a - b), ranks);
  });

  test("tolère accents, casse et variantes abrégées", () => {
    assert.equal(disnatAccountTypeRank("comptant"), disnatAccountTypeRank("Comptant"));
    assert.equal(disnatAccountTypeRank("CÉLI"), disnatAccountTypeRank("CELI"));
    assert.equal(disnatAccountTypeRank("REER conj."), disnatAccountTypeRank("REER conjoint"));
    assert.equal(disnatAccountTypeRank("Inconnu"), 999);
  });
});

describe("sortAccountsLikeDisnat", () => {
  const accounts: Row[] = [
    row({ accountKey: "y-celi-cad", owner: "Yann", accountType: "CELI", currency: "CAD", totalValue: 29_858 }),
    row({ accountKey: "y-reer-usd", owner: "Yann", accountType: "REER", currency: "USD", totalValue: 59_633 }),
    row({ accountKey: "y-comptant-cad", owner: "Yann", accountType: "Comptant", currency: "CAD", totalValue: 0 }),
    row({ accountKey: "y-cri-usd", owner: "Yann", accountType: "CRI", currency: "USD", totalValue: 32_477 }),
    row({ accountKey: "v-reer-conjoint-cad", owner: "Valérie", accountType: "REER conjoint", currency: "CAD", totalValue: 60_053 }),
    row({ accountKey: "v-comptant-usd", owner: "Valérie", accountType: "Comptant", currency: "USD", totalValue: 0 }),
  ];

  test("propriétaires triés par total décroissant", () => {
    const sorted = sortAccountsLikeDisnat(accounts);
    assert.equal(sorted[0].owner, "Yann");
    assert.equal(sorted[sorted.length - 1].owner, "Valérie");
  });

  test("types dans l'ordre Disnat puis CAD avant USD", () => {
    const sorted = sortAccountsLikeDisnat(accounts).filter((a) => a.owner === "Yann");
    assert.deepEqual(
      sorted.map((a) => a.accountKey),
      ["y-comptant-cad", "y-cri-usd", "y-reer-usd", "y-celi-cad"],
    );
  });

  test("ne mute pas la liste d'origine", () => {
    const original = [...accounts];
    sortAccountsLikeDisnat(accounts);
    assert.deepEqual(accounts, original);
  });

  test("un compte sans propriétaire passe en dernier", () => {
    const sorted = sortAccountsLikeDisnat([
      row({ accountKey: "orphelin", owner: null, accountType: "Comptant", totalValue: 9_999_999 }),
      row({ accountKey: "y", owner: "Yann", accountType: "CELI", totalValue: 1 }),
    ]);
    assert.equal(sorted[sorted.length - 1].accountKey, "orphelin");
  });
});

describe("groupAccountsByOwnerLikeDisnat", () => {
  test("regroupe et additionne les soldes par propriétaire", () => {
    const groups = groupAccountsByOwnerLikeDisnat(
      sortAccountsLikeDisnat([
        row({ accountKey: "a", owner: "Yann", accountType: "Comptant", totalValue: 100 }),
        row({ accountKey: "b", owner: "Yann", accountType: "REER", totalValue: 50 }),
        row({ accountKey: "c", owner: "Valérie", accountType: "CELI", totalValue: 10 }),
      ]),
    );
    assert.equal(groups.length, 2);
    assert.equal(groups[0].owner, "Yann");
    assert.equal(groups[0].totalValue, 150);
    assert.equal(groups[0].accounts.length, 2);
    assert.equal(groups[1].owner, "Valérie");
    assert.equal(groups[1].totalValue, 10);
  });
});
