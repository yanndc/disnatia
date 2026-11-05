import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildDisnatBookmarklet } from "./disnat-bookmarklet";

describe("buildDisnatBookmarklet", () => {
  const href = buildDisnatBookmarklet("https://app.example.com/", "jeton-test");
  const code = href.replace(/^javascript:/, "");

  test("produit un script compilable, aplati sur une seule ligne", () => {
    assert.doesNotThrow(() => new Function(code));
    assert.ok(!code.includes("\n"));
    // Un commentaire `//` avalerait toute la suite après l'aplatissement.
    assert.ok(!code.includes(" //"));
  });

  test("reste 100 % ASCII (le favori est décodé avec le charset de la page Disnat)", () => {
    assert.ok(!/[^\x00-\x7F]/.test(href));
  });

  test("vise l'endpoint d'import avec le jeton et l'URL de la page", () => {
    assert.ok(code.includes("https://app.example.com/api/portfolio/import-session/page"));
    assert.ok(code.includes('"x-disnat-token":"jeton-test"'));
    assert.ok(code.includes("url:location.href"));
  });

  test("demande le code client et rejoue l'envoi quand le serveur le réclame", () => {
    assert.ok(code.includes("clientCode:clientCode"));
    assert.ok(code.includes('j.code==="CLIENT_REQUIRED"'));
    assert.ok(code.includes("disnatia.clientCode"));
  });

  test("ne propose pas la copie de secours sur un refus métier", () => {
    assert.ok(code.includes('j.code==="AGGREGATE_VIEW"'));
    assert.ok(code.includes('j.code==="MULTIPLE_CLIENTS"'));
  });

  test("résume un enregistrement réparti entre plusieurs clients", () => {
    assert.ok(code.includes("j.clients&&j.clients.length>0"));
    assert.ok(code.includes("c.clientCode"));
  });

  test("liste les comptes sans transaction sur la période", () => {
    assert.ok(code.includes("j.skippedAccounts"));
  });

  test("recopie aussi le contenu des iframes lisibles", () => {
    assert.ok(code.includes("contentDocument"));
  });
});
