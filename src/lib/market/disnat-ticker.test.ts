import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  disnatTickerToYahooSymbol,
  normalizeDisnatTickerForPortfolio,
} from "./disnat-ticker";

describe("normalizeDisnatTickerForPortfolio", () => {
  test("titre US acheté en USD → clé -U", () => {
    assert.equal(normalizeDisnatTickerForPortfolio("AMZN", "USD"), "AMZN-U");
    assert.equal(normalizeDisnatTickerForPortfolio("AMZN-U", "USD"), "AMZN-U");
  });

  test("ligne -C d'un titre US (fractionnement en compte CAD) ne crée pas de clé fantôme -C-U", () => {
    assert.equal(normalizeDisnatTickerForPortfolio("AMZN-C", "USD"), "AMZN-U");
    assert.equal(normalizeDisnatTickerForPortfolio("AAPL-C", "USD"), "AAPL-U");
  });

  test("titre TSX reste en -C", () => {
    assert.equal(normalizeDisnatTickerForPortfolio("AMZN-C", "CAD"), "AMZN-C");
    assert.equal(normalizeDisnatTickerForPortfolio("NVDA-C", "CAD"), "NVDA-C");
    assert.equal(normalizeDisnatTickerForPortfolio("BBD.B-C", "CAD"), "BBD.B-C");
  });
});

describe("disnatTickerToYahooSymbol", () => {
  test("titre US en USD → symbole US sans suffixe boursier", () => {
    assert.equal(disnatTickerToYahooSymbol("AMZN-U", "USD"), "AMZN");
    assert.equal(disnatTickerToYahooSymbol("AMZN", "USD"), "AMZN");
  });

  test("titre CAD → cote TSX", () => {
    assert.equal(disnatTickerToYahooSymbol("AMZN-C", "CAD"), "AMZN.TO");
    assert.equal(disnatTickerToYahooSymbol("BBD.B-C", "CAD"), "BBD-B.TO");
    assert.equal(disnatTickerToYahooSymbol("HISA-C", "CAD"), "HISA.NE");
  });
});
