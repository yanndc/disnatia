import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeDisnatPage } from "./disnat-diagnostics";

const HISTORY_PAGE = `<html><head><title>Portefeuille</title></head><body>
<div class="asset-title"> Vue d'ensemble () </div>
<div class="asset-title"> REER (5KFZEU3) </div>
<div row-index="0" class="ag-row">…</div>
<div row-index="1" class="ag-row">…</div>
</body></html>`;

const EMPTY_SHELL = `<html><head><title>Disnat</title></head><body><div id="root"></div></body></html>`;

describe("describeDisnatPage", () => {
  test("relève les sections de compte et les lignes de grille", () => {
    const result = describeDisnatPage(HISTORY_PAGE, "https://tmw.secure.vmd.ca/fr?clientId=5KFZE");
    assert.equal(result.title, "Portefeuille");
    assert.equal(result.clientId, "5KFZE");
    assert.deepEqual(result.assetTitles, ["Vue d'ensemble ()", "REER (5KFZEU3)"]);
    assert.equal(result.gridRows, 2);
    assert.equal(result.totalRowLabel, null);
    assert.match(result.hint, /2 section\(s\)/);
    assert.match(result.hint, /grille 2 ligne\(s\)/);
  });

  test("signale une page sans contenu (coquille vide, cadre non capturé)", () => {
    const result = describeDisnatPage(EMPTY_SHELL, "https://tmw.secure.vmd.ca/fr?clientId=ALL");
    assert.deepEqual(result.assetTitles, []);
    assert.equal(result.gridRows, 0);
    assert.equal(result.clientId, null);
    assert.match(result.hint, /aucune section de compte/);
    assert.match(result.hint, /aucune ligne de totaux/);
  });

  test("relève la ligne de totaux et ses montants", () => {
    const html = `<tr class="dsd-total"><td>Total</td><td>1 527,54 CAD</td><td>247 530,27 CAD</td><td>249 057,81 CAD</td></tr>`;
    const result = describeDisnatPage(html, "");
    assert.equal(result.totalRowLabel, "Total 1 527,54 CAD 247 530,27 CAD 249 057,81 CAD");
    assert.deepEqual(result.totalRowValues, [1527.54, 247530.27, 249057.81]);
    assert.match(result.hint, /totaux « Total/);
  });

  test("joint un extrait du texte visible, sans le script inline", () => {
    const html = `<html><body><script>var x = 1 < 2;</script><h1>Mes comptes</h1><p>Titres</p></body></html>`;
    const result = describeDisnatPage(html);
    assert.equal(result.textSample, "Mes comptes Titres");
    assert.match(result.hint, /texte « Mes comptes Titres »/);
  });
});
