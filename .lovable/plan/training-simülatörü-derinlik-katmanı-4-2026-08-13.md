# Training Simülatörü: Derinlik Katmanı 4

Mevcut sim: 30 günlük sezon, kanal seçimi (Meta/TikTok/Google), kreatif yorgunluğu, stok/tedarik, kararlar, yükseltmeler, kredi, e-posta CRM, rakip fiyat endeksi, görevler + koç + şeref listesi.

Bu adımda oyuna "işletme yönetimi" derinliği ekleniyor.

## 1. Rakip mağazalar (yaşayan pazar)

Endeks yerine 3 isimli rakip mağaza: her biri fiyat, reklam gücü ve agresiflik taşır. Günlük olarak fiyat kırar, bütçe artırır, ürününü kopyalar. Pazar payı hesabı senin fiyat/rating/reklam gücünle onlarınkinin oranından çıkar. Yeni "Rakipler" paneli: mağaza kartları, pazar payı çubuğu, kim ne yaptı akışı.

## 2. Müşteri segmentleri

Üç segment (Fiyat avcısı / Ana akım / Premium). Her segmentin fiyat duyarlılığı, iade eğilimi ve kanal ilgisi farklı. Fiyat + kanal seçimi hangi segmenti çektiğini belirler; segment karışımı iade oranını ve tekrar alım havuzunu etkiler. Analitikte segment dağılım grafiği.

## 3. Marka değeri (brand equity)

0-100 arası puan; tutarlı yıldız puanı, tekrar alım, kampanya ve içerik yükseltmesiyle artar, stoksuzluk/iade/aşırı indirimle düşer. Yüksek marka = organik trafik, daha düşük fiyat esnekliği (zam yapabilirsin), daha ucuz dönüşüm.

## 4. Destek ve operasyon

Sipariş başına destek talebi doğar. Yanıtlanmayan talepler yıldız puanını ve iadeleri kötüleştirir. Günlük "destek kapasitesi" ya elle ayrılan bütçeyle ya da yeni "Destek ekibi" yükseltmesiyle karşılanır.

## 5. A/B kreatif testi

Bir üründe iki kreatif varyantı yayınlanır; 3 gün sonra kazanan otomatik seçilir ve CVR kalıcı bonus alır. Maliyet ve süre var, yanlış zamanlama bütçe yakar.

## 6. Sezon takvimi ve süresiz mod

30 günün içine sabit takvim olayları: Gün 11 flash indirim penceresi, Gün 18 tedarikçi tatili (lead time +3), Gün 24 Black Friday (talep ×2.2, TBM ×1.6). Sezon bitince "Sonsuz mod": skor kilitlenir, oynamaya devam edilebilir, her 30 günde yeni sezon hedefi.

## 7. Görev/XP/Koç genişletmesi

Yeni mekaniklere karşılık 6 görev daha (marka 60+, pazar payı %35, A/B kazanma, destek SLA, Black Friday kârı, sonsuz mod 2. sezon), XP formülüne marka ve pazar payı katkısı, koç için yeni uyarılar (destek birikti, rakip seni fiyatta geçti, marka düşüyor, BF yaklaşıyor - stok al).

## Teknik notlar

- `src/lib/training-sim.ts`: `SimState`'e `competitors`, `brand`, `supportQueue`, `segmentMix`, `abTest`, `season` alanları (hepsi opsiyonel, eski kayıtlar bozulmaz). `simulateDay` içine rakip AI, segment karışımı, marka ve destek adımları eklenir; takvim olayları gün numarasına göre uygulanır.
- `src/lib/training-meta.ts`: yeni görevler, XP katkıları, yeni koç ipuçları, sonsuz mod skoru.
- `src/components/training-tab.tsx`: yeni "Rakipler" ve "Operasyon" sekmeleri, HUD'a marka + pazar payı çipleri, ürün kartına A/B testi bloğu, takvim şeridi.
- Kayıt formatı geriye dönük uyumlu kalır (eksik alanlar varsayılanla doldurulur).
