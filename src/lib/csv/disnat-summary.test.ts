import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clientCodeFromDisnatUrl, parseDisnatSummaryHtml } from "./disnat-summary";

/** Extrait réel de la page « Vue d'ensemble » (ligne « Total des actifs »). */
const SUMMARY_SNIPPET = `<table><tbody><tr>
  <td class="dsd-ta-left" colspan="3"><span>Total des actifs</span></td>
  <td class="min-mobile dsd-ta-right"> 1.3977 </td>
  <td class="dsd-ta-right">1 527,54 CAD</td>
  <td class="min-mobile dsd-ta-right">247 530,27 CAD </td>
  <td class="dsd-ta-right">249 057,81 CAD</td>
</tr></tbody></table>`;

describe("parseDisnatSummaryHtml", () => {
  test("lit l'encaisse, les titres et le total de la ligne « Total des actifs »", () => {
    assert.deepEqual(parseDisnatSummaryHtml(SUMMARY_SNIPPET), {
      rate: 1.3977,
      cashCad: 1527.54,
      securitiesCad: 247530.27,
      totalCad: 249057.81,
    });
  });

  test("retourne null hors page « Vue d'ensemble »", () => {
    assert.equal(parseDisnatSummaryHtml("<html><body>Historique</body></html>"), null);
  });
});

describe("clientCodeFromDisnatUrl", () => {
  test("extrait le code client", () => {
    assert.equal(
      clientCodeFromDisnatUrl("https://tmw.secure.vmd.ca/fr?clientId=5KFZE&accountId=ALL"),
      "5KFZE",
    );
  });

  test("ignore « ALL »", () => {
    assert.equal(clientCodeFromDisnatUrl("https://tmw.secure.vmd.ca/fr?clientId=ALL"), null);
  });
});
