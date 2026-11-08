/**
 * KAYNAK GÖRSEL ÇIKARIMI — saf yardımcı testleri (ağ YOK).
 *
 * Kapsam: iki çıkarıcının da UYDURMA YAPMADIĞINI kanıtlar. Görsel yanlış
 * gelirse vitrin bozuk görünür, hiç gelmezse kapı ürünleri eler; ikisi de
 * sessiz hatadır, bu yüzden ayrıca sabitlenmiştir.
 */
import { describe, expect, it } from "vitest";

import { imageFromShoppingCard, itunesArtwork } from "./product-discovery-sources.server";

describe("itunesArtwork", () => {
  it("100x100 kapağı 512'ye yükseltir (vitrin kartı bulanık kalmasın)", () => {
    expect(itunesArtwork("https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg")).toBe(
      "https://is1-ssl.mzstatic.com/image/thumb/x/512x512bb.jpg",
    );
  });

  it("bilinmeyen şemayı olduğu gibi bırakır", () => {
    expect(itunesArtwork("https://cdn.example.com/cover.jpg")).toBe(
      "https://cdn.example.com/cover.jpg",
    );
  });

  it("boş/bozuk girdide görsel UYDURMAZ", () => {
    expect(itunesArtwork("")).toBe("");
    expect(itunesArtwork("   ")).toBe("");
    expect(itunesArtwork("http://insecure/100x100bb.jpg")).toBe("http://insecure/100x100bb.jpg");
  });
});

describe("imageFromShoppingCard", () => {
  it("schema.org murl alanını tercih eder", () => {
    const card =
      '<div class="br-gOffCard"><img src="https://th.bing.com/th?id=OIP-small"/><script>{"murl":"https://shop.example.com/img/real-product.jpg"}</script></div>';
    expect(imageFromShoppingCard(card)).toBe("https://shop.example.com/img/real-product.jpg");
  });

  it("murl yoksa gerçek <img src>yi kullanır", () => {
    const card =
      '<div class="br-gOffCard"><img src="https://th.bing.com/th?id=OIP.Ab3dEf9-1100-2000" alt="p"/></div>';
    expect(imageFromShoppingCard(card)).toBe("https://th.bing.com/th?id=OIP.Ab3dEf9-1100-2000");
  });

  it("`br-offImg` içindeki lazy `data-src` ana görselini okur", () => {
    // CANLI YAPI (ölçüldü 2026-11-08, "air fryer"/US): 23/60 kartta `<img src>`
    // yok; ana görsel `rms_iac` div'inde lazy `data-src` olarak duruyor.
    const card =
      '<div class="br-gOffCard"><div class="br-offImg" data-priority="2">' +
      '<div class="rms_iac" data-src="https://th.bing.com/th/id/OPHS.hmxRfGCNAJBTAw474C474?w=180&amp;h=180"></div></div></div>';
    expect(imageFromShoppingCard(card)).toBe(
      "https://th.bing.com/th/id/OPHS.hmxRfGCNAJBTAw474C474?w=180&h=180",
    );
  });

  it("hover/benzer ürün data-src'sini ANA görsel sanmaz", () => {
    // Yalnız `br-offImg` kutusu okunur; kartın ilerisindeki slayt görselleri
    // başka ürünündür ve yanlış eşleşme üretirdi.
    const card =
      '<div class="br-gOffCard"><div class="br-offImg"></div>' +
      '<div class="pa_hover_container"><div data-src="https://th.bing.com/th/id/OPHS.relatedProduct474C474"></div></div></div>';
    expect(imageFromShoppingCard(card)).toBe("");
  });

  it("logo, sprite ve izleyici görsellerini eler", () => {
    const card =
      '<div class="br-gOffCard"><img src="https://bing.com/logo.png"/>' +
      '<img src="https://bing.com/sprite-ico.png"/><img src="https://bing.com/blank.gif"/></div>';
    expect(imageFromShoppingCard(card)).toBe("");
  });

  it("HTML entity'sini çözer (canlı ölçümde `&amp;` çıktı, adres kırılırdı)", () => {
    // CANLI KART GERÇEKTEN BU ŞEKİLDE GELİYOR (ölçüldü 2026-09-29):
    //   https://th.bing.com/th?id=OPHS.Xyz&amp;w=180&amp;h=180
    // Ham HTML'den alındığı için `&amp;` decode EDİLMEZSE sorgu parametreleri
    // `amp;w=180` olur ve görsel yüklenmez.
    const card =
      '<div class="br-gOffCard"><img src="https://th.bing.com/th?id=OPHS.CHLDdAJ6%2fwmqYw474C474&amp;w=180&amp;h=180&amp;a=pid"/></div>';
    const url = imageFromShoppingCard(card);
    expect(url).toBe("https://th.bing.com/th?id=OPHS.CHLDdAJ6%2fwmqYw474C474&w=180&h=180&a=pid");
    expect(url).not.toContain("&amp;");
  });

  it("görsel yoksa boş döner — ASLA uydurma adres üretmez", () => {
    expect(imageFromShoppingCard('<div class="br-gOffCard">fiyat yok</div>')).toBe("");
    expect(imageFromShoppingCard("")).toBe("");
    // Göreli (https olmayan) adres kabul edilmez.
    expect(imageFromShoppingCard('<img src="/local/pic.jpg"/>')).toBe("");
  });
});
