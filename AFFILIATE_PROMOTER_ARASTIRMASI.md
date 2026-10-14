# Aroless'i Kim Tanıtır? — Promoter/Affiliate Araştırması

Tarih: 14 Ekim 2026 · Senin modelin: **promoter'a özel promosyon kodu** → koduyla gelen kişi abone olursa **%30 komisyon** → **ödemeleri sen Wise üzerinden manuel** yapıyorsun.

Bu rapor üç ayrı soruya cevap verir:

1. Bu modeli **hazır yazılımla** mı yönetmelisin, yoksa uygulamadaki kendi affiliate sisteminle mi?
2. Aroless'i tanıtacak **promoter'ları nerede bulursun** (ağlar/marketplace'ler)?
3. **Wise ile manuel ödeme** Türkiye'den teknik olarak nasıl yapılır, maliyeti ve riskleri ne?

> Not: Uygulamada **hâlihazırda çalışan** bir affiliate sistemi var: koda dayalı atıf, %30 komisyon, müşteri başına en fazla 12 ay, 75 $ ödeme eşiği, 30 gün iade beklemesi ve Wise/IBAN ile manuel ödeme. Yani bu rapor "programı nasıl kurarım" değil, **"programı kime, nerede tanıtırım ve ödemeyi nasıl yaparım"** sorusunun cevabı.

---

## 0) En kritik üç bulgu (önce bunlar)

1. **Hazır araçların çoğu Paddle Billing ile çalışmıyor.** Aroless ödemeleri Paddle üzerinden dönüyor. **Rewardful yalnızca Paddle Classic destekliyor** (Billing değil) — bu tek başına onu eler. **FirstPromoter ve Partnero Paddle Billing'i açıkça yazılı olarak destekliyor.** Tolt "Paddle" diyor ama hangi sürüm olduğu doğrulanamadı.
2. **Affiliate ağları (Awin, CJ, Impact, TradeTracker…) genelde komisyonu KENDİ öder.** Senin "manuel Wise ödemesi" modelinle çakışır: komisyon ağ üzerinden yürürse, parayı sen dağıtmazsın. Ağa para gider → ağ publisher'a öder.
3. **Türkiye'de kayıtlı Wise Business hesapları kısıtlı.** 31 Mayıs 2023'ten itibaren TRY ile para yükleme ve yeni döviz hesabı açma yok; hesabında para **tutma/çevirme/gönderme** kısıtlanabiliyor. Türk bankasından uluslararası transfer hâlâ mümkün, ama **toplu (batch) ödeme ve API'nin senin hesabında açık olduğunu Wise'dan yazılı teyit etmeden** plan yapma.

---

## 1) Hazır yazılım mı, kendi sistemin mi?

Aroless'te kod atıfı + komisyon + eşik + manuel ödeme zaten kodda. Hazır araç ancak şu üç şeyi **gerçekten** ekliyorsa mantıklı: (a) tıklama/çerez bazlı atıf (kodsuz gelen ziyaretçi de sayılır), (b) otomatik kod üretimi ve panel, (c) iade/iptal eşleştirmesini senin yerine yapan raporlama.

| Araç | Fiyat (2026) | Promotere özel kod | %30 + 12 ay yinelenen | Manuel ödeme (dışarıdan öde, "ödendi" işaretle) | Paddle uyumu | Karar |
|---|---|---|---|---|---|---|
| **FirstPromoter** | **$49/ay** Starter (aylık $5.000 affiliate cirosuna kadar), $99 Business, $149+ Enterprise. 14 gün deneme, kartsız | ✅ (kod takibi + kendi kodunu özelleştirme) | ✅ 12 ay sınırı resmî yardım dokümanında tarif edilmiş | ✅ "her yöntemle öde, panelde tamamlandı işaretle" | ✅ **Paddle Billing açıkça destekli** (webhook) | **En iyi teknik eşleşme #1** |
| **Partnero** | **$49/ay** (yıllık) / $59 aylık Starter, 1 program. 30 gün deneme. Kendi ödemelerinde ek ücret yok; Partnero öderse %7 | ✅ (Paddle kuponu oluştur/senkronize et) | ⚠️ Yinelenen atıf var; **müşteri başına 12 ay kesme doğrulanamadı** | ✅ banka transferiyle dışarıda öde + ödendi işaretle | ✅ **Paddle Billing + Classic** | **Eşleşme #2**, 12 ay sınırını yazılı teyit et |
| **Tolt** | **$69/ay** Basic (aylık $10.000'a kadar), $99 Growth. 14 gün deneme | ✅ (bireysel partner kuponu) | ✅ 12 ay için ayrı yardım makalesi var | ✅ dışa aktar → dışarıda (Wise dahil) öde → "Paid" işaretle | ⚠️ "Paddle" yazıyor, **Billing mi Classic mi doğrulanamadı** | İyi, ama Paddle sürümünü sor |
| **Rewardful** | $49/ay Starter, 14 gün deneme | Kupon takibi var, koda özel indirim doğrulanamadı | ✅ yinelenen + ay sınırı | PayPal/Wise toplu ödeme var; dış ödeme akışı doğrulanamadı | ❌ **Yalnız Paddle Classic** | **Paddle Billing kullanıyorsan eleme** |
| **Tapfiliate** | $89/ay Launch (50 affiliate), $179 Scale; deneme 7/14 gün | Kupon takibi var | ✅ yinelenen/ömür boyu/süreli | Net değil | ⚠️ sayfada Paddle geçiyor, entegrasyon listesinde yok | Doğrulanana kadar bekle |
| **Refersion** | $39/ay **+ satışın %3'ü**, Growth $199/ay + %2 | ✅ benzersiz kupon | ✅ abonelik/ömür boyu komisyonlar | ✅ manuel ödeme listelenmiş | ❌ Paddle yok (Stripe/Chargebee) | Yüzdeli ücret + Paddle yok → ele |
| **GrowSurf** | Affiliate planı **$0/ay + %3 komisyon cirosu** | ⚠️ affiliate için koda özel indirim doğrulanamadı | ✅ ilk yıl sınırı destekli | ✅ "Mark Payouts as Paid" | Stripe/Chargebee/Recurly; Paddle ancak REST API ile | Ucuz ama Paddle dolambaçlı |
| **UpPromote** | Free plan; $29.99/ay + %2'den başlar | ✅ atanmış kupon | ⚠️ 12 ay kesme doğrulanamadı | ✅ manuel ödeme var | ❌ **Shopify odaklı** | Aroless'e uymaz |
| **Post Affiliate Pro** | **Doğrulanamadı** (fiyat sayfası okunamadı) | Doğrulanamadı | Doğrulanamadı | Doğrulanamadı | Paddle doğrulanamadı | Belirsiz |
| **Affilimate** | Doğrulanamadı | — | — | — | — | **Yayıncı analitiği**; satıcı aracı değil → ele |
| **PartnerStack Spark** | **$0/ay + ödenen komisyonun %10'u** | Doğrulanamadı | Doğrulanamadı | Otomatik ödeme odaklı | Stripe | %10 ücret pahalı |

**Sonuç:** Hazır araç alacaksan **FirstPromoter ($49/ay)** veya **Partnero ($49–59/ay)**. Ama dürüst karşılaştırma şu: sende zaten komisyon, eşik, bekleme ve manuel ödeme çalışıyor. Hazır araç sana **çerez/tıklama takibi** ve hazır panel getirir; karşılığında ayda ~$50 + Paddle entegrasyonu + veriyi üçüncü tarafa taşıma maliyeti. Promoter sayın 10'un altındaysa **kendi sistemin + basit bir takip tablosu** daha ucuz ve daha kontrollüdür.

---

## 2) Promoter'ları nerede bulursun (ağlar ve marketplace'ler)

Ağların çoğu "program ilan et + yayıncı bul" fikrine uyar; ama **ödeme modeli** seninkine uymaz. Aşağıdaki tabloda "kim öder" kolonuna dikkat et.

| Ağ | Advertiser (senin) maliyeti | Kim öder | Aroless uyumu |
|---|---|---|---|
| **Awin (Access)** | **$49/ay + işlem başına %3,5 tracking fee**, minimum 3 ay | **Awin öder** (sen Awin'e fatura edilirsin) | Global yayıncı hacmi; manuel Wise modeline uymaz |
| **ShareASale** | — | — | **Kapandı** (6 Ekim 2025, Awin'e taşındı) → Awin kullan |
| **CJ Affiliate** | Teklif bazlı (kamuya açık fiyat yok) | **CJ öder**, hesapta bakiye şart | Kurumsal; SaaS mümkün, %30 yinelenen için sor |
| **Impact.com** | Starter **$30/ay + %2,5**; **marketplace erişimi Essentials $500/ay**'dan başlar + kurulum ücreti | **Impact öder** | Marketplace'e girmek için $500/ay; küçük SaaS için ağır |
| **PartnerStack** | **Teklif bazlı** (demo sonrası) | **PartnerStack öder** | **SaaS için en güçlü kayıt kanalı**: kendi dizininde "30% recurring 12 ay" ilanları var. Fiyat ve TR kabulü yazılı sorulmalı |
| **TradeTracker** | Kamuya açık değil ("no win, no pay") | **Ağ öder** | 19 ülkede ofis; teklif iste |
| **Admitad** | Kamuya açık değil; KYC + izleme kurulumu şart | Ağ öder | Promosyon kodu kavramı sözleşmede geçiyor |
| **Digistore24** | Kurulum/aylık yok deniyor; **işlem başına ~%7,9 + $1** | **Digistore24 öder** | **MoR/ödeme altyapısı**; mevcut Paddle düzenini değiştirmen gerekir → sadece ilan katmanı değil |
| **ClickBank** | **$49,95 tek seferlik + dönem başına $5**; satışta **%7,5 + $1** (abonelik yenilemesinde <$40 için %90,1) | ClickBank öder | Doğrudan ödeme listesinde **Türkiye yok**; Paddle'ı bırakmayı gerektirir |
| **Refersion Marketplace** | **İlan ücretsiz** (yalnız %-satış teklifi); yönetmek için $39/ay + %3 | Sen (manuel ödeme destekli) | **Ücretsiz ilan** cazip; Paddle entegrasyonu doğrulanamadı |
| **Affiliates.One** | Kamuya açık fiyat yok | Belirsiz | Çin/Asya odaklı CPA + KOL |
| **Involve Asia** | Kamuya açık değil (aktivasyon ücreti olduğu söyleniyor) | Platform üzerinden | Güneydoğu Asya; **Sider AI (SaaS/AI) programı** örneği var → AI aracı için gerçek bir kanal |
| **Webgains** | Kamuya açık değil | Ağ öder | 250.000+ yayıncı; teklif iste |
| **ReklamAction / ReklamStore (TR)** | Kamuya açık fiyat yok | Belirsiz | **Türkiye'deki yayıncılara erişim** için sorulmaya değer |

**Ağlarla ilgili dürüst özet:** Ağların iş modeli "komisyonu ben toplayıp publisher'a ben öderim" üzerine kurulu. Senin modelin "komisyonu doğrudan Wise ile ben öderim". Bu yüzden ağa girmek, ödeme kontrolünü ve muhtemelen komisyon oranının bir kısmını (%2,5–%3,5 tracking) vermek demek. **$199'lık Business planında %3,5 tracking fee, 12 ayda müşteri başına ~$25 ek maliyet** — kabul edilebilir mi, karar senin.

---

## 3) Ağ olmadan promoter bulma: gerçekçi kanallar

Araştırmanın net sonucu: **küçük bir SaaS'ı kabul edip "kişiye özel kod + %30 yinelenen" modelini kuran hazır bir açık marketplace yok.** Bu yüzden asıl iş **doğrudan davet**.

### a) Doğrudan davet (en yüksek dönüşüm, sıfır maliyet)
- **Hedef profil:** "en iyi Amazon FBA araçları", "dropshipping ürün araştırma" içeriği üreten YouTuber'lar, e-ticaret danışmanları/ajanslar, kurs satanlar, niş newsletter yazarları, Shopify/Trendyol satıcı topluluklarındaki aktif isimler.
- **Yöntem:** 10-20 kişilik bir liste çıkar, kişiselleştirilmiş davet yaz (kim olduğunu, ne ürettiğini göster), %30 + 12 ay + kod + $75 eşiğini tek ekranda anlat (`/affiliate` sayfası tam bunun için var).
- **Önemli:** teklifi net yaz — "tahsil edilen abonelik gelirinin %30'u, müşteri başına en fazla 12 ay; iade düşülür; $75 üstünde Wise/IBAN ile ödeme".

### b) Ücretli ama ölçülebilir keşif kanalları
| Kanal | Maliyet | Ne sağlar | Aroless için not |
|---|---|---|---|
| **Paved** (newsletter marketplace) | Marketplace'e giriş ücretsiz; her newsletter kendi sabit fiyatını koyar | Sabit ücretli newsletter yerleşimi | Kodunu metne koydurabilirsin; komisyon takibi senin tarafında |
| **beehiiv Ad Network / Swapstack** | CPM/CPC bazlı | Newsletter reklamı | Swapstack beehiiv'e katıldı; atıf yine sende |
| **Aspire** | Creator tarafı ücretsiz; marka fiyatı demo ile | Influencer kampanyası, **promosyon kodu destekli** | Creator bulmak için iyi; %30 yinelenen kabulü sorulmalı |
| **YouTube Creator Partnerships** | Direkt anlaşma | **Türkiye dahil** creator bulma | Brand-deal akışı; kodu sen takip edersin |
| **Trend** | **Video başına ~$50**'dan başlıyor | UGC içerik üretimi | Ucuz içerik; affiliate değil |
| **Insense** | Trial **$650/ay** (1 kampanya, 10 creator, %20 fee), Brand $500/ay | Affiliate kullanım senaryoları var | Bootstrapped için pahalı |
| **Upfluence** | Teklif bazlı, **minimum 12 ay sözleşme** | Creator marketplace | İlk tercih değil |
| **Shopify Collabs** | Kurulum ücretsiz, otomatik ödemede **%2,9** işlem ücreti | Creator + kod + affiliate | Yalnız Shopify satış akışına uyar; Aroless'te uymaz |

### c) Dizin/keşif ve topluluklar (maliyetsiz, yavaş)
- **SoftwareSuggest / Capterra / GetApp / Software Advice:** ürün dizini ve yorum profili. Affiliate kanalı değil; ama inceleme yazanlar çoğu zaman video/blog da üretiyor → dolaylı lead.
- **Product Hunt:** lansman görünürlüğü; affiliate altyapısı yok.
- **AffiliatePrograms.com:** dizin ücretsiz ama **şu anda yeni kayıt kabul etmiyor**.
- **AppSumo:** deal lansmanı; ömür boyu indirim abonelik ekonomisiyle çelişebilir.
- **Topluluklar:** r/dropship, r/ecommerce, r/AmazonFBA, niş Discord/Telegram grupları. **Link bırakma yeri değil**; önce moderatörden izin, önce değer üret. Kurallar okunamadı → paylaşmadan önce ilgili grubun kurallarını kendin kontrol et.
- **Kupon/cashback siteleri:** küçük SaaS + kişisel kod için kabul garantisi bulunamadı.
- **Türkiye/orta doğu toplulukları:** Trendyol/HePS satıcı grupları, girişimcilik toplulukları — burada Türkçe içerik üreten kişiler Aroless için en doğal promoter kitlesi.

---

## 4) Rakamlar: %30 komisyon gerçekten ne demek?

Müşteri başına **en fazla** komisyon (12 ay, liste fiyatından, iade yok sayılarak):

| Plan | Aylık | 12 aylık %30 komisyon (maks.) |
|---|---|---|
| Starter | $39 | **$140,40** |
| Pro | $59 | **$212,40** |
| Business | $199 | **$716,40** |

- Bu tutarlar **ödeme eşiği ($75) ve 30 günlük bekleme** ile birlikte okunmalı: bir Pro müşterisi ancak ~4-5 ayda eşiği aşan bir komisyon üretir.
- Ağ kullanırsan üstüne **%2,5–%3,5 tracking fee** biner (Awin %3,5 + $49/ay; Impact %2,5; Refersion %3). $199 planında bu, müşteri başına ~$25.
- **Karar kuralı:** bir promoter müşterinin ilk yılını doldurmadan bırakırsa kâr marjı ince kalır. Bu yüzden **atanacak promoter'ı seçmekte cimri ol**: teknik/satıcı kitlesi olan, "bu aracı kullanıyorum" diyebilecek kişiler.

---

## 5) Wise ile manuel ödeme (Türkiye'den) — teknik gerçekler

### Kritik kısıt
- Wise, **Türkiye'de kayıtlı müşteriler için** yerel düzenlemeler gereği **31 Mayıs 2023'ten** itibaren kısıtlar uyguluyor: **TRY ile para yükleme yok**, **yeni döviz hesap bilgisi (details) alınamıyor**; bazı durumlarda hesapta **para tutma/çevirme/alma/gönderme** de kısıtlanabiliyor. Kısıtlar adres bazlı olarak kişisel/iş profillerinde ayrı ayrı uygulanıyor.
- Türk bankasından **uluslararası transfer** yapmak hâlâ mümkün. Ama **toplu (batch) ödeme ve API** özelliklerinin **senin şirket profilinde açık olduğunu Wise'dan yazılı teyit al**, sonra süreci buna göre kur.

### Ödeme araçları
- **Batch payments:** CSV/XLSX başına **1.000 ödeme**; araç ücretsiz, ama **her transfer için normal ücret** alınır ve toplamı ödeme anında görünür. Batch aynı kaynak para biriminden başlar (hedef para birimleri değişebilir). Batch **Wise bakiyesi veya yerel banka havalesiyle** fonlanır (kart/bağlı hesap/SWIFT ile batch fonlama listelenmiyor).
- **API:** kullanımı **ücretsiz**; banka hesabına veya e-posta ile alıcıya ödeme, batch yükleme, transfer durumu ve ekstre (mutabakat) sağlar. Doğrulanmış Wise Business hesabı gerekir.
- **Ücret:** tek bir "sabit transfer ücreti" yok; ücretlere gönderim ülkesi/para birimi/rotaya göre değişir ve Wise ara kur yerine **piyasa kuru** kullandığını belirtir (yani ayrıca %'lik kur marjı değil, komisyon). ABD menşeli Wise Business sayfasındaki "%0,23'ten başlayan ücret / $31 hesap detayı" **ABD bölgesine ait**, senin için geçerli değil.
- **Rota örnekleri:** TRY **yalnız Türk bankalarındaki TRY hesaplara** gönderilir (transfer başına üst sınır 9.999.999,99 TRY; banka bazlı günlük limitler, ör. Akbank işletme: günde 3 transfer / 250.000 TRY). EUR SEPA içinde (bazı işletme yöntemlerinde €20 milyon tavan yazıyor), SEPA dışı daha pahalı. USD çoğu ülkeye **SWIFT** ile (Türkiye'ye USD→USD için örnek Swift ücreti **$19,24**, öncesinde kur çevrimi ve fonlama masrafı ayrı).
- **Kimlik:** Wise iş hesabı doğrulamasında şirket sicil no, adres, sektör, yönetici/ortak bilgileri, belgeler ve kimlik istenebilir; ek inceleme **10 iş gününe** kadar sürebilir. **UBO** eşiği **%25**. Ayrıca Wise, transferin bedelinin **kendi adına** bir hesaptan gelmesini şart koşuyor (üçüncü kişi fonlaması kabul edilmiyor) — bu, batch'i şirket hesabından fonlaman gerektiği anlamına gelir.
- **Yaptırım ülkeleri:** Wise'ın gönderemediği ülkeler listesi var (İran, Rusya, Suriye, Küba, Kuzey Kore, Libya, Belarus vb.). **Promoter'ları onaylarken ülkesini kontrol et** — ödeme yapamayacağın bir promoter'a komisyon biriktirmek sorun olur.

### Pratik öneri
Ayda bir **tek seferlik batch** yap: komisyon ekstresini çıkar, $75 üstü + 30 günü geçmiş satırları listele, CSV'yi Wise'a yükle, öde, her ödemeyi **Wise transfer referansı + komisyon ekstresi** ile eşleştir. 10 kişinin altındaysan batch yerine tek tek gönderim daha az hatalı olur.

---

## 6) Vergi ve belge (Türkiye) — muhasebecine sorulacak maddeler

Araştırmada bulunanlar (bunlar genel çerçevedir, senin olayına uygulanması muhasebeciye ait):

- **Stopaj:** Yurt dışındaki **online reklam hizmeti sağlayıcılarına/aracılarına** yapılan ödemelerde **%15 stopaj** (476 sayılı Cumhurbaşkanı Kararı, 01.01.2019). "Affiliate komisyonu bu tanıma giriyor mu?" sorusunun cevabı sözleşmenin niteliğine bağlı → yazılı görüş al.
- **KDV:** Yurt dışından alınan ve **Türkiye'de yararlanılan** hizmetlerde Türkiye'de sorumlu sıfatıyla KDV beyanı (tersine yükümlülük); genel KDV oranı %20.
- **Belge seti (her promoter için):** (1) imzalı affiliate sözleşmesi (komisyon tabanı, yenilemeler, iade, eşik, para birimi, stopaj düşülüp düşülmeyeceği), (2) kimlik/vergi bilgisi, (3) aylık komisyon ekstresi (kod, atıf, tahsil edilen abonelik, iade, hesaplama), (4) promoter'ın faturası ya da muhasebecinin kabul ettiği belge, (5) Wise transfer dekontu + kur + referans, (6) banka hesap ekstresi. **Tek başına Wise dekontunun vergisel belge olarak yeterli olduğunu varsayma.**

---

## 7) Uygulanabilir plan (ilk 2 hafta)

1. **Teklifi tek sayfaya indir:** `/affiliate` sayfası hazır (`%30`, `12 ay`, `$75 eşik`, `30 gün bekleme`, `Wise/IBAN`). Promoter'a gidecek metni buradan kopyala — sayılar koddan geldiği için pazarlıkta çelişki olmaz.
2. **10 hedefli davet** (Türkçe + İngilizce): niş YouTuber / newsletter / danışman. Kişiye özel; şablon değil.
3. **Ölçüm:** her promoter'a ayrı kod; hangi kodun kaç abonelik getirdiğini panelden takip et (`Ayarlar → Affiliate`, admin tarafı: `admin-affiliates`).
4. **Ödeme günü belirle:** ayın sabit bir günü (ör. her ayın 5'i) komisyon ekstresini kes, $75 üstü + 30 günü dolmuş satırları Wise ile öde.
5. **Büyütme kararı:** 10+ aktif promoter'a ulaşırsan o zaman **FirstPromoter ($49/ay)** veya **Partnero ($49-59/ay)** ile çerez/tıklama takibi ekle; ağa (Awin/Impact) girmeyi ancak yayıncı hacmine gerçekten ihtiyaç duyarsan düşün.
6. **Wise kontrolü:** kendi şirket profilinde batch/API'nin açık olup olmadığını Wise'a yazılı sor; küçük bir test transferi yap ve kullanılan ücreti kaydet.

---

## 8) Doğrulanamayanlar (imzalamadan önce teyit et)

- Ağlardan hiçbiri **Türkiye'de yerleşik bir advertiser'ı** kabul ettiğini kamuya açık sayfada yazmıyor (KYC/belge/vergi şartları).
- Hiçbir ağ, komisyonu **manuel Wise ile senin ödemen**e izin verdiğini açıkça yazmıyor (Refersion manuel ödeme diyor ama Wise diye belirtmiyor).
- Ağların **Paddle abonelik yenilemelerini/iptallerini/iade ve kupon dönüşümlerini** 12 ay sınırıyla izleyip izleyemediği doğrulanmadı.
- CJ, TradeTracker, Admitad, PartnerStack, Affiliates.One, Involve Asia, Webgains, ReklamAction için **advertiser fiyat listeleri** kamuya açık değil.
- **Post Affiliate Pro** fiyatları ve **Affilimate** fiyat sayfası okunamadı.
- **Tolt'un** Paddle sürümü (Billing/Classic) ve **Partnero'nun** 12 ay kesme davranışı doğrulanmadı.
- Wise batch/API'nin **Türkiye'de kayıtlı bir işletme profilinde** açık olduğu doğrulanmadı.
- Paved/beehiiv/Insense/Upfluence gibi kanalların **%30 yinelenen komisyonlu** bir SaaS teklifini kabul ettiği doğrulanmadı (bunlar sabit ücretli reklam/içerik kanalları).

---

## 9) Kaynaklar (okunan sayfalar)

- Aracı yazılımlar: rewardful.com/pricing · help.rewardful.com (Paddle uyumu) · tolt.com/pricing · help.tolt.com (kod, 12 ay, manuel ödeme) · firstpromoter.com/pricing · help.firstpromoter.com (12 ay sınırı, Paddle Billing) · tapfiliate.com/pricing · tapfiliate.com/docs/integrations · refersion.com/pricing · support.refersion.com (marketplace) · growsurf.com/pricing/affiliate-programs · docs.uppromote.com · partnerstack.com/pricing · partnerstack.com/platform/spark · partnero.com/pricing · docs.partnero.com (Paddle kuponları, ödeme yönetimi) · postaffiliatepro.com/pricing · affilimate.com
- Ağlar: awin.com/us/pricing/advertisers · awin.com/us/terms-and-conditions/self-service-faqs · cj.com/advertiser · junction.cj.com (advertiser SSS) · impact.com/integrated-platform-prices · help.impact.com (brand fees) · tradetracker.com/us/advertisers · admitad.com/terms-for-advertisers-us-entities · market.partnerstack.com · digistore24.com (+ vendor platform makalesi) · clickbank.com/sell · support.clickbank.com (ücretler) · affiliates.one/en-us/advertisers · involve.asia (advertiser maliyeti, Sider AI programı) · webgains.com · reklamstore.com/reklamaction
- Promoter kanalları: paved.com (advertiser SSS) · beehiiv.com/support (Ad Network) · beehiiv.com/blog (Swapstack) · aspire.io · upfluence.com/pricing · hashtagpaid.com · trend.io (fiyat karşılaştırması) · insense.pro/pricing · apps.shopify.com/collabs · support.google.com/youtube (creator partnerships) · affiliateprograms.com (submit/directory) · softwaresuggest.com/vendors · capterra.com/vendors · producthunt.com/launch · appsumo.com/blog/selling-on-appsumo · reddit.com/r/dropship · r/ecommerce · r/AmazonFBA
- Wise: wise.com/help/articles/18ewShSmFf7tJ7mm2Zp6H7 (Türkiye kısıtları) · wise.com/us/pricing/business · wise.com/help/articles/2932348 (TRY) · 2932149 (EUR) · 2974947 (USD Swift) · 2946451 (USD Swift ücreti) · 2663240 (batch) · 2942762 (batch fonlama) · 5iWcIUdYHyTQMnezSzx4n3 (exact amounts) · 2958106 (API) · 2769792 (iş doğrulama) · 5eYfavTeNDAg3mT4xznvau (UBO) · 2932118 (üçüncü kişi fonlaması) · 2978049 (yasaklı ülkeler)
- Vergi: taxnews.ey.com/news/2019-0387 (online reklam stopajı) · erdem-erdem.av.tr (stopaj analizi) · gib.gov.tr özelge · taxsummaries.pwc.com/turkey/corporate/other-taxes (KDV tersine yükümlülük)
