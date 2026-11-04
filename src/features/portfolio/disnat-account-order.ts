/**
 * Ordre et regroupement des comptes « comme dans Disnat » (export Vue d'ensemble).
 *
 * Disnat affiche les propriétaires (du plus gros total au plus petit) puis, pour chacun,
 * les comptes par type : Comptant, CRI, REER, CELI, puis les variantes conjointes.
 * Les comptes d'un même type sont listés en CAD avant USD, puis par numéro de compte.
 *
 * Module pur (aucune dépendance serveur) : utilisable côté requête et côté UI.
 */

export type DisnatOrderableAccount = {
  owner: string | null;
  accountType: string | null;
  accountName: string;
  accountNumber: string | null;
  currency: string;
  totalValue: number;
};

/** Rang des types de compte dans l'ordre de l'export Disnat. */
const TYPE_ORDER: Array<{ label: string; rank: number }> = [
  { label: "comptant", rank: 10 },
  { label: "cri", rank: 20 },
  { label: "reer", rank: 30 },
  { label: "celi", rank: 40 },
  { label: "reee", rank: 50 },
  { label: "ferr", rank: 60 },
  { label: "compte non enregistre", rank: 70 },
  { label: "non enregistre", rank: 70 },
  // Variantes conjointes : après les comptes individuels.
  { label: "reer conjoint", rank: 80 },
  { label: "celi conjoint", rank: 85 },
  { label: "cri conjoint", rank: 90 },
  { label: "comptant conjoint", rank: 95 },
];

/** Correspondance par préfixe : les libellés les plus longs d'abord. */
const TYPE_ORDER_BY_LENGTH = [...TYPE_ORDER].sort(
  (a, b) => b.label.length - a.label.length,
);

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rang de tri d'un type de compte (10 = Comptant, …, 999 = inconnu). */
export function disnatAccountTypeRank(accountType: string | null | undefined): number {
  const key = normalize(accountType);
  if (!key) return 999;

  const exact = TYPE_ORDER.find((entry) => entry.label === key);
  if (exact) return exact.rank;

  // « REER conj. », « CELI conjoint 2 »… : la variante conjointe passe avant le type de base.
  const isJoint = key.includes("conj");
  if (isJoint) {
    if (key.includes("reer")) return 80;
    if (key.includes("celi")) return 85;
    if (key.includes("cri")) return 90;
    if (key.includes("comptant")) return 95;
  }

  const byPrefix = TYPE_ORDER_BY_LENGTH.find((entry) => key.startsWith(entry.label));
  return byPrefix ? byPrefix.rank : 999;
}

function currencyRank(currency: string): number {
  const cur = currency.trim().toUpperCase();
  if (cur === "CAD" || cur === "CAN" || cur === "CDN") return 0;
  if (cur === "USD" || cur === "US") return 1;
  return 2;
}

function ownerKey(account: DisnatOrderableAccount): string {
  return account.owner?.trim() || "";
}

/**
 * Trie les comptes dans l'ordre Disnat : propriétaire (total décroissant), type de compte,
 * devise (CAD d'abord), puis numéro de compte.
 */
export function sortAccountsLikeDisnat<T extends DisnatOrderableAccount>(accounts: T[]): T[] {
  const totals = new Map<string, number>();
  for (const account of accounts) {
    const key = ownerKey(account);
    totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(account.totalValue) ? account.totalValue : 0));
  }

  return [...accounts].sort((a, b) => {
    const ownerA = ownerKey(a);
    const ownerB = ownerKey(b);
    if (ownerA !== ownerB) {
      // Un propriétaire connu passe avant « sans propriétaire ».
      if (!ownerA) return 1;
      if (!ownerB) return -1;
      const diff = (totals.get(ownerB) ?? 0) - (totals.get(ownerA) ?? 0);
      if (Math.abs(diff) > 0.005) return diff;
      return ownerA.localeCompare(ownerB, "fr");
    }

    const rankDiff = disnatAccountTypeRank(a.accountType ?? a.accountName) -
      disnatAccountTypeRank(b.accountType ?? b.accountName);
    if (rankDiff !== 0) return rankDiff;

    const currencyDiff = currencyRank(a.currency) - currencyRank(b.currency);
    if (currencyDiff !== 0) return currencyDiff;

    const numberDiff = (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "");
    if (numberDiff !== 0) return numberDiff;

    return a.accountName.localeCompare(b.accountName, "fr");
  });
}

export type DisnatOwnerGroup<T extends DisnatOrderableAccount> = {
  owner: string | null;
  accounts: T[];
  totalValue: number;
};

/** Regroupe des comptes déjà triés par propriétaire, en conservant l'ordre Disnat. */
export function groupAccountsByOwnerLikeDisnat<T extends DisnatOrderableAccount>(
  sortedAccounts: T[],
): DisnatOwnerGroup<T>[] {
  const groups: DisnatOwnerGroup<T>[] = [];
  const byOwner = new Map<string, DisnatOwnerGroup<T>>();

  for (const account of sortedAccounts) {
    const key = ownerKey(account);
    let group = byOwner.get(key);
    if (!group) {
      group = { owner: account.owner?.trim() || null, accounts: [], totalValue: 0 };
      byOwner.set(key, group);
      groups.push(group);
    }
    group.accounts.push(account);
    group.totalValue += Number.isFinite(account.totalValue) ? account.totalValue : 0;
  }

  return groups;
}
