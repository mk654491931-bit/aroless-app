// ============================================================================
// Ülke bariyerleri — tek kaynak.
//
// Bu tablo KURULMUŞ (elle doğrulanmış) bilgidir: belirli ülke + ürün kalıbı
// eşleşmelerinde zorunlu sertifika/tescil gerektiğini söyler. Kural tabanlı
// olduğu için "eşleşmedi" sonucu "izin var" anlamına GELMEZ — yalnızca bilinen
// bariyerleri raporlar. Tahmin veya uydurma yoktur.
//
// Neden ayrı modül: `winner-gate` bir `.server` modülü, saf pazar erişimi
// hesabı ise sunucu bağımlılığı olmayan saf bir fonksiyon olmalı. Tek tablo,
// iki tüketicı, çelişki yok.
// ============================================================================

export type CountryBarrier = { re: RegExp; why: string };

export const COUNTRY_BARRIERS: Record<string, CountryBarrier[]> = {
  SA: [
    {
      re: /(elektronik|electronic|cosmetic|kozmetik|toy|oyuncak|charger|şarj)/i,
      why: "Suudi Arabistan SABER/SASO belgesi gerektiriyor",
    },
  ],
  AE: [
    {
      re: /(cosmetic|kozmetik|supplement|takviye|food|gıda|charger|şarj)/i,
      why: "BAE ESMA/MoHAP tescili gerekiyor",
    },
  ],
  DE: [
    {
      re: /(battery|pil|batarya|elektronik|electronic|packaging)/i,
      why: "Almanya VerpackG (ambalaj kaydı) + WEEE/BattG zorunluluğu",
    },
  ],
  FR: [
    {
      re: /(battery|pil|elektronik|electronic|textile|tekstil)/i,
      why: "Fransa EPR (Triman) kayıt zorunluluğu",
    },
  ],
  TR: [
    {
      re: /(supplement|takviye|cosmetic|kozmetik|medikal|medical)/i,
      why: "Türkiye'de Tarım/Sağlık Bakanlığı izni gerekiyor",
    },
  ],
  IN: [
    {
      re: /(elektronik|electronic|charger|şarj|toy|oyuncak)/i,
      why: "Hindistan BIS sertifikası gerekiyor",
    },
  ],
  BR: [
    {
      re: /(elektronik|electronic|charger|şarj|wireless|telsiz)/i,
      why: "Brezilya ANATEL/INMETRO onayı gerekiyor",
    },
  ],
  JP: [
    {
      re: /(charger|şarj|battery|pil|wireless|telsiz)/i,
      why: "Japonya PSE/GİTELEC onayı gerekiyor",
    },
  ],
};

/** Bir ülke için tanımlı bariyer kuralları (yoksa boş liste). */
export function barriersFor(country: string | undefined): CountryBarrier[] {
  return COUNTRY_BARRIERS[(country ?? "GLOBAL").toUpperCase()] ?? [];
}

/**
 * Ürün metni bir ülke bariyerine takılıyor mu?
 *
 * DÜRÜSTLÜK: eşleşme yoksa `null` döner — bu "sorun yok" demek DEĞİLDİR,
 * sadece bu tabloda bilinen bir kurala denk gelmediğini söyler.
 */
export function countryBarrierFor(country: string | undefined, productText: string): string | null {
  const text = String(productText ?? "");
  if (!text.trim()) return null;
  const hit = barriersFor(country).find((barrier) => barrier.re.test(text));
  return hit ? hit.why : null;
}
