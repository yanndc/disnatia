import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseDisnatHoldingsByClient } from "./disnat-positions";

/** Extrait du tableau « Titres » (écran « Mes comptes ») : deux clients, CAD puis USD. */
const HOLDINGS = `<div class="title">ACTIONS détenu(e)s dans le(s) compte(s) en CAD</div>
<table><tbody>
  <tr class="odd">
    <td class="account-cell COLUMN_ACCOUNT" nowrap="nowrap" title="5KFZEY4">5KFZEY4</td>
    <td class="cell-symbol COLUMN_SYMBOL" title="ATD-C">ATD-C</td>
    <td class="market-value-cell COLUMN_MARKET_VALUE" nowrap="nowrap">42 916,57</td>
  </tr>
  <tr class="even">
    <td class="account-cell COLUMN_ACCOUNT" nowrap="nowrap" title="5L3APA5">5L3APA5</td>
    <td class="cell-symbol COLUMN_SYMBOL" title="BBD-B">BBD-B</td>
    <td class="market-value-cell COLUMN_MARKET_VALUE" nowrap="nowrap">58 234,76</td>
  </tr>
</tbody></table>
<div class="title">ACTIONS détenu(e)s dans le(s) compte(s) en USD</div>
<table><tbody>
  <tr class="odd">
    <td class="account-cell COLUMN_ACCOUNT" nowrap="nowrap" title="5KFZEY4">5KFZEY4</td>
    <td class="cell-symbol COLUMN_SYMBOL" title="SPY">SPY</td>
    <td class="market-value-cell COLUMN_MARKET_VALUE" nowrap="nowrap">65 629,96</td>
  </tr>
  <tr class="even">
    <td class="account-cell COLUMN_ACCOUNT" nowrap="nowrap" title="5L3APS7">5L3APS7</td>
    <td class="cell-symbol COLUMN_SYMBOL" title="AAPL">AAPL</td>
    <td class="market-value-cell COLUMN_MARKET_VALUE" nowrap="nowrap">5 315,56</td>
  </tr>
</tbody></table>`;

describe("parseDisnatHoldingsByClient", () => {
  test("additionne la valeur au marché par client, USD converti au taux de la page", () => {
    const totals = parseDisnatHoldingsByClient(HOLDINGS, 2);
    assert.equal(Math.round((totals.get("5KFZE") ?? 0) * 100) / 100, 174176.49);
    assert.equal(Math.round((totals.get("5L3AP") ?? 0) * 100) / 100, 68865.88);
  });

  test("sans taux, les montants USD sont pris tels quels", () => {
    const totals = parseDisnatHoldingsByClient(HOLDINGS, null);
    assert.equal(Math.round((totals.get("5KFZE") ?? 0) * 100) / 100, 108546.53);
  });

  test("ignore les lignes sans numéro de compte", () => {
    const html = `<div>ACTIONS détenu(e)s dans le(s) compte(s) en CAD</div>
      <table><tr><td class="COLUMN_MARKET_VALUE">1 000,00</td></tr></table>`;
    assert.equal(parseDisnatHoldingsByClient(html, 1.4).size, 0);
  });

  test("retourne une table vide sans tableau de titres", () => {
    assert.equal(parseDisnatHoldingsByClient("<html><body>Historique</body></html>", 1.4).size, 0);
  });
});
