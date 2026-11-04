import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeRelevanceScore, NEWS_SCORE_WEIGHTS, relevanceTone } from "./relevance";

const base = {
  exposurePct: 0,
  hoursOld: 0,
  matchConfidence: 0,
  sourceWeight: 1,
  category: "OTHER" as const,
};

describe("computeRelevanceScore", () => {
  test("reste borné entre 0 et 100", () => {
    const max = computeRelevanceScore({
      exposurePct: 100,
      hoursOld: 0,
      matchConfidence: 1,
      sourceWeight: 2,
      category: "MARKETS",
    });
    assert.ok(max <= 100 && max >= 0);
    assert.equal(max, 100);
  });

  test("un titre non rattaché et ancien score nettement moins", () => {
    const fresh = computeRelevanceScore({ ...base, category: "MARKETS", hoursOld: 1 });
    const old = computeRelevanceScore({ ...base, category: "MARKETS", hoursOld: 240 });
    assert.ok(fresh > old);
    assert.ok(old < fresh * 0.4);
  });

  test("l'exposition portefeuille domine : 20 % pèsent le maximum d'exposition", () => {
    const small = computeRelevanceScore({ ...base, exposurePct: 1, matchConfidence: 1 });
    const large = computeRelevanceScore({ ...base, exposurePct: 20, matchConfidence: 1 });
    assert.ok(large - small > NEWS_SCORE_WEIGHTS.exposure * 0.8);
  });

  test("plafonne l'exposition au-delà du seuil", () => {
    const at20 = computeRelevanceScore({ ...base, exposurePct: 20, matchConfidence: 1 });
    const at90 = computeRelevanceScore({ ...base, exposurePct: 90, matchConfidence: 1 });
    assert.equal(at20, at90);
  });

  test("fraîcheur : demi-vie de 48 h", () => {
    const now = computeRelevanceScore({ ...base, category: "MARKETS" });
    const half = computeRelevanceScore({ ...base, category: "MARKETS", hoursOld: 48 });
    const recencyOnly = NEWS_SCORE_WEIGHTS.recency + NEWS_SCORE_WEIGHTS.source + NEWS_SCORE_WEIGHTS.category;
    assert.ok(now > half);
    assert.ok(Math.abs(now - half - NEWS_SCORE_WEIGHTS.recency / 2) < 0.2, `${now} ${half}`);
    assert.ok(recencyOnly > 0);
  });
});

describe("relevanceTone", () => {
  test("trois paliers", () => {
    assert.equal(relevanceTone(80), "high");
    assert.equal(relevanceTone(40), "medium");
    assert.equal(relevanceTone(5), "low");
  });
});
