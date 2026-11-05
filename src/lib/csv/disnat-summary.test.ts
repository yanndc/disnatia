import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clientCodeFromDisnatHtml,
  clientCodeFromDisnatUrl,
  extractMoneyValues,
  parseDisnatSummaryHtml,
} from "./disnat-summary";

/** Extrait réel de la page « Vue d'ensemble » (ligne « Total des actifs »). */
const SUMMARY_SNIPPET = `<table><tbody><tr>
  <td class="dsd-ta-left" colspan="3"><span>Total des actifs</span></td>
  <td class="min-mobile dsd-ta-right"> 1.3977 </td>
  <td class="dsd-ta-right">1 527,54 CAD</td>
  <td class="min-mobile dsd-ta-right">247 530,27 CAD </td>
  <td class="dsd-ta-right">249 057,81 CAD</td>
</tr></tbody></table>`;

/** Vue d'ensemble d'**un seul client** : le tableau des comptes finit par une ligne « Total ». */
const SINGLE_CLIENT_SNIPPET = `<html><head><title>Vue d'ensemble</title></head><body>
<table class="dsd-table"><thead><tr><th>Compte</th><th>Liquidités</th><th>Valeur des titres</th><th>Valeur totale</th></tr></thead>
<tbody>
  <tr><td>REER (5KFZEU3)</td><td>1 200,00 CAD</td><td>120 000,00 CAD</td><td>121 200,00 CAD</td></tr>
  <tr><td>CRI (5KFZES7)</td><td>327,54 CAD</td><td>127 530,27 CAD</td><td>127 857,81 CAD</td></tr>
  <tr class="dsd-total"><td>Total</td><td>1 527,54 CAD</td><td>247 530,27 CAD</td><td>249 057,81 CAD</td></tr>
</tbody></table></body></html>`;

/** Même page, mais cellules rendues en `<div>` (grille React) au lieu de `<td>`. */
const DIV_CELLS_SNIPPET = `<div class="dsd-grid">
  <div class="dsd-row"><span>Total des actifs</span><span>1 527,54 CAD</span><span>247 530,27 CAD</span><span>249 057,81 CAD</span></div>
</div>`;

describe("parseDisnatSummaryHtml", () => {
  test("lit l'encaisse, les titres et le total de la ligne « Total des actifs »", () => {
    assert.deepEqual(parseDisnatSummaryHtml(SUMMARY_SNIPPET), {
      rate: 1.3977,
      cashCad: 1527.54,
      securitiesCad: 247530.27,
      totalCad: 249057.81,
    });
  });

  test("lit la ligne « Total » de la vue d'ensemble d'un client seul", () => {
    assert.deepEqual(parseDisnatSummaryHtml(SINGLE_CLIENT_SNIPPET), {
      rate: null,
      cashCad: 1527.54,
      securitiesCad: 247530.27,
      totalCad: 249057.81,
    });
  });

  test("lit une ligne de totaux rendue en <div>/<span>", () => {
    assert.deepEqual(parseDisnatSummaryHtml(DIV_CELLS_SNIPPET), {
      rate: null,
      cashCad: 1527.54,
      securitiesCad: 247530.27,
      totalCad: 249057.81,
    });
  });

  test("ignore une ligne « Total » sans identité comptable", () => {
    const html = `<tr><td>Total</td><td>1 000,00 CAD</td><td>2 000,00 CAD</td><td>4 000,00 CAD</td></tr>`;
    assert.equal(parseDisnatSummaryHtml(html), null);
  });

  test("retourne null hors page « Vue d'ensemble »", () => {
    assert.equal(parseDisnatSummaryHtml("<html><body>Historique</body></html>"), null);
  });
});

describe("extractMoneyValues", () => {
  test("ne retient que les montants à deux décimales", () => {
    assert.deepEqual(
      extractMoneyValues("Total des actifs 1.3977 | 1 527,54 CAD | 247 530,27 | 2026-10-30 | 5KFZES7"),
      [1527.54, 247530.27],
    );
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

describe("clientCodeFromDisnatHtml", () => {
  test("déduit le client unique d'une page mono-client", () => {
    assert.equal(
      clientCodeFromDisnatHtml(`<a href="?clientId=5KFZE&accountId=ALL">Mes comptes</a>`),
      "5KFZE",
    );
  });

  test("reste muet quand plusieurs clients cohabitent", () => {
    assert.equal(
      clientCodeFromDisnatHtml(`<a href="?clientId=5KFZE">a</a><a href="?clientId=5L3AP">b</a>`),
      null,
    );
  });
});

