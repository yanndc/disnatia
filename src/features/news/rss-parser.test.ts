import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseFeedXml, parseFeedDate, htmlToText } from "./rss-parser";

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Les Affaires</title>
    <item>
      <title><![CDATA[La Banque du Canada maintient son taux directeur]]></title>
      <link>https://www.lesaffaires.com/article/123?utm_source=rss</link>
      <description><![CDATA[<p>Décision attendue par les marchés.</p>]]></description>
      <pubDate>Wed, 05 Nov 2025 13:05:00 +0000</pubDate>
      <dc:creator>Marie Tremblay</dc:creator>
      <enclosure url="https://cdn.example.com/img.jpg" type="image/jpeg" />
    </item>
    <item>
      <title>Shopify dépasse les attentes</title>
      <link>https://example.com/shopify</link>
      <description>Résultats trimestriels supérieurs.</description>
    </item>
  </channel>
</rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Flux Atom</title>
  <entry>
    <title>Le TSX gagne du terrain</title>
    <link rel="alternate" href="https://example.com/tsx" />
    <link rel="self" href="https://example.com/feed" />
    <summary>Les banques mènent la hausse.</summary>
    <updated>2025-11-05T14:30:00Z</updated>
    <author><name>Jean Roy</name></author>
  </entry>
</feed>`;

const RDF_SAMPLE = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://www.bankofcanada.ca/feed"><title>Bank of Canada</title></channel>
  <item rdf:about="https://www.bankofcanada.ca/notice">
    <title>Policy rate maintained</title>
    <link>https://www.bankofcanada.ca/notice</link>
    <dc:date>2025-11-05T15:00:00Z</dc:date>
    <description>Rate announcement.</description>
  </item>
</rdf:RDF>`;

describe("parseFeedXml — RSS 2.0", () => {
  test("extrait titre de canal, deux articles et métadonnées", () => {
    const feed = parseFeedXml(RSS_SAMPLE);
    assert.equal(feed.format, "rss");
    assert.equal(feed.feedTitle, "Les Affaires");
    assert.equal(feed.entries.length, 2);
    const [first, second] = feed.entries;
    assert.equal(first.title, "La Banque du Canada maintient son taux directeur");
    assert.equal(first.url, "https://www.lesaffaires.com/article/123?utm_source=rss");
    assert.equal(first.summary, "Décision attendue par les marchés.");
    assert.equal(first.author, "Marie Tremblay");
    assert.equal(first.imageUrl, "https://cdn.example.com/img.jpg");
    assert.ok(first.publishedAt instanceof Date);
    assert.equal(first.publishedAt?.toISOString(), "2025-11-05T13:05:00.000Z");
    assert.equal(second.url, "https://example.com/shopify");
    assert.equal(second.publishedAt, undefined);
  });
});

describe("parseFeedXml — Atom", () => {
  test("préfère le lien rel=alternate et lit <updated>", () => {
    const feed = parseFeedXml(ATOM_SAMPLE);
    assert.equal(feed.format, "atom");
    assert.equal(feed.entries.length, 1);
    assert.equal(feed.entries[0].url, "https://example.com/tsx");
    assert.equal(feed.entries[0].publishedAt?.toISOString(), "2025-11-05T14:30:00.000Z");
    assert.equal(feed.entries[0].summary, "Les banques mènent la hausse.");
  });
});

describe("parseFeedXml — RSS 1.0 (RDF)", () => {
  test("lit les items RDF et la date dc:date", () => {
    const feed = parseFeedXml(RDF_SAMPLE);
    assert.equal(feed.format, "rdf");
    assert.equal(feed.entries.length, 1);
    assert.equal(feed.entries[0].url, "https://www.bankofcanada.ca/notice");
    assert.equal(feed.entries[0].publishedAt?.toISOString(), "2025-11-05T15:00:00.000Z");
  });
});

describe("parseFeedXml — cas limites", () => {
  test("document sans item → aucune entrée", () => {
    const feed = parseFeedXml("<rss><channel><title>Vide</title></channel></rss>");
    assert.equal(feed.entries.length, 0);
  });

  test("ignore un item sans titre ou sans lien", () => {
    const feed = parseFeedXml(
      "<rss><channel><item><description>orphelin</description></item></channel></rss>",
    );
    assert.equal(feed.entries.length, 0);
  });
});

describe("htmlToText et parseFeedDate", () => {
  test("décode CDATA, entités et retire les balises", () => {
    assert.equal(
      htmlToText("<![CDATA[<p>Hausse&nbsp;de 2&#37; &amp; plus</p>]]>"),
      "Hausse de 2% & plus",
    );
  });

  test("parse RFC 822 et ISO 8601", () => {
    assert.equal(parseFeedDate("Wed, 05 Nov 2025 13:05:00 +0000")?.toISOString(), "2025-11-05T13:05:00.000Z");
    assert.equal(parseFeedDate("2025-11-05T15:00:00Z")?.toISOString(), "2025-11-05T15:00:00.000Z");
    assert.equal(parseFeedDate("pas une date"), null);
    assert.equal(parseFeedDate(null), null);
  });
});
