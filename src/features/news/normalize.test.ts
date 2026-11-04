import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildExcerpt,
  canonicalizeUrl,
  classifyCategory,
  isNoisyFeedTitle,
  normalizeTitleForFingerprint,
  stripPublisherSuffix,
  titleFingerprint,
  truncateText,
} from "./normalize";

describe("canonicalizeUrl", () => {
  test("retire les paramètres de tracking, le fragment et le slash final", () => {
    assert.equal(
      canonicalizeUrl("https://www.Example.com/affaires/article/?utm_source=x&utm_medium=y&id=3#top"),
      "https://example.com/affaires/article?id=3",
    );
  });

  test("refuse les schémas non http(s)", () => {
    assert.equal(canonicalizeUrl("ftp://example.com/feed"), null);
    assert.equal(canonicalizeUrl("pas une url"), null);
  });

  test("deux URLs de tracking différentes convergent", () => {
    const a = canonicalizeUrl("https://example.com/a?fbclid=123");
    const b = canonicalizeUrl("https://example.com/a/");
    assert.equal(a, b);
  });
});

describe("titleFingerprint", () => {
  test("stable malgré accents, ponctuation et casse", () => {
    const url = "https://example.com/a";
    assert.equal(
      titleFingerprint("Les marchés québécois reculent", url),
      titleFingerprint("les marches quebecois reculent !", url),
    );
  });

  test("dépend du domaine (republication = empreinte différente)", () => {
    assert.notEqual(
      titleFingerprint("Inflation stable", "https://a.com/x"),
      titleFingerprint("Inflation stable", "https://b.com/x"),
    );
  });
});

describe("stripPublisherSuffix", () => {
  test("retire le suffixe d'agrégateur quand il correspond à l'éditeur", () => {
    assert.equal(
      stripPublisherSuffix("Les taux restent stables - Les Affaires", "Les Affaires"),
      "Les taux restent stables",
    );
  });

  test("conserve un titre sans suffixe", () => {
    assert.equal(stripPublisherSuffix("Hydro-Québec augmente ses tarifs"), "Hydro-Québec augmente ses tarifs");
  });
});

describe("buildExcerpt", () => {
  test("ignore un résumé identique au titre", () => {
    assert.equal(buildExcerpt("Inflation stable", "Inflation stable"), null);
  });

  test("tronque proprement", () => {
    const excerpt = buildExcerpt("Titre", `${"mot ".repeat(200)}fin`, 60);
    assert.ok(excerpt !== null);
    assert.ok(excerpt!.length <= 61);
    assert.ok(excerpt!.endsWith("…"));
  });
});

describe("truncateText", () => {
  test("ne coupe pas un mot", () => {
    assert.equal(truncateText("un deux trois quatre", 10), "un deux…");
  });
});

describe("classifyCategory", () => {
  test("détecte l'économie et les marchés", () => {
    assert.equal(classifyCategory("La Banque du Canada abaisse son taux directeur"), "ECONOMY");
    assert.equal(classifyCategory("Le TSX clôture en hausse avec les actions bancaires"), "MARKETS");
  });

  test("repli sur la catégorie du flux", () => {
    assert.equal(classifyCategory("Un titre sans mot-clé", "REAL_ESTATE"), "REAL_ESTATE");
  });
});

describe("normalizeTitleForFingerprint", () => {
  test("supprime accents et ponctuation", () => {
    assert.equal(normalizeTitleForFingerprint("Économie: Ça va?"), "economie ca va");
  });
});

describe("isNoisyFeedTitle", () => {
  test("filtre les titres de flux automatisés", () => {
    assert.equal(isNoisyFeedTitle("ETF Activity: SPY Leads With $4.28 Billion Inflow on Nov. 2"), true);
    assert.equal(isNoisyFeedTitle("SPDR S&P 500 ETF (SPY) Buys $297.0 Million More Apple"), true);
    assert.equal(isNoisyFeedTitle("Exchange-Traded Funds, Equity Futures Rise Pre-Bell Wednesday"), true);
  });

  test("conserve une vraie nouvelle", () => {
    assert.equal(isNoisyFeedTitle("La Banque du Canada maintient son taux directeur"), false);
    assert.equal(isNoisyFeedTitle("Apple publie des résultats trimestriels solides"), false);
  });
});
