# Ürün Bulucu (Product Finder) Derinleştirme

Mevcut hiçbir özellik kaldırılmaz. Amaç: bulunan ürünlerin gerçekten "kazanan" ürünler olması — uydurma değil, kanıtlı, kârlı ve satılabilir.

## 1. Aday havuzunu genişlet (daha çok ürün → daha iyi eleme)
Bugün market ajanı 2-4 aday üretiyor ve neredeyse hepsi sonuca kalıyor. Yeni akış:
- Aday sayısı 12-18'e çıkar (derinlik seviyesine göre: standard 12 / deep 16 / ultra 20).
- Adaylar 3 farklı kaynaktan paralel toplanır: AI market taraması, canlı sinyal hattı (Google Trends + Reddit + TikTok/Amazon movers + GitHub), ve pazar yeri fiyat taraması.
- Aynı ürünün farklı isimlerini birleştiren normalize + tekilleştirme (fuzzy isim eşleme).

## 2. Sert kalite kapısı (Winner Gate)
Aday, tam analize girmeden önce ucuz bir ön elemeden geçer; sadece hayatta kalanlar pahalı derin analizi tüketir:
- Jenerik/doymuş ürün kara listesi (telefon kılıfı, halka ışık, posture corrector vb. klişeler) — sadece belirgin farklılaşma kanıtı varsa geçer.
- Zorunlu eşikler: brüt marj, satış fiyatı bandı, kargo uygunluğu (hacim/ağırlık/kırılganlık), yasal risk (pil, kozmetik, marka taklidi, patent) elemesi.
- Kanıt kuralı: gerçek pazar verisi (trend momentumu, canlı satıcı listesi veya sosyal sinyal) olmayan aday "doğrulanmamış" işaretlenir ve üst sıralara çıkamaz.

## 3. Winner Score — tek, açıklanabilir puan
Mevcut hibrit skor (AI1 %55 / AI2 %45), realism skoru ve konsey kararı korunur; üstlerine birleşik bir **Winner Score (0-100)** eklenir:
- Talep momentumu, rekabet/doygunluk, kâr marjı, lojistik kolaylığı, farklılaşma potansiyeli, risk cezası bileşenleri.
- Her bileşen için puan kırılımı ve "neden bu puan" açıklaması kartta gösterilir.
- Sonuçlar Winner Score'a göre sıralanır; eşik altı olanlar "Elenenler" bölümünde ret sebebiyle listelenir (şeffaflık).

## 4. Her ürüne daha derin kanıt
Mevcut alanlar (unit economics, personas, tedarikçi listesi, reklam kreatifleri, roadmap…) aynen kalır, üzerine:
- **Kanıt paneli**: trend grafiği, gözlemlenen gerçek satıcı fiyatları ve medyanı, sosyal sinyal linkleri — hepsi kaynaklı.
- **Doygunluk/giriş penceresi** ve rakip sayısı tahmini gerçek listelemelerden beslenir.
- **Farklılaşma açığı**: rakip yorum şikâyetlerinden türetilen "bunu düzelt, kazan" maddeleri.
- **Risk bayrakları**: mevzuat, iade oranı, sezon sonu, tedarik darboğazı.
- **Gerçekçilik rozeti**: Doğrulanmış / Kısmen doğrulanmış / Yalnızca AI tahmini.

## 5. Sonuç ekranı yenilikleri (mevcut UI korunur)
- Winner Score'a göre sıralama + "Sadece doğrulanmış", "Marj ≥ %X", "Düşük rekabet", "Kargoya uygun" hızlı filtreleri.
- Kartlarda skor kırılım çubuğu ve kanıt rozetleri.
- "Elenenler ve sebepleri" açılır bölümü.
- Ürünleri yan yana karşılaştırma ve tek tıkla favoriye/kaydetmeye devam.

## 6. Hız ve API limiti
- Ön eleme ucuz modelle (Groq/Flash), derin analiz sadece hayatta kalan ilk N ürüne.
- Aday toplama ve doğrulama paralel; mevcut anahtar havuzu rotasyonu ve önbellek kullanılır, ek maliyet kontrollü kalır.

## Teknik notlar
- `src/lib/agents.server.ts`: market ajanı çok kaynaklı ve daha yüksek aday sayılı hale getirilir.
- Yeni `src/lib/winner-gate.server.ts`: kara liste, eşikler, tekilleştirme, ön eleme.
- Yeni `src/lib/winner-score.ts`: bileşen ağırlıkları + açıklama üretimi (saf fonksiyon, test edilebilir).
- `src/lib/market-verify.server.ts`: kanıt bloğu adaylar için toplu (batch) hale getirilir.
- `src/lib/gemini.functions.ts`: `WinningProduct` tipine `winner_score`, `score_breakdown`, `evidence_level`, `rejection_reason` alanları eklenir (hepsi opsiyonel — mevcut alanlar aynen kalır).
- `src/routes/index.tsx` + `src/components/finder-extras.tsx`: sıralama, filtreler, skor kırılımı ve elenenler bölümü.
