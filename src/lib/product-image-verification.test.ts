/**
 * ÜRÜN GÖRSELİ DOĞRULAMA — saf birim testleri (ağ YOK, anahtar YOK).
 *
 * Kapsanan davranışlar:
 *   • stok/yer tutucu görsel servislerinin reddi
 *   • logo / ikon / sprite / banner / avatar desenlerinin reddi
 *   • JSON-LD → ürün `<img>` → og:image öncelik sırası
 *   • BİLİNEN küçük boyutun reddi (bilinmeyen boyutun ELENMEMESİ)
 *   • aynı görselin iki üründe görülmesi hâlinde reddi
 *   • doğrulanamayan durumda `imageUrl` alanının `null` kalması
 */
import { describe, expect, it } from "vitest";

import {
  canonicalImageUrl,
  classifyImageUrl,
  declaredImageEdge,
  extractProductImageCandidates,
  findSharedImageUrls,
  isSameImage,
  isVerifiedImage,
  MIN_PRODUCT_IMAGE_EDGE,
  resolveVerifiedImageFromHtml,
  unverifiedImage,
  validateImageCandidate,
} from "./product-image-verification";

describe("classifyImageUrl — yapısal eleme", () => {
  it("boş/bozuk adresi eler", () => {
    expect(classifyImageUrl("")).toBe("rejected_malformed_url");
    expect(classifyImageUrl("   ")).toBe("rejected_malformed_url");
    expect(classifyImageUrl("not a url")).toBe("rejected_malformed_url");
    expect(classifyImageUrl(undefined)).toBe("rejected_malformed_url");
  });

  it("http olmayan protokolü eler", () => {
    expect(classifyImageUrl("ftp://example.test/a.jpg")).toBe("rejected_non_http");
    expect(classifyImageUrl("javascript:alert(1)")).toBe("rejected_non_http");
    // Satır içi dekoratif ikonlar ürün fotoğrafı değildir.
    expect(classifyImageUrl("data:image/png;base64,AAAA")).toBe("rejected_logo_or_asset");
  });

  it("STOK GÖRSEL SERVİSLERİNİ eler (yer tutucu fotoğraf asla ürün görseli değil)", () => {
    for (const host of [
      "https://placehold.co/600x600.png",
      "https://via.placeholder.com/600",
      "https://dummyimage.com/600x600",
      "https://loremflickr.com/600/600/lamp",
      "https://picsum.photos/600",
      "https://placekitten.com/600/600",
    ]) {
      expect(classifyImageUrl(host)).toBe("rejected_placeholder_host");
    }
  });

  it("logo / ikon / sprite / banner / avatar desenlerini eler", () => {
    for (const url of [
      "https://shop.test/assets/logo.svg",
      "https://cdn.test/static/img/icons/cart.png",
      "https://cdn.test/sprite/icons.png",
      "https://cdn.test/img/banner-hero.jpg",
      "https://cdn.test/user/avatar.png",
      "https://cdn.test/favicon.ico",
      "https://cdn.test/img/placeholder-product.png",
      "https://cdn.test/assets/watermark.png",
    ]) {
      expect(classifyImageUrl(url)).toBe("rejected_logo_or_asset");
    }
  });

  it("izleme pikselini eler", () => {
    expect(classifyImageUrl("https://cdn.test/track/pixel.gif")).toBe("rejected_tracking_pixel");
    expect(classifyImageUrl("https://cdn.test/analytics/beacon.png")).toBe(
      "rejected_tracking_pixel",
    );
  });

  it("gerçek ürün fotoğrafı adresini GEÇİRİR", () => {
    expect(classifyImageUrl("https://cdn.test/images/products/air-fryer-main.jpg")).toBeNull();
    expect(classifyImageUrl("https://m.media-amazon.com/images/I/air-fryer.jpg")).toBeNull();
  });
});

describe("canonicalImageUrl", () => {
  it("boyut/format parametrelerini atar (aynı görsel iki adres sanılmasın)", () => {
    const a = canonicalImageUrl("https://cdn.test/p.jpg?w=400&q=80");
    const b = canonicalImageUrl("https://cdn.test/p.jpg?w=1200&q=60");
    expect(a).toBe("https://cdn.test/p.jpg");
    expect(a).toBe(b);
    expect(isSameImage(a, b)).toBe(true);
  });

  it("farklı görselleri farklı tutar", () => {
    expect(isSameImage("https://cdn.test/a.jpg", "https://cdn.test/b.jpg")).toBe(false);
    expect(isSameImage("https://cdn.test/a.jpg", null)).toBe(false);
  });

  it("göreli adresi sayfa adresine göre mutlaklaştırır", () => {
    expect(canonicalImageUrl("/img/p.jpg", "https://shop.test/urun/x")).toBe(
      "https://shop.test/img/p.jpg",
    );
  });
});

describe("extractProductImageCandidates — öncelik merdiveni", () => {
  const html = `
    <html><head>
      <meta property="og:image" content="https://shop.test/og.jpg">
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Product","name":"Air Fryer",
         "image":["https://cdn.test/jsonld-main.jpg","https://cdn.test/jsonld-2.jpg"]}
      </script>
    </head><body>
      <img class="product-image" src="https://cdn.test/page-main.jpg" width="800" height="800">
      <img class="header-logo" src="https://cdn.test/assets/logo.svg">
    </body></html>`;

  it("JSON-LD → sayfa `<img>` → og:image sırasını korur", () => {
    const candidates = extractProductImageCandidates(html, {
      productUrl: "https://shop.test/urun/air-fryer",
    });
    expect(candidates.map((c) => c.source)).toEqual([
      "jsonld_product",
      "jsonld_product",
      "product_img",
      "og_image",
    ]);
    expect(candidates[0]!.url).toBe("https://cdn.test/jsonld-main.jpg");
    // Logo ASLA aday olmaz.
    expect(candidates.some((c) => c.url.includes("logo"))).toBe(false);
  });

  it("JSON-LD tek nesne (`image` string) biçimini de okur", () => {
    const single = `<script type="application/ld+json">
      {"@type":"Product","name":"X","image":"https://cdn.test/only.jpg"}</script>`;
    expect(extractProductImageCandidates(single)[0]).toEqual({
      url: "https://cdn.test/only.jpg",
      source: "jsonld_product",
    });
  });

  it("JSON-LD içinde `image.url` nesnesi biçimini de okur", () => {
    const nested = `<script type="application/ld+json">
      {"@type":"Product","name":"X","image":{"url":"https://cdn.test/nested.jpg"}}</script>`;
    expect(extractProductImageCandidates(nested)[0]!.url).toBe("https://cdn.test/nested.jpg");
  });

  it("bozuk JSON-LD bloğu tüm sayfayı çökertmez", () => {
    const broken = `<script type="application/ld+json">{bozuk</script>
      <meta property="og:image" content="https://shop.test/og.jpg">`;
    expect(extractProductImageCandidates(broken)[0]!.source).toBe("og_image");
  });
});

describe("declaredImageEdge", () => {
  it("BİLİNEN küçük boyutu bildirir", () => {
    expect(declaredImageEdge(32, 32)).toBe(32);
    expect(declaredImageEdge("64", "64")).toBe(64);
  });

  it("bilinmeyen boyutu `null` döner (eleme yapılmaz)", () => {
    expect(declaredImageEdge(undefined, undefined)).toBeNull();
    expect(declaredImageEdge(0, 0)).toBeNull();
  });
});

describe("validateImageCandidate", () => {
  it("geçerli adresi doğrulanmış işaretler ve KAYNAĞINI korur", () => {
    const result = validateImageCandidate("https://cdn.test/p/air-fryer.jpg", {
      source: "jsonld_product",
    });
    expect(result.imageUrl).toBe("https://cdn.test/p/air-fryer.jpg");
    expect(result.imageSource).toBe("jsonld_product");
    expect(result.imageValidationStatus).toBe("verified_jsonld_product");
    expect(isVerifiedImage(result.imageValidationStatus)).toBe(true);
  });

  it("BİLİNEN küçük boyutu eler", () => {
    const result = validateImageCandidate("https://cdn.test/p/thumb.jpg", {
      source: "product_img",
      declaredEdge: MIN_PRODUCT_IMAGE_EDGE - 20,
    });
    expect(result.imageUrl).toBeNull();
    expect(result.imageValidationStatus).toBe("rejected_too_small");
  });

  it("bilinmeyen boyutu elemez (CDN `srcset` kullanır, attribute yoktur)", () => {
    const result = validateImageCandidate("https://cdn.test/products/air-fryer-unit.jpg", {
      source: "product_img",
      declaredEdge: null,
    });
    expect(result.imageUrl).toBe("https://cdn.test/products/air-fryer-unit.jpg");
  });

  it("BİLİNEN küçük boyut elenirken BİLİNMEYEN boyut geçer", () => {
    // "hero/banner/logo" gibi adlar gerçekten ürün fotoğrafı değildir; ama
    // nötr bir yol + boyut bildirilmemişse elenmez.
    expect(validateImageCandidate("https://cdn.test/hero.jpg").imageUrl).toBeNull();
    expect(
      validateImageCandidate("https://cdn.test/hero.jpg", { declaredEdge: null }).imageUrl,
    ).toBeNull();
    expect(
      validateImageCandidate("https://cdn.test/unit.jpg", { declaredEdge: null }).imageUrl,
    ).toBe("https://cdn.test/unit.jpg");
  });

  it("başka üründe de görülen görseli eler (kopya tespiti)", () => {
    const result = validateImageCandidate("https://cdn.test/shared.jpg", {
      source: "scraped_source",
      sharedWithOtherProducts: true,
    });
    expect(result.imageUrl).toBeNull();
    expect(result.imageValidationStatus).toBe("rejected_duplicate_across_products");
    // Gerekçe insan-okur olmalı: "doğrulanamadı" demek yeterli değil.
    expect(result.reason).toContain("birden fazla üründe");
  });

  it("eleme gerekçesi boş string DEĞİLDİR", () => {
    for (const url of ["https://placehold.co/1.png", "https://cdn.test/a/logo.svg", ""]) {
      expect(validateImageCandidate(url).reason.length).toBeGreaterThan(5);
    }
  });
});

describe("resolveVerifiedImageFromHtml", () => {
  it("JSON-LD görselini seçer ve alttakilere hiç bakmaz", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"X","image":"https://cdn.test/jld.jpg"}</script>
      <meta property="og:image" content="https://cdn.test/og.jpg">`;
    const result = resolveVerifiedImageFromHtml(html, { productUrl: "https://shop.test/p" });
    expect(result.imageUrl).toBe("https://cdn.test/jld.jpg");
    expect(result.imageSource).toBe("jsonld_product");
  });

  it("JSON-LD yoksa sayfa `<img>`'sine düşer", () => {
    const html = `<img class="product-image" src="https://cdn.test/page.jpg">`;
    expect(resolveVerifiedImageFromHtml(html).imageSource).toBe("product_img");
  });

  it("hiçbir aday kabul edilmezse `imageUrl` NULL kalır (uydurma yok)", () => {
    const html = `<img class="header-logo" src="https://cdn.test/assets/logo.svg">`;
    const result = resolveVerifiedImageFromHtml(html);
    expect(result.imageUrl).toBeNull();
    expect(isVerifiedImage(result.imageValidationStatus)).toBe(false);
  });

  it("boş HTML çökertmez", () => {
    expect(resolveVerifiedImageFromHtml("").imageUrl).toBeNull();
    expect(resolveVerifiedImageFromHtml("   ").imageValidationStatus).toBe(
      "unverified_no_product_page",
    );
  });

  it("paylaşılan görsel listede varsa o da reddedilir", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"X","image":"https://cdn.test/shared.jpg"}</script>`;
    const result = resolveVerifiedImageFromHtml(html, {
      sharedImageUrls: new Set(["https://cdn.test/shared.jpg"]),
    });
    expect(result.imageUrl).toBeNull();
    expect(result.imageValidationStatus).toBe("rejected_duplicate_across_products");
  });

  it("tüm adaylar reddedildiğinde GERÇEK red sebebi korunur", () => {
    // "görsel bulunamadı" ile "görsel bulundu ama logo çıktı" aynı şey
    // değildir; panelde bu ayrım görünür olmalıdır.
    const html = `<meta property="og:image" content="https://cdn.test/assets/logo.svg">`;
    const result = resolveVerifiedImageFromHtml(html);
    expect(result.imageUrl).toBeNull();
    expect(result.imageValidationStatus).toBe("rejected_logo_or_asset");
    expect(result.reason).toContain("Logo");
  });
});

describe("findSharedImageUrls", () => {
  it("iki farklı üründe aynı görseli bulur", () => {
    const shared = findSharedImageUrls(
      new Map([
        ["p1", "https://cdn.test/a.jpg"],
        ["p2", "https://cdn.test/a.jpg"],
        ["p3", "https://cdn.test/b.jpg"],
      ]),
    );
    expect(shared.has("https://cdn.test/a.jpg")).toBe(true);
    expect(shared.has("https://cdn.test/b.jpg")).toBe(false);
  });

  it("boyut parametresi farkını YOK sayar (aynı görsel)", () => {
    const shared = findSharedImageUrls(
      new Map([
        ["p1", "https://cdn.test/a.jpg?w=400"],
        ["p2", "https://cdn.test/a.jpg?w=1200"],
      ]),
    );
    expect(shared.size).toBe(1);
  });

  it("görseli olmayın / boş olan ürünü paylaşım saymaz", () => {
    const shared = findSharedImageUrls(
      new Map([
        ["p1", null],
        ["p2", ""],
        ["p3", undefined],
      ]),
    );
    expect(shared.size).toBe(0);
  });
});

describe("unverifiedImage", () => {
  it("HER ZAMAN null adres üretir", () => {
    const result = unverifiedImage("unverified_no_image_found", "sebep");
    expect(result.imageUrl).toBeNull();
    expect(result.imageSource).toBeNull();
  });
});
