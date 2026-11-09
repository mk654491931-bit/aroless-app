import { describe, expect, it } from "vitest";
import {
  cleanFeedText,
  classifyNewsImpact,
  inferNewsCategory,
  newsTimeAgo,
  parseNewsFeed,
  type FreeNewsFeed,
} from "./news-rss.server";

const FEED: FreeNewsFeed = {
  id: "test",
  name: "Test Retail",
  url: "https://example.com/feed",
  category: "Perakende",
};

const NOW = Date.parse("2026-11-09T12:00:00Z");

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[Amazon raises FBA fees &amp; changes returns policy]]></title>
    <link>https://example.com/fba-fees</link>
    <pubDate>Mon, 09 Nov 2026 09:00:00 GMT</pubDate>
    <description><![CDATA[<p>Amazon <b>raised</b> fulfillment fees for large items.</p>]]></description>
  </item>
  <item>
    <title>New shipping route opens</title>
    <link>https://example.com/shipping</link>
    <pubDate>Sun, 08 Nov 2026 09:00:00 GMT</pubDate>
    <description>Carriers add a weekly service.</description>
  </item>
  <item>
    <title>Old news</title>
    <link>https://example.com/old</link>
    <pubDate>Mon, 09 Nov 2020 09:00:00 GMT</pubDate>
    <description>Should be filtered.</description>
  </item>
</channel></rss>`;

describe("ücretsiz RSS haber ayrıştırıcısı", () => {
  it("gerçek başlık, URL, tarih ve temiz özet üretir", () => {
    const items = parseNewsFeed(RSS, FEED, NOW);
    expect(items).toHaveLength(2);
    expect(items[0].title).toContain("Amazon raises FBA fees");
    expect(items[0].url).toBe("https://example.com/fba-fees");
    expect(items[0].date).toBe("2026-11-09");
    expect(items[0].summary).toContain("fulfillment fees");
    expect(items[0].summary).not.toContain("<b>");
    expect(items[0].impact).toBe("high");
    expect(items[0].category).toBe("Pazaryeri");
    expect(items[0].ai).toBe(false);
  });

  it("14 günden eski kayıtları eler", () => {
    expect(parseNewsFeed(RSS, FEED, NOW).some((item) => item.title === "Old news")).toBe(false);
  });

  it("HTML/CDATA temizliği ve entity çözümü yapar", () => {
    expect(cleanFeedText("<![CDATA[<p>A &amp; B</p>]]>")).toBe("A & B");
  });

  it("etki ve kategori sınıflandırması metne bağlıdır", () => {
    expect(classifyNewsImpact("New tariff on imports")).toBe("high");
    expect(classifyNewsImpact("Marketplace launches a new tool")).toBe("medium");
    expect(classifyNewsImpact("A quiet week")).toBe("low");
    expect(inferNewsCategory("Port strike delays freight", "Perakende")).toBe("Lojistik");
    expect(inferNewsCategory("Amazon seller fees", "Perakende")).toBe("Pazaryeri");
    expect(inferNewsCategory("Something unrelated", "Perakende")).toBe("Perakende");
  });

  it("göreli zamanı okunabilir üretir", () => {
    expect(newsTimeAgo(new Date("2026-11-09T11:30:00Z"), NOW)).toBe("30 dk önce");
    expect(newsTimeAgo(new Date("2026-11-09T09:00:00Z"), NOW)).toBe("3 saat önce");
    expect(newsTimeAgo(new Date("2026-11-07T12:00:00Z"), NOW)).toBe("2 gün önce");
  });
});
