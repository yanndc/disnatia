import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { NewsPortfolioTicker } from "./news-portfolio";
import { buildTickerIndex, matchTickersInEntry } from "./ticker-matcher";

function ticker(partial: Partial<NewsPortfolioTicker> & { ticker: string }): NewsPortfolioTicker {
  return {
    ticker: partial.ticker,
    displayTicker: partial.displayTicker ?? partial.ticker.replace(/-(C|U|T)$/i, ""),
    stem: partial.stem ?? partial.ticker.replace(/-(C|U|T)$/i, ""),
    yahooSymbol: partial.yahooSymbol ?? `${partial.ticker.replace(/-(C|U|T)$/i, "")}.TO`,
    securityName: partial.securityName ?? null,
    sector: partial.sector ?? null,
    currency: partial.currency ?? "CAD",
    valueCad: partial.valueCad ?? 10_000,
    exposurePct: partial.exposurePct ?? 5,
  };
}

const index = buildTickerIndex([
  ticker({ ticker: "BCE-C", securityName: "BCE INC" }),
  ticker({ ticker: "RY-C", securityName: "ROYAL BANK OF CANADA" }),
  ticker({ ticker: "SHOP-C", securityName: "SHOPIFY INC" }),
]);

describe("buildTickerIndex", () => {
  test("prépare les jetons de nom et les alias", () => {
    const bce = index.find((entry) => entry.ticker === "BCE-C");
    assert.ok(bce);
    assert.ok(bce!.aliases.includes("Bell Canada"));
    assert.deepEqual(bce!.nameTokens, ["BCE"]);
    const ry = index.find((entry) => entry.ticker === "RY-C");
    assert.ok(ry!.nameTokens.includes("ROYAL"));
    assert.ok(ry!.nameTokens.includes("CANADA"));
  });
});

describe("matchTickersInEntry", () => {
  test("ticker explicite en majuscules → confiance maximale", () => {
    const matches = matchTickersInEntry({ title: "BCE annonce un dividende" }, index);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].ticker, "BCE-C");
    assert.equal(matches[0].matchKind, "TICKER");
    assert.equal(matches[0].confidence, 1);
  });

  test("alias éditorial reconnu (Bell Canada)", () => {
    const matches = matchTickersInEntry({ title: "Bell Canada réduit ses effectifs" }, index);
    assert.equal(matches[0]?.ticker, "BCE-C");
    assert.equal(matches[0]?.matchKind, "ALIAS");
  });

  test("nom de société multi-jetons reconnu", () => {
    const matches = matchTickersInEntry(
      { title: "Royal Bank of Canada publie ses résultats" },
      index,
    );
    assert.equal(matches[0]?.ticker, "RY-C");
    assert.ok(matches[0]!.confidence > 0.7);
  });

  test("aucun faux positif sur un mot courant", () => {
    const matches = matchTickersInEntry(
      { title: "Le marché ouvre en hausse ce matin" },
      index,
    );
    assert.equal(matches.length, 0);
  });

  test("respecte la limite de titres par article et trie par confiance", () => {
    const many = buildTickerIndex([
      ticker({ ticker: "BCE-C" }),
      ticker({ ticker: "RY-C" }),
      ticker({ ticker: "SHOP-C" }),
    ]);
    const matches = matchTickersInEntry(
      { title: "BCE, SHOP et RY progressent" },
      many,
      { maxMatches: 2 },
    );
    assert.equal(matches.length, 2);
    assert.ok(matches[0].confidence >= matches[1].confidence);
  });

  test("index vide → aucun match", () => {
    assert.deepEqual(matchTickersInEntry({ title: "BCE" }, []), []);
  });
});
