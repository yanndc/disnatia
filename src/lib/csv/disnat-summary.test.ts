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

/**
 * Écran « Mes comptes » (`clientId=ALL`) : en-têtes d'encaisse et ligne « Vue d'ensemble »
 * par client, avec CAD empilé au-dessus du USD dans la même cellule.
 */
const MES_COMPTES_SNIPPET = `<html><head><title>Mes comptes</title></head><body>
<table class="dsd-cash">
  <thead><tr><td></td><th>Liquidités</th><th>Valeur des titres</th><th>Valeur totale</th><th>Variation</th><th>Marge</th></tr></thead>
  <tbody>
    <tr><td rowspan="2">Vue d'ensemble</td>
      <td>230,92 CAD<br>613,96 USD</td>
      <td>42 564,48 CAD<br>90 882,15 USD</td>
      <td>42 795,40 CAD<br>91 496,11 USD</td>
      <td>-2 107,66 CAD<br>-3 546,72 USD</td>
      <td>0,00 CAD<br>0,00 USD</td></tr>
  </tbody>
</table></body></html>`;

/** Même écran, mais une ligne par devise (le libellé est porté par un `rowspan`). */
const MES_COMPTES_TWO_ROWS_SNIPPET = `<html><head><title>Mes comptes</title></head><body>
<table class="dsd-cash">
  <thead><tr><td></td><th>Liquidités</th><th>Valeur des titres</th><th>Valeur totale</th><th>Variation</th><th>Marge</th></tr></thead>
  <tbody>
    <tr><td rowspan="2">Vue d'ensemble</td><td>230,92 CAD</td><td>42 564,48 CAD</td><td>42 795,40 CAD</td><td>-2 107,66 CAD</td><td>0,00 CAD</td></tr>
    <tr><td>613,96 USD</td><td>90 882,15 USD</td><td>91 496,11 USD</td><td>-3 546,72 USD</td><td>0,00 USD</td></tr>
  </tbody>
</table></body></html>`;

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

  test("lit la ligne « Vue d'ensemble » de l'écran « Mes comptes » (CAD empilé sur USD)", () => {
    assert.deepEqual(parseDisnatSummaryHtml(MES_COMPTES_SNIPPET), {
      rate: null,
      cashCad: 230.92,
      securitiesCad: 42564.48,
      totalCad: 42795.4,
    });
  });

  test("lit la même page quand chaque devise a sa propre ligne", () => {
    assert.deepEqual(parseDisnatSummaryHtml(MES_COMPTES_TWO_ROWS_SNIPPET), {
      rate: null,
      cashCad: 230.92,
      securitiesCad: 42564.48,
      totalCad: 42795.4,
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

  test("déduit le client des 5 premiers caractères des numéros de compte", () => {
    const html = `<table><tr><td>5KFZEY4</td><td>5KFZEZ2</td><td>5KFZEH4</td><td>2026</td></tr></table>`;
    assert.equal(clientCodeFromDisnatHtml(html), "5KFZE");
  });

  test("ignore les jetons numériques (dates, identifiants)", () => {
    assert.equal(clientCodeFromDisnatHtml(`<td>20261030</td><td>12345678</td>`), null);
  });

  test("reste muet quand plusieurs clients cohabitent", () => {
    assert.equal(
      clientCodeFromDisnatHtml(`<a href="?clientId=5KFZE">a</a><a href="?clientId=5L3AP">b</a>`),
      null,
    );
    assert.equal(clientCodeFromDisnatHtml(`<td>5KFZEY4</td><td>5L3APA5</td>`), null);
  });
});

