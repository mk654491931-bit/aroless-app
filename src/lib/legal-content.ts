export type LegalSection = { id: string; heading: string; body: string[] };
export type LegalDoc = {
  slug: string;
  title: string;
  short: string;
  summary: string;
  updated: string;
  sections: LegalSection[];
};

export const LEGAL_VERSION = "2026-11-25";
export const LAST_UPDATED = "25 Kasım 2026";

/**
 * Satıcı/hizmet sağlayıcı künyesi — TEK KAYNAK.
 *
 * Kayıtlı ticari unvan, MERSİS, vergi dairesi/no, adres ve telefon bilgileri
 * depoda tutulmuyor; uydurulması hukuken yanlış olur. Ödeme/faturalandırma
 * Paddle üzerinden yürüdüğü için kayıtlı satıcı künyesi Paddle ödeme ekranında
 * ve faturada gösterilir. Bu alanlar netleştiğinde yalnız burası güncellenir.
 */
export const SELLER = {
  brand: "Aroless",
  website: "https://www.aroless.tech",
  email: "mk65449191@gmail.com",
  paymentProvider: "Paddle",
} as const;

export const TOS: LegalDoc = {
  slug: "kullanim-kosullari",
  title: "Kullanım Koşulları",
  short: "Kullanım Koşulları",
  summary:
    "Aroless platformunun kullanımına ilişkin hak, yükümlülük ve sorumlulukları; tüketici ve ticari kullanıcı ayrımı ile emredici tüketici hukuku güvencelerini düzenler.",
  updated: LAST_UPDATED,
  sections: [
    {
      id: "taraflar",
      heading: "1. Taraflar ve Kapsam",
      body: [
        'İşbu Kullanım Koşulları ("Sözleşme"); Aroless platformunu işleten hizmet sağlayıcı ("Aroless") ile platforma kayıt olan gerçek veya tüzel kişi kullanıcı ("Kullanıcı" veya "Üye") arasında elektronik ortamda kurulur.',
        "Platforma kayıt olarak, hesabınızı kullanarak veya hizmetlerin herhangi bir bileşenine erişerek işbu Sözleşme'yi, KVKK Aydınlatma Metni'ni, Veri İşleme Sözleşmesi'ni ve Çerez Politikası'nı okuduğunuzu ve kabul ettiğinizi beyan edersiniz.",
        "Aroless öncelikle işletmeler arası (B2B) bir yazılım hizmeti (SaaS) sunar. Bununla birlikte, bir Kullanıcı 6502 sayılı Tüketicinin Korunması Hakkında Kanun anlamında tüketici sıfatını taşıyorsa, ücretli mesafeli aboneliklerde Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi ayrıca uygulanır; işbu Sözleşme'nin hiçbir hükmü tüketicinin emredici mevzuattan doğan haklarını sınırlandırmaz.",
        "Ücretli aboneliğe ilişkin satıcı/hizmet sağlayıcı künyesi, Ön Bilgilendirme Formu'nda ve Paddle ödeme ekranında/faturada gösterilir. Paddle, ödeme ve faturalandırma süreçlerinde Merchant of Record olarak hareket eder.",
      ],
    },
    {
      id: "hizmet",
      heading: "2. Hizmet Tanımı",
      body: [
        "Aroless; ürün araştırma, tedarikçi analizi, maliyet ve kâr simülasyonu, trend radarı, reklam istihbaratı ve uyum araçlarından oluşan bir yapay zekâ destekli e-ticaret altyapısıdır.",
        "Platform üzerinde üretilen skorlar, tahminler ve öneriler karar destek amaçlıdır; yatırım, hukuki, vergisel veya gümrük danışmanlığı niteliği taşımaz. Yapay zekâ çıktılarının doğruluğu ticari bir sonuç garantisi değildir.",
        "Aroless, hizmet kapsamındaki modülleri geliştirmek, değiştirmek veya sonlandırmak hakkını saklı tutar; esaslı değişiklikler makul süre önce Kullanıcı'ya bildirilir ve tüketici Kullanıcı'nın bu nedenle sözleşmeyi feshetme hakkı saklıdır.",
      ],
    },
    {
      id: "hesap",
      heading: "3. Hesap Oluşturma ve Güvenlik",
      body: [
        "Kullanıcı, kayıt sırasında verdiği bilgilerin doğru, güncel ve eksiksiz olduğunu taahhüt eder.",
        "Hesap kimlik bilgilerinin gizliliğinden ve hesap üzerinden gerçekleştirilen tüm işlemlerden Kullanıcı sorumludur. Yetkisiz erişim şüphesi derhâl Aroless'ya bildirilmelidir.",
        "18 yaşından küçükler platforma üye olamaz. Ticari kullanıcılar bakımından ayrıca ticari faaliyet ehliyeti aranır.",
      ],
    },
    {
      id: "kredi",
      heading: "4. Abonelik, Kredi ve Ödeme",
      body: [
        "Analiz ve simülasyon işlemleri kredi tüketir. Kredi bakiyesi, paket satın alımı veya abonelik yenilenmesi ile artar.",
        "Abonelik, aksi açıkça belirtilmedikçe aylıktır ve Kullanıcı iptal edene kadar her ay otomatik yenilenir. İptal, içinde bulunulan dönemin sonunda yürürlüğe girer; Kullanıcı dönem sonuna kadar paketin tüm özelliklerini kullanmaya devam eder ve sonraki dönem tahsilatı yapılmaz.",
        "Ödenecek bedel, ödeme ekranında tüm vergiler dahil gösterilen toplam tutardır. TRY karşılığı yalnızca bilgilendirme amaçlıdır; tahsilat USD üzerinden yapılabilir ve kart sağlayıcısının kur/komisyon farkı uygulanabilir.",
        "Tüketici Kullanıcılar bakımından 6502 sayılı Kanun'un 48. maddesi ile Mesafeli Sözleşmeler Yönetmeliği'nden doğan cayma, ayıplı hizmet ve iade hakları saklıdır. İptal, geçmiş dönem ücretlerini geriye dönük iade etmez; ancak bu hüküm tüketicinin yasal cayma ve iade haklarını ortadan kaldırmaz.",
        "Kullanılmamış krediler, abonelik döneminin sonunda sona erer. Hizmetin sunulamadığı teknik kesintilerde tüketilen kredi, talep üzerine Kullanıcı hesabına iade edilir; tüketicinin ayıplı hizmete ilişkin hakları saklıdır.",
        "Fiyat değişiklikleri geriye etkili değildir; yürürlük tarihinden önce Kullanıcı'ya bildirilir. Tüketici Kullanıcı, esaslı fiyat değişikliğini kabul etmeyerek aboneliğini sona erdirebilir.",
      ],
    },
    {
      id: "yasak",
      heading: "5. Yasaklı Kullanımlar",
      body: [
        "Platformun tersine mühendisliğe tabi tutulması, otomatik araçlarla toplu veri çekilmesi (scraping), API anahtarlarının paylaşılması veya hizmetin yeniden satılması yasaktır.",
        "Yasa dışı, yanıltıcı, üçüncü kişilerin fikri mülkiyet haklarını ihlal eden veya rekabet hukukuna aykırı içerik üretilmesi amacıyla platform kullanılamaz.",
        "İhlal hâlinde Aroless, ihlâlin ağırlığına göre hesabı askıya alabilir veya kapatabilir; tüketici Kullanıcı'ya kural ihlali dışındaki nedenlerle uygulanan işlemlerde yasal hakları saklıdır.",
      ],
    },
    {
      id: "fikri",
      heading: "6. Fikri Mülkiyet",
      body: [
        "Platform yazılımı, arayüzü, modelleri, skorlama metodolojisi ve markası Aroless'ya aittir.",
        "Kullanıcı'nın platforma yüklediği veriler Kullanıcı'ya aittir; Aroless bu verileri yalnızca hizmetin sunulması amacıyla işler.",
        "Kullanıcı, platform çıktısı olan raporları kendi ticari faaliyetinde serbestçe kullanabilir. Kullanıcı, girdiği veriler ve çıktıları kullanırken üçüncü kişilerin fikri mülkiyet ve kişisel veri haklarını ihlal etmemekle yükümlüdür.",
      ],
    },
    {
      id: "sorumluluk",
      heading: "7. Sorumluluğun Sınırlandırılması",
      body: [
        'Hizmet "olduğu gibi" sunulur; ancak bu ifade mevzuatın zorunlu kıldığı garantileri ve tüketicinin ayıplı hizmete ilişkin haklarını ortadan kaldırmaz. Aroless, yapay zekâ çıktılarının doğruluğu, güncelliği veya belirli bir ticari sonucu sağlayacağı konusunda garanti vermez.',
        "Ticari Kullanıcılar bakımından Aroless'nın toplam sorumluluğu, ihlalin gerçekleştiği tarihten önceki 12 ay içinde Kullanıcı tarafından ödenen toplam hizmet bedeli ile sınırlıdır; dolaylı zararlar, kâr kaybı ve veri kaybından doğan talepler bu kapsamın dışındadır.",
        "Bu sınırlama; kasıt, ağır ihmal, hile, ölüm veya bedensel zarar hâllerini, 6502 sayılı Kanun, 6098 sayılı Türk Borçlar Kanunu ve 6698 sayılı KVKK'nın emredici hükümlerinden doğan sorumluluğu ortadan kaldırmaz. Tüketici Kullanıcı'nın yasal hakları her hâlde saklıdır.",
        "Mücbir sebep, doğal afet, salgın, savaş, altyapı/İnternet kesintisi veya Aroless'nın makul kontrolü dışındaki nedenlerle ifa gecikirse Aroless sorumlu tutulamaz; tüketicinin kanuni hakları saklıdır.",
      ],
    },
    {
      id: "fesih",
      heading: "8. Sözleşmenin Feshi",
      body: [
        "Kullanıcı, hesabını dilediği zaman kapatarak sözleşmeyi feshedebilir. Ücretli abonelikte iptal, içinde bulunulan dönemin sonunda yürürlüğe girer.",
        "Aroless, Sözleşme'ye esaslı aykırılık hâlinde hesabı makul bildirimle askıya alabilir veya feshedebilir; tüketici Kullanıcı'nın yasal hakları saklıdır.",
        "Fesih hâlinde hesaba ilişkin kişisel veriler, yasal saklama süreleri (özellikle Türk Ticaret Kanunu ve vergi mevzuatı) saklı kalmak kaydıyla en geç 30 gün içinde silinir veya anonim hâle getirilir. Yasal saklama süresi gereken kayıtlar, süre sonunda silinir.",
        "Aroless'nın haklı bir neden olmaksızın feshetmesi hâlinde tüketici Kullanıcı, kullanılmayan döneme isabet eden bedeli iade alır; diğer yasal hakları saklıdır.",
      ],
    },
    {
      id: "uyusmazlik",
      heading: "9. Uygulanacak Hukuk ve Uyuşmazlık Çözümü",
      body: [
        "İşbu Sözleşme Türkiye Cumhuriyeti hukukuna tabidir.",
        "Tüketici Kullanıcılar; Ticaret Bakanlığı'nın her yıl belirlediği parasal sınırın altındaki uyuşmazlıklarda, yerleşim yerlerindeki veya tüketici işleminin yapıldığı yerdeki Tüketici Hakem Heyeti'ne başvurmak zorundadır. Parasal sınırın üzerindeki uyuşmazlıklarda ve hakem heyeti kararına itirazda Tüketici Mahkemesi'ne başvurulur; 6502 sayılı Kanun'un 73/A maddesi uyarınca dava açmadan önce arabuluculuk dava şartıdır (hakem heyeti kapsamındaki uyuşmazlıklar hariç).",
        "Tüketici Kullanıcı, 6502 sayılı Kanun'un 73. maddesi uyarınca kendi yerleşim yerinde veya tüketici işleminin yapıldığı yerdeki Tüketici Mahkemesi'nde dava açabilir. Bu madde, tüketicinin kanuni yetki haklarını sınırlandırmaz.",
        "Ticari Kullanıcılar bakımından İstanbul (Çağlayan) Mahkemeleri ve İcra Daireleri yetkilidir; ticari uyuşmazlıklarda arabuluculuk dava şartıdır.",
      ],
    },
    {
      id: "bildirim",
      heading: "10. Bildirimler, Değişiklikler ve Ticari İletiler",
      body: [
        "Sözleşmeye ilişkin bildirimler, Kullanıcı'nın hesabında kayıtlı e-posta adresine yapılır. Kullanıcı, e-posta adresini güncel tutmakla yükümlüdür.",
        "Aroless, Sözleşme'yi ve hizmet koşullarını değiştirebilir. Değişiklikler yürürlük tarihinden önce bildirilir ve geriye etkili uygulanmaz. Tüketici Kullanıcı, esaslı değişikliği kabul etmeyerek aboneliğini sona erdirebilir.",
        "Ticari elektronik iletiler (kampanya, bülten, ürün duyurusu) yalnızca 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun ve ilgili yönetmelik uyarınca alınan ön onay ile gönderilir. Kullanıcı, her iletideki ret bağlantısından veya İYS üzerinden onayını geri alabilir; onay vermemek veya geri almak hizmetin sunulmasını engellemez.",
      ],
    },
    {
      id: "iletisim-tos",
      heading: "11. İletişim",
      body: [
        "Sözleşmeye ilişkin talepleriniz için: mk65449191@gmail.com · https://www.aroless.tech",
        "Ücretli aboneliklerde satıcı/hizmet sağlayıcı künyesi, Ön Bilgilendirme Formu'nda ve Paddle ödeme ekranında/faturada yer alır. Paddle'ın kayıtlı satıcı bilgileri ödeme ekranında ve faturada gösterilir.",
      ],
    },
  ],
};

export const KVKK: LegalDoc = {
  slug: "kvkk-aydinlatma-metni",
  title: "KVKK Aydınlatma Metni",
  short: "KVKK Aydınlatma Metni",
  summary:
    "6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında, Aroless üyelerinin kişisel verilerinin işlenmesine ilişkin aydınlatma metni.",
  updated: LAST_UPDATED,
  sections: [
    {
      id: "veri-sorumlusu",
      heading: "1. Veri Sorumlusunun Kimliği",
      body: [
        '6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca veri sorumlusu sıfatıyla Aroless hareket etmektedir.',
        "Veri sorumlusu iletişim: mk65449191@gmail.com · https://www.aroless.tech. Ticari unvan, MERSİS/vergi kimlik numarası, kayıtlı adres ve telefon bilgileri Paddle ödeme ekranında/faturada gösterilir; ayrıca bu adresten talep edilebilir.",
      ],
    },
    {
      id: "islenen-veriler",
      heading: "2. İşlenen Kişisel Veriler",
      body: [
        "Kimlik ve iletişim verileri: ad-soyad, e-posta adresi, şirket unvanı.",
        "İşlem güvenliği verileri: IP adresi, oturum kayıtları, cihaz ve tarayıcı bilgisi, giriş zamanları.",
        "Müşteri işlem verileri: abonelik ve kredi hareketleri, fatura bilgileri, destek talepleri.",
        "Kullanım verileri: platform içi analiz geçmişi, kaydedilen ürün ve tedarikçi listeleri.",
        "Reklam ölçümü verileri: pazarlama izni verilmesi hâlinde Meta Pixel/Conversions API aracılığıyla toplanan ziyaret ve dönüşüm olayları; e-posta ve kullanıcı kimliği yalnızca SHA-256 özetiyle, reklam eşleştirmesi için `_fbp`/`_fbc` çerez kimlikleri, IP adresi ve tarayıcı user-agent bilgisi işlenir.",
      ],
    },
    {
      id: "amac",
      heading: "3. İşleme Amaçları",
      body: [
        "Üyelik hesabının oluşturulması, kimlik doğrulama ve hizmetin sunulması,",
        "Abonelik ve kredi yönetimi, faturalandırma ve muhasebe süreçleri,",
        "Platform güvenliğinin sağlanması, kötüye kullanım ve dolandırıcılığın önlenmesi,",
        "Destek taleplerinin karşılanması ve hizmet kalitesinin iyileştirilmesi,",
        "Açık rıza verilmesi hâlinde ticari elektronik ileti gönderimi ve kampanya duyuruları,",
        "Açık rıza verilmesi hâlinde Meta Pixel/Conversions API ile reklam kampanyalarının ölçümlenmesi.",
      ],
    },
    {
      id: "hukuki-sebep",
      heading: "4. Hukuki Sebepler",
      body: [
        "KVKK m.5/2-c: Sözleşmenin kurulması ve ifası için gerekli olması,",
        "KVKK m.5/2-ç: Veri sorumlusunun hukuki yükümlülüğünü yerine getirmesi,",
        "KVKK m.5/2-f: Meşru menfaat kapsamında güvenlik ve hizmet iyileştirme,",
        "KVKK m.5/1: Pazarlama iletişimi için açık rıza.",
      ],
    },
    {
      id: "aktarim",
      heading: "5. Yurt İçi ve Yurt Dışına Aktarım",
      body: [
        "Kişisel veriler; barındırma, veritabanı, e-posta gönderimi, ödeme altyapısı ve yapay zekâ model sağlayıcıları gibi hizmet sağlayıcılarla, yalnızca hizmetin sunulması amacıyla ve sözleşmesel güvenceler altında paylaşılır.",
        "Pazarlama izni verilmesi hâlinde reklam ölçümü için Meta Platforms ile sınırlı veri (SHA-256 özetli e-posta/kullanıcı kimliği, `_fbp`/`_fbc` çerez kimlikleri, IP adresi, tarayıcı user-agent bilgisi ve olay bilgisi) paylaşılır; ödeme kartı bilgileri paylaşılmaz.",
        "Bazı hizmet sağlayıcıların sunucuları yurt dışında bulunabilir. Bu durumda aktarım, KVKK m.9 kapsamında Kişisel Verileri Koruma Kurulu'nun yeterlilik kararına, standart sözleşmeye, bağlayıcı şirket kurallarına veya açık rızaya dayanılarak gerçekleştirilir.",
        "Aroless, veri minimizasyonu ilkesine uygun olarak yalnızca hizmetin sunulması ve yasal yükümlülüklerin yerine getirilmesi için gerekli kişisel verileri işler; gereksiz verileri toplamaz.",
        "Yasal talep hâlinde yetkili kamu kurum ve kuruluşlarıyla paylaşım yapılabilir.",
      ],
    },
    {
      id: "saklama",
      heading: "6. Saklama Süreleri",
      body: [
        "Üyelik ve hesap verileri, üyelik süresince ve sona ermesinden itibaren işleme amacının gerektirdiği süre boyunca saklanır; amaç sona erdiğinde silinir veya anonim hâle getirilir.",
        "Ticari defter, fatura, muhasebe ve ödeme kayıtları, Türk Ticaret Kanunu ve vergi mevzuatı uyarınca 10 yıl saklanır. Bu kayıtlar yasal saklama süresi boyunca yalnızca ilgili mevzuatın öngördüğü amaçlarla kullanılır.",
        "Log ve işlem güvenliği kayıtları en az 2 yıl saklanır.",
        "Ticari elektronik ileti onayı İYS üzerinden yönetilir; onay geri alınana kadar, geri alma kaydı ise ispat amacıyla 3 yıl saklanır. Pazarlama verileri bu süre sonunda silinir veya anonimleştirilir.",
      ],
    },
    {
      id: "haklar",
      heading: "7. İlgili Kişinin Hakları (KVKK m.11)",
      body: [
        "Kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme,",
        "İşlenme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme,",
        "Yurt içinde veya yurt dışında verilerin aktarıldığı üçüncü kişileri bilme,",
        "Eksik veya yanlış işlenmiş verilerin düzeltilmesini isteme,",
        "Silinmesini veya yok edilmesini isteme ve bu işlemlerin aktarıldığı üçüncü kişilere bildirilmesini talep etme,",
        "Otomatik sistemlerle analiz sonucu aleyhe bir sonuç ortaya çıkmasına itiraz etme,",
        "Kanuna aykırı işleme nedeniyle zararın giderilmesini talep etme.",
      ],
    },
    {
      id: "basvuru",
      heading: "8. Başvuru Yöntemi",
      body: [
        "Taleplerinizi mk65449191@gmail.com adresine kayıtlı e-posta adresinizden iletebilirsiniz.",
        "Başvurular en geç 30 gün içinde ücretsiz olarak sonuçlandırılır; işlemin ayrıca maliyet gerektirmesi hâlinde Kurul tarifesi uygulanır.",
      ],
    },
  ],
};

export const DPA: LegalDoc = {
  slug: "veri-isleme-sozlesmesi",
  title: "Veri İşleme Sözleşmesi (DPA)",
  short: "Veri İşleme Sözleşmesi",
  summary:
    "Aroless'nın veri işleyen sıfatıyla, müşterinin (veri sorumlusu) verilerini nasıl işlediğini düzenleyen kurumsal ek sözleşme.",
  updated: LAST_UPDATED,
  sections: [
    {
      id: "amac-dpa",
      heading: "1. Amaç ve Roller",
      body: [
        'İşbu Veri İşleme Sözleşmesi ("DPA"), Kullanım Koşulları\'nın ayrılmaz ekidir.',
        "Müşteri, platforma yüklediği son müşteri/tedarikçi verileri bakımından veri sorumlusu; Aroless ise veri işleyen sıfatıyla hareket eder.",
        "Aroless, verileri yalnızca Müşteri'nin belgelenmiş talimatları ve hizmetin ifası doğrultusunda işler.",
      ],
    },
    {
      id: "kapsam-dpa",
      heading: "2. İşlemenin Konusu, Süresi ve Veri Kategorileri",
      body: [
        "Konu: Ürün, tedarikçi, sipariş ve pazar verilerinin analiz edilmesi ve raporlanması.",
        "Süre: Hizmet sözleşmesinin yürürlükte olduğu süre.",
        "Veri kategorileri: iş iletişim bilgileri, tedarikçi kayıtları, ürün ve fiyat verileri, işlem kayıtları.",
        "İlgili kişi grupları: Müşteri çalışanları, tedarikçi yetkilileri, iş ortakları.",
      ],
    },
    {
      id: "altisleyen",
      heading: "3. Alt İşleyenler",
      body: [
        "Aroless, hizmetin sunulması için alt işleyenler kullanabilir (bulut barındırma, veritabanı, e-posta, ödeme ve yapay zekâ model sağlayıcıları).",
        "Her alt işleyen ile bu DPA ile eşdeğer güvence içeren yazılı sözleşme yapılır.",
        "Yeni bir alt işleyen eklenmesi hâlinde Müşteri en az 30 gün önce bilgilendirilir ve makul gerekçeyle itiraz hakkına sahiptir.",
      ],
    },
    {
      id: "guvenlik-dpa",
      heading: "4. Teknik ve İdari Tedbirler",
      body: [
        "Aktarımda TLS 1.2+ ve beklemede AES-256 şifreleme.",
        "Satır bazlı erişim denetimi (RLS), rol tabanlı yetkilendirme ve en az yetki ilkesi.",
        "Merkezi log kaydı, anomali izleme ve düzenli yedekleme.",
        "Personel için gizlilik taahhütnamesi ve düzenli farkındalık eğitimi.",
      ],
    },
    {
      id: "ihlal",
      heading: "5. Veri İhlali Bildirimi",
      body: [
        "Aroless, bir kişisel veri ihlalinden haberdar olmasını takiben gecikmeksizin ve en geç 24 saat içinde Müşteri'yi bilgilendirir.",
        "Bildirim; ihlalin niteliği, etkilenen veri kategorileri, olası sonuçları ve alınan önlemleri içerir.",
        "Kurul'a ve ilgili kişilere bildirim yükümlülüğü veri sorumlusu sıfatıyla Müşteri'ye aittir; Aroless makul desteği sağlar.",
      ],
    },
    {
      id: "ilgili-kisi-talep",
      heading: "6. İlgili Kişi Taleplerine Destek",
      body: [
        "Aroless'ya doğrudan ulaşan ilgili kişi talepleri, gecikmeksizin Müşteri'ye yönlendirilir.",
        "Aroless, talepleri karşılamak için gerekli teknik desteği (erişim, düzeltme, silme, taşınabilirlik) sağlar.",
      ],
    },
    {
      id: "iade-imha",
      heading: "7. Verilerin İadesi ve İmhası",
      body: [
        "Hizmetin sona ermesinden itibaren 30 gün içinde Müşteri verileri talebe göre dışa aktarılır veya silinir.",
        "Yedeklerdeki kopyalar, yedek rotasyon süresi sonunda (en geç 90 gün) imha edilir.",
      ],
    },
    {
      id: "denetim",
      heading: "8. Denetim Hakkı",
      body: [
        "Müşteri, yılda bir kez ve makul bildirimle Aroless'nın bu DPA'ya uyumunu denetleyebilir veya denetim raporlarını talep edebilir.",
        "Denetim, hizmetin işleyişini aksatmayacak şekilde ve gizlilik yükümlülükleri çerçevesinde yürütülür.",
      ],
    },
  ],
};

export const COOKIES: LegalDoc = {
  slug: "cerez-politikasi",
  title: "Çerez Politikası",
  short: "Çerez Politikası",
  summary:
    "Aroless'nın kullandığı çerez türleri, amaçları, saklama süreleri ve tercihlerinizi nasıl yönetebileceğiniz.",
  updated: LAST_UPDATED,
  sections: [
    {
      id: "cerez-nedir",
      heading: "1. Çerez Nedir?",
      body: [
        "Çerezler, ziyaret ettiğiniz web siteleri tarafından tarayıcınıza kaydedilen küçük metin dosyalarıdır.",
        "Aroless; oturumun sürdürülmesi, tercihlerin hatırlanması ve platform performansının ölçülmesi amacıyla çerez ve benzeri teknolojiler (localStorage, sessionStorage) kullanır.",
      ],
    },
    {
      id: "cerez-turleri",
      heading: "2. Kullanılan Çerez Türleri",
      body: [
        "Zorunlu çerezler: Oturum açma, güvenlik ve yük dengeleme için gereklidir; devre dışı bırakılamaz. (Örn. kimlik doğrulama tokenı, velora_cookie_consent)",
        "Analitik çerezler: Sayfa görüntüleme ve özellik kullanımını anonimleştirilmiş şekilde ölçer; ürünü iyileştirmek için kullanılır.",
        "Pazarlama çerezleri: Kampanya performansının ölçülmesi ve ilgi alanına dayalı iletişim için kullanılır; yalnızca açık rıza ile etkinleşir.",
        "Meta Pixel ve Conversions API: Pazarlama izni verdiğinizde Meta Platforms (Facebook/Instagram) reklamlarının ölçümü için ziyaret ve dönüşüm olayları gönderilir. E-posta adresi ve kullanıcı kimliği Meta'ya yalnızca geri döndürülemez SHA-256 özetiyle; reklam eşleştirmesi için `_fbp`/`_fbc` çerez kimlikleri, IP adresi ve tarayıcı user-agent bilgisiyle iletilir. Ödeme kartı bilgileri paylaşılmaz.",
        "Tercih çerezleri: Dil, tema (gece/gündüz) ve para birimi gibi ayarlarınızı hatırlar.",
      ],
    },
    {
      id: "sureler",
      heading: "3. Saklama Süreleri",
      body: [
        "Oturum çerezleri tarayıcı kapatıldığında silinir.",
        "Kalıcı çerezler amaçlarına göre en fazla 12 ay saklanır.",
        "Çerez tercihiniz `velora_cookie_consent` anahtarı ile 12 ay boyunca saklanır.",
      ],
    },
    {
      id: "yonetim",
      heading: "4. Tercihlerinizi Yönetme",
      body: [
        'Sayfa alt bilgisindeki "Çerez Tercihleri" bağlantısı ile dilediğiniz zaman seçiminizi değiştirebilirsiniz.',
        "Tarayıcı ayarlarınızdan da çerezleri silebilir veya engelleyebilirsiniz; zorunlu çerezlerin engellenmesi platformun çalışmasını bozabilir.",
      ],
    },
    {
      id: "ucuncu-taraf",
      heading: "5. Üçüncü Taraf Çerezleri",
      body: [
        "Ödeme sağlayıcısı ve kimlik doğrulama sağlayıcısı gibi entegre hizmetler kendi çerezlerini yerleştirebilir.",
        "Bu çerezler ilgili sağlayıcının gizlilik politikasına tabidir.",
      ],
    },
  ],
};

/**
 * AFFILIATE (INFLUENCER) PROGRAM ŞARTLARI.
 *
 * NEDEN AYRI BELGE: başvuru ekranındaki onay kutusu bir SÖZLEŞME kanıtıdır
 * (`affiliates.terms_accepted_at`). Kabul edilen metnin, kodun gerçekte
 * uyguladığı kurallarla birebir aynı olması gerekir; aksi hâlde komisyon
 * anlaşmazlığında "şartlar yazmıyordu" itirazı haklı çıkar. Bu yüzden oran,
 * 30 günlük bekleme, $75 eşiği ve 12 AYLIK PENCERE burada açıkça yazılır.
 * Sayılar `src/lib/affiliate.ts` / `affiliate-payout.ts` ile aynıdır; biri
 * değişirse bu belge de güncellenmelidir.
 */
export const AFFILIATE_TERMS: LegalDoc = {
  slug: "affiliate-program-sartlari",
  title: "Affiliate (Influencer) Program Şartları",
  short: "Affiliate Program Şartları",
  summary:
    "Aroless'un influencer/affiliate programında komisyon oranı, süresi, ödeme koşulları ve yasak davranışlar.",
  updated: "13 Ekim 2026",
  sections: [
    {
      id: "kapsam",
      heading: "1. Kapsam",
      body: [
        "Bu şartlar, Aroless affiliate programına başvuran ve admin onayıyla programda etkinleşen katılımcılar için geçerlidir.",
        "Başvuruda beyan edilen kitle/kanal bilgileri doğru olmalıdır; yanlış beyan başvurunun reddine veya hesabın askıya alınmasına yol açar.",
        "Başvuru formundaki onay kutusu, bu şartların kabul edildiğinin kanıtı olarak tarih-saat ile birlikte kaydedilir.",
      ],
    },
    {
      id: "komisyon",
      heading: "2. Komisyon Oranı ve Süresi",
      body: [
        "Komisyon oranı varsayılan olarak %30'dur; hesaba özel farklı bir oran tanımlanabilir.",
        "Komisyon, yalnız programda onaylı (verified) hesaplara ve müşterinin başarıyla tamamlanmış ödemelerine göre hesaplanır.",
        "Komisyon ÖDENEN tutar üzerinden hesaplanır: indirim uygulanmış bir alışverişte komisyon da düşer; %100 indirimli (0 tutarlı) ödemede komisyon doğmaz.",
        "Komisyon, müşteri ücretli aboneliğini sürdürdüğü sürece her yenileme ödemesinde yeniden yazılır — ancak bir müşteri için EN FAZLA 12 AY. Müşteri aboneliğini bırakırsa komisyon yalnız ücretli kaldığı ay sayısı kadar olur; 12 ay dolduktan sonra o müşteriden yeni komisyon doğmaz.",
        "Aynı ödeme iki kez komisyona sayılmaz; her ödeme tek bir komisyon satırı üretir.",
      ],
    },
    {
      id: "mahsup",
      heading: "3. İade ve Chargeback (Mahsup)",
      body: [
        "İade edilen veya banka itirazına (chargeback) konu olan bir ödeme için yazılmış komisyon mahsup edilir (ödenmez).",
        "Mahsup edilen ay, 12 aylık komisyon penceresini tüketmez; o ay gelir üretmediği için değerlendirme dışıdır.",
      ],
    },
    {
      id: "odeme",
      heading: "4. Ödeme Koşulları",
      body: [
        "Ödeme eşiği $75'tir. Bunun altındaki bakiyeler birikir ve eşik aşıldığında ödenir.",
        "Bir komisyon, iade/chargeback riskinin kapanması için ödemeden önce 30 GÜN bekletilir. Eşik ve bekleme, ÖDENEBİLİR bakiyeye göre değerlendirilir.",
        "Ödeme Wise veya banka havalesi (IBAN) ile manuel ve dönemsel olarak yapılır. Ödeme bilgisi (yöntem, hesap sahibi, IBAN/Wise e-postası) kayıtlı ve geçerli olmalıdır; IBAN mod-97 kontrolünden geçmelidir, aksi hâlde ödeme yapılamaz.",
        "Her ödeme bir referans numarasıyla kaydedilir; hangi komisyonun ödendiği panelde görünür.",
      ],
    },
    {
      id: "vergi",
      heading: "5. Vergi ve Yasal Yükümlülükler",
      body: [
        "Komisyon geliri katılımcının kendi geliridir; vergi, mükellefiyet ve beyan yükümlülükleri katılımcıya aittir.",
        "Aroless ödemeyi yapar ve mevzuatın gerektirdiği ödeme/vergi kayıtlarını tutar. Vergi kimlik/mükellef numarası alanı OPSİYONELDİR ve şirket olmayan katılımcı için ödeme şartı değildir; ancak Aroless, mevzuatın gerektirdiği hâllerde stopaj, bildirim veya ek belge talep edebilir ve katılımcı bu bilgileri sağlamakla yükümlüdür.",
        "Bazı ülkelerde banka veya Wise, yüksek tutarlı transferlerde ek bilgi isteyebilir; bu durumda talep Aroless tarafından iletilir.",
      ],
    },
    {
      id: "yasaklar",
      heading: "6. Yasak Davranışlar",
      body: [
        "Kendi hesabından veya kendi cihazından kendi kodunu kullanarak komisyon üretmek (kendine atıf) yasaktır; bu tespit edilirse atıf yazılmaz ve hesap askıya alınır.",
        "Sahte hesap, bot trafiği, tıklama yönlendirme hilesi veya kazandığı trafiği yapay olarak şişirme yasaktır.",
        "Aroless adına garanti, kesin kazanç veya resmî temsil iddiası içeren yanıltıcı tanıtım yapılamaz.",
        "Marka adı ve logolar yalnız program kapsamında ve izin verilen biçimde kullanılabilir; spam/e-posta bombardımanı yasaktır.",
        "Aroless, kurallara aykırılık hâlinde doğmuş ama henüz ödenmemiş komisyonların ödenmesini durdurabilir; ödenmiş komisyonlar için geri talep hakkı saklıdır. Ödemenin durdurulup durdurulmayacağı, ihlâlin ağırlığına göre Aroless'in takdirindedir.",
      ],
    },
    {
      id: "degisiklik",
      heading: "7. Değişiklik, Askıya Alma ve Fesih",
      body: [
        "Aroless programı, oranı ve ödeme koşullarını değiştirebilir. Değişiklik yürürlüğe girdiği andan SONRAKİ ödemeler için geçerlidir; o ana kadar doğmuş komisyon hakları korunur.",
        "Aroless, kurallara aykırılık veya kötüye kullanım tespitinde hesabı gerekçesini bildirerek askıya alabilir veya programdan çıkarabilir.",
        "Katılımcı dilediği zaman programdan ayrılabilir; ayrılma anında ödenmemiş ve eşiği geçmiş bakiyesi ödeme koşullarına göre ödenir.",
      ],
    },
    {
      id: "veri",
      heading: "8. Kişisel Veriler",
      body: [
        "Ödeme bilgileri (hesap sahibi, IBAN, Wise e-postası, varsa vergi no) yalnız ödeme yapmak ve kaydını tutmak amacıyla işlenir; satır düzeyi güvenlik (RLS) ile korunur ve yalnız ödeme aşamasında yetkili yönetici tarafından görülür.",
        "Veri işleme detayları için KVKK Aydınlatma Metni geçerlidir.",
      ],
    },
  ],
};

/**
 * ÖN BİLGİLENDİRME FORMU — 6502 m.48 ve Mesafeli Sözleşmeler Yönetmeliği m.5.
 *
 * Tüketici, ödeme yapmadan ÖNCE bu formdaki bilgilerin tamamına ulaşabilmelidir.
 * Bu yüzden satıcı künyesi, tüm vergiler dahil bedel, ifa süresi, cayma hakkı ve
 * uyuşmazlık mercileri ayrı bölümlerdir; metin pazarlama diliyle kısaltılmaz.
 */
export const ON_BILGILENDIRME: LegalDoc = {
  slug: "on-bilgilendirme-formu",
  title: "Ön Bilgilendirme Formu",
  short: "Ön Bilgilendirme Formu",
  summary:
    "6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca, ücretli abonelik satın almadan önce tüketiciye sunulan bilgilendirme formu.",
  updated: LAST_UPDATED,
  sections: [
    {
      id: "satici",
      heading: "1. Satıcı ve Hizmet Sağlayıcı Bilgileri",
      body: [
        "Bu form, 6502 sayılı Tüketicinin Korunması Hakkında Kanun'un 48. maddesi ve Mesafeli Sözleşmeler Yönetmeliği'nin 5. maddesi uyarınca, herhangi bir ödeme yapılmadan önce sunulur.",
        "Satıcı/Hizmet sağlayıcı: Aroless · İnternet sitesi: https://www.aroless.tech · E-posta: mk65449191@gmail.com",
        "Ödeme ve faturalandırma: Paddle (Merchant of Record). Paddle'ın ticari unvanı, kayıtlı adresi, vergi bilgileri ve iletişim bilgileri ödeme ekranında ve faturada gösterilir. Kart bilgileri Aroless'e iletilmez.",
        "Paddle'ın ticari unvanı, kayıtlı adresi, vergi bilgileri ve iletişim bilgileri ödeme ekranında ve faturada gösterilir. Aroless'un kayıtlı ticari unvanı, MERSİS/vergi kimlik numarası, açık adresi ve telefonu için mk65449191@gmail.com adresine başvurulabilir; bu bilgiler ödeme öncesinde talep üzerine iletilir.",
        "Şikâyetler için iletişim: mk65449191@gmail.com. Aroless, şikâyetleri en geç 30 gün içinde yanıtlar.",
      ],
    },
    {
      id: "konu",
      heading: "2. Sözleşmenin Konusu ve Hizmetin Temel Nitelikleri",
      body: [
        "Sözleşmenin konusu, Aroless'in elektronik ortamda sunduğu yapay zekâ destekli e-ticaret altyapısına (SaaS) aylık abonelik erişimidir.",
        "Hizmet; ürün araştırma, tedarikçi analizi, maliyet ve kâr simülasyonu, trend radarı, reklam istihbaratı ve uyum araçlarını içerir. Paket adı, aylık kredi/kullanım limitleri ve özellikler ödeme ekranında ve /pricing sayfasında gösterilir.",
        "Hizmet dijitaldir; fiziksel mal teslimi, kargo veya teslimat adresi yoktur. Hizmete erişim için İnternet bağlantısı, güncel bir tarayıcı ve kullanıcı hesabı gerekir.",
        "Yapay zekâ çıktıları karar destek amaçlıdır; yatırım, hukuki, vergisel veya gümrük danışmanlığı değildir ve belirli bir ticari sonuç garantisi vermez.",
      ],
    },
    {
      id: "fiyat",
      heading: "3. Fiyat, Vergiler, Ödeme ve Ek Masraflar",
      body: [
        "Sözleşme bedeli, ödeme ekranında tüm vergiler dahil olarak gösterilen toplam tutardır. Liste fiyatları USD cinsindendir; TRY karşılığı yalnızca bilgilendirme amaçlıdır ve kart sağlayıcısının kur/komisyon farkı uygulanabilir.",
        "Fiziksel teslimat olmadığı için kargo veya teslim masrafı yoktur. Ödeme ekranında gösterilen toplam tutar dışında zorunlu ek masraf alınmaz.",
        "Ödeme, Paddle üzerinden kredi/banka kartı ile yapılır. Ödeme sağlayıcısı kendi güvenlik ve doğrulama kurallarını uygulayabilir. Fatura Paddle tarafından düzenlenir ve ödeme sonrası e-posta ile iletilir.",
        "Uzaktan iletişim aracının kullanımı için olağan İnternet/telefon tarifeniz dışında Aroless tarafından ayrıca ücret alınmaz.",
        "Fiyat değişiklikleri geriye etkili değildir; yürürlük tarihinden önce bildirilir. Tüketici, esaslı fiyat değişikliğini kabul etmeyerek aboneliğini sona erdirebilir.",
      ],
    },
    {
      id: "ifa",
      heading: "4. İfa, Abonelik Süresi ve Yenileme",
      body: [
        "Abonelik, aksi açıkça belirtilmedikçe bir aylık dönem için kurulur ve tüketici iptal edene kadar her ay otomatik olarak yenilenir.",
        "Hizmete erişim, ödemenin onaylanmasını takiben derhal açılır. Hizmetin ifasına, tüketicinin cayma süresi dolmadan başlanması için ayrıca açık onay alınır (bkz. bölüm 6).",
        "İptal, hesap ayarlarından veya mk65449191@gmail.com adresine yazılı bildirimle her zaman yapılabilir. İptal, içinde bulunulan dönemin sonunda yürürlüğe girer; tüketici dönem sonuna kadar hizmeti kullanmaya devam eder ve sonraki dönem tahsilatı yapılmaz.",
        "Aroless, hizmeti sözleşmeye uygun ve ticari ölçüde makul özenle sunmakla yükümlüdür. Bakım, güvenlik veya teknik zorunluluk hâllerinde hizmette geçici kesintiler olabilir; tüketicinin ayıplı hizmete ilişkin hakları saklıdır.",
        "Depozito, teminat veya ek güvence istenmez. Dijital içerikte tüketiciyi kısıtlayan teknik koruma önlemi uygulanmaz; hizmet standart İnternet tarayıcısıyla çalışır.",
      ],
    },
    {
      id: "cayma",
      heading: "5. Cayma Hakkı, Süresi ve Kullanım Usulü",
      body: [
        "Tüketici, mesafeli sözleşmenin kurulduğu tarihten itibaren 14 gün içinde herhangi bir gerekçe göstermeksizin ve cezai şart ödemeksizin sözleşmeden cayma hakkına sahiptir (6502 sayılı Kanun m.48).",
        "Cayma hakkı süresi hizmet sözleşmelerinde sözleşmenin kurulduğu gün başlar. Cayma bildiriminin süre içinde Aroless'e yöneltilmiş olması yeterlidir.",
        "Cayma bildirimi: mk65449191@gmail.com adresine ad-soyad, sipariş/işlem numarası, hizmetin adı ve bildirim tarihini içerecek şekilde yazılı olarak; veya hesap ayarlarındaki destek kanalından yapılabilir. Aşağıdaki örnek cayma formu da kullanılabilir.",
        "Cayma hakkının kullanılması hâlinde, tahsil edilen tüm ödemeler, bildirimin Aroless'e ulaşmasından itibaren en geç 14 gün içinde, tüketicinin kullandığı ödeme aracına uygun ve tüketiciye herhangi bir masraf veya yükümlülük getirilmeksizin iade edilir (Mesafeli Sözleşmeler Yönetmeliği m.12).",
        "Aroless, cayma hakkı konusunda tüketiciyi bilgilendirdiğini ispatla yükümlüdür. Tüketici gerektiği şekilde bilgilendirilmezse 14 günlük süreyle bağlı olmaz; bu süre her hâlde cayma süresinin bittiği tarihten itibaren bir yıl sonra sona erer (6502 sayılı Kanun m.48).",
        "Örnek cayma formu: “Kime: Aroless, mk65449191@gmail.com. Bu formla aşağıdaki hizmetin satışına ilişkin sözleşmeden cayma hakkımı kullandığımı beyan ederim. Sipariş tarihi/işlem no: … · Hizmet: … · Bedel: … · Tüketicinin adı-soyadı: … · Adresi: … · Tarih: …”",
      ],
    },
    {
      id: "cayma-istisna",
      heading: "6. Cayma Hakkının İstisnası ve Derhal İfa Onayı",
      body: [
        "Mesafeli Sözleşmeler Yönetmeliği m.15/1-(ğ) ve (h) uyarınca; elektronik ortamda anında ifa edilen hizmetlerde veya cayma süresi sona ermeden tüketicinin onayıyla ifaya başlanan hizmetlerde cayma hakkı kullanılamaz.",
        "Aroless, hizmete hemen erişebilmeniz için ödeme öncesinde ayrı bir onay kutusuyla; hizmetin cayma süresi dolmadan derhal ifasına başlanmasını talep ettiğinizi ve bu nedenle cayma hakkınızı kaybedeceğinizi açıkça onaylatır. Bu onayı vermezseniz abonelik başlatılmaz.",
        "Hizmete hemen erişmek istemiyorsanız, 14 günlük cayma süresinin dolmasından sonra başlatılmak üzere mk65449191@gmail.com adresine yazabilirsiniz. Bu durumda cayma hakkınız korunur.",
        "Cayma hakkının kullanıldığı hâllerde hizmete erişim derhal durdurulur; yukarıdaki onay verilmemişse tahsil edilen tüm ödemeler m.12 uyarınca iade edilir.",
      ],
    },
    {
      id: "uyusmazlik-on",
      heading: "7. Şikâyet, Uyuşmazlık ve Yetkili Merciler",
      body: [
        "Tüketici, şikâyetini önce mk65449191@gmail.com adresine iletebilir. Aroless, talebi en geç 30 gün içinde yanıtlar.",
        "Tüketici Hakem Heyeti: Ticaret Bakanlığı'nın her yıl belirlediği parasal sınırın altındaki uyuşmazlıklarda tüketici hakem heyetine başvuru zorunludur. Başvuru, tüketicinin yerleşim yerinde veya tüketici işleminin yapıldığı yerdeki hakem heyetine yapılabilir (6502 sayılı Kanun m.68).",
        "Tüketici Mahkemesi: Parasal sınırın üzerindeki uyuşmazlıklarda ve hakem heyeti kararına itirazda tüketici mahkemesine başvurulur. 6502 sayılı Kanun m.73/A uyarınca dava açmadan önce arabuluculuk dava şartıdır; tüketici hakem heyetinin görevi kapsamındaki uyuşmazlıklar bu şarttan muaftır.",
        "Tüketici, kendi yerleşim yerinde veya tüketici işleminin yapıldığı yerdeki tüketici mahkemesinde dava açabilir. Bu form, tüketicinin kanuni haklarını veya yetki seçimini sınırlandırmaz.",
      ],
    },
    {
      id: "diger-on",
      heading: "8. Diğer Bilgiler ve Yürürlük",
      body: [
        "Bu form, Mesafeli Satış Sözleşmesi'nin ayrılmaz ekidir. Form ile sözleşme arasında çelişki olursa tüketici lehine olan hüküm uygulanır.",
        "Tüketicinin 6502 sayılı Kanun, 6098 sayılı Türk Borçlar Kanunu ve 6698 sayılı KVKK'dan doğan hakları saklıdır. Bu formdaki hiçbir ifade, tüketici aleyhine yorumlanamaz.",
        "Form, ödeme öncesinde elektronik ortamda sunulur; onay tarih-saatiyle birlikte saklanır. Güncel sürüm https://www.aroless.tech/legal/on-bilgilendirme-formu adresindedir.",
      ],
    },
  ],
};

/**
 * MESAFELİ SATIŞ SÖZLEŞMESİ — 6502 m.48 ve Mesafeli Sözleşmeler Yönetmeliği.
 *
 * Ön Bilgilendirme Formu ile birlikte okunur. Abonelik, cayma, iade, ayıplı
 * hizmet ve uyuşmazlık hükümleri burada sözleşme diliyle bağlayıcı hâle gelir.
 */
export const MESAFELI_SATIS: LegalDoc = {
  slug: "mesafeli-satis-sozlesmesi",
  title: "Mesafeli Satış Sözleşmesi",
  short: "Mesafeli Satış Sözleşmesi",
  summary:
    "Aroless dijital aboneliklerinin elektronik ortamda satışına ilişkin taraflar, bedel, ifa, cayma, iade ve uyuşmazlık hükümleri.",
  updated: LAST_UPDATED,
  sections: [
    {
      id: "taraflar-ms",
      heading: "1. Taraflar",
      body: [
        "Satıcı/Hizmet Sağlayıcı: Aroless · https://www.aroless.tech · mk65449191@gmail.com. Ödeme ve faturalandırma Paddle (Merchant of Record) tarafından yürütülür; Paddle'ın ticari unvanı, kayıtlı adresi, vergi bilgileri ve iletişim bilgileri ödeme ekranında ve faturada gösterilir. Aroless'un kayıtlı ticari unvanı, MERSİS/vergi kimlik numarası, açık adres ve telefon bilgileri için mk65449191@gmail.com adresine başvurulabilir.",
        "Alıcı/Tüketici: Ödeme ekranında siparişi onaylayan gerçek kişi. Ad-soyad, e-posta ve fatura bilgileri sipariş sırasında alınır.",
        "Ödeme ve faturalandırma: Paddle (Merchant of Record). Paddle'ın kayıtlı satıcı bilgileri ödeme ekranında ve faturada yer alır. Paddle, ödeme, vergi ve fatura süreçlerini yürütür.",
        "Taraflar, işbu sözleşmenin elektronik ortamda kurulduğunu ve onay kaydının sözleşmenin ispatı için saklanacağını kabul eder.",
      ],
    },
    {
      id: "konu-ms",
      heading: "2. Sözleşmenin Konusu ve Kurulması",
      body: [
        "İşbu sözleşme, 6502 sayılı Tüketicinin Korunması Hakkında Kanun'un 48. maddesi ve Mesafeli Sözleşmeler Yönetmeliği kapsamında, Alıcı'nın elektronik ortamda satın aldığı Aroless dijital aboneliğine ilişkin hak ve yükümlülükleri düzenler.",
        "Sözleşme, Alıcı'nın ödeme ekranında Ön Bilgilendirme Formu'nu ve işbu sözleşmeyi okuyup onaylaması, ardından ödeme yükümlülüğü doğuran satın alma düğmesine tıklamasıyla kurulur.",
        "Ön Bilgilendirme Formu işbu sözleşmenin ayrılmaz ekidir. Sözleşme ile form arasında çelişki olursa tüketici lehine olan hüküm uygulanır.",
      ],
    },
    {
      id: "hizmet-ms",
      heading: "3. Hizmetin Nitelikleri ve İfa",
      body: [
        "Aroless, seçilen pakete göre ürün araştırma, tedarikçi analizi, maliyet/kâr simülasyonu, trend radarı, reklam istihbaratı ve uyum araçlarını dijital ortamda sunar. Paket özellikleri ve kullanım limitleri /pricing sayfasında ve ödeme ekranında gösterilir.",
        "Hizmetin ifasına, ödemenin onaylanmasıyla başlanır. Fiziksel teslimat yoktur; erişim kullanıcı hesabı üzerinden sağlanır.",
        "Aroless, hizmeti sözleşmeye uygun olarak ifa etmekle yükümlüdür. Bakım, güvenlik ve teknik zorunluluklar nedeniyle makul süreli kesintiler olabilir; tüketicinin ayıplı hizmete ilişkin hakları saklıdır.",
        "Yapay zekâ çıktıları karar destek niteliğindedir; yatırım, hukuki, vergisel veya gümrük danışmanlığı değildir. Aroless, çıktıların doğruluğu veya belirli bir ticari sonuç sağlayacağı konusunda garanti vermez; bu hüküm tüketicinin kanuni haklarını sınırlandırmaz.",
      ],
    },
    {
      id: "bedel-ms",
      heading: "4. Bedel, Vergi ve Ödeme",
      body: [
        "Sözleşme bedeli, ödeme ekranında tüm vergiler dahil gösterilen toplam tutardır. Liste fiyatları USD cinsindendir; TRY karşılığı bilgilendirme amaçlıdır. Kart sağlayıcısının kur/komisyon farkı uygulayabileceği ödeme ekranında belirtilir.",
        "Ödeme, Paddle üzerinden kredi/banka kartı ile yapılır. Kart bilgileri Aroless'e iletilmez. Fatura Paddle tarafından düzenlenir.",
        "Ödeme başarısız olursa Aroless hizmeti askıya alabilir; tüketiciye makul bildirim yapılır ve ödeme tamamlandığında erişim yeniden açılır. Tüketicinin yasal hakları saklıdır.",
        "Fiyat değişiklikleri geriye etkili değildir; yürürlük tarihinden önce bildirilir. Tüketici, esaslı fiyat değişikliğini kabul etmeyerek sözleşmeyi feshedebilir.",
      ],
    },
    {
      id: "sure-ms",
      heading: "5. Süre, Yenileme ve İptal",
      body: [
        "Abonelik, aksi açıkça belirtilmedikçe bir aylık dönem için kurulur ve tüketici iptal edene kadar her ay otomatik yenilenir.",
        "Tüketici, hesap ayarlarından veya mk65449191@gmail.com adresine yazılı bildirimle aboneliğini her zaman iptal edebilir. İptal, içinde bulunulan dönemin sonunda yürürlüğe girer; dönem sonuna kadar erişim sürer ve sonraki dönem tahsilatı yapılmaz.",
        "İptal, geçmiş dönem ücretlerini geriye dönük iade etmez. Ancak bu hüküm; cayma hakkı, ayıplı hizmet, haksız şart ve diğer emredici tüketici haklarını ortadan kaldırmaz.",
        "Aroless, aboneliği haklı bir neden olmaksızın sona erdirirse tüketici, kullanılmayan döneme isabet eden bedeli iade alır; diğer yasal hakları saklıdır.",
      ],
    },
    {
      id: "cayma-ms",
      heading: "6. Cayma Hakkı ve İade",
      body: [
        "Tüketici, sözleşmenin kurulduğu tarihten itibaren 14 gün içinde herhangi bir gerekçe göstermeksizin ve cezai şart ödemeksizin sözleşmeden cayma hakkına sahiptir.",
        "Cayma bildirimi, Ön Bilgilendirme Formu'nun 5. bölümünde açıklanan yöntemle mk65449191@gmail.com adresine yapılır. Bildirimin süre içinde gönderilmesi yeterlidir.",
        "Cayma hakkının kullanılması hâlinde, tahsil edilen tüm ödemeler, bildirimin Aroless'e ulaşmasından itibaren en geç 14 gün içinde, kullanılan ödeme aracına uygun ve masrafsız olarak iade edilir.",
        "Cayma hakkı konusunda gerektiği şekilde bilgilendirme yapılmazsa tüketici 14 günlük süreyle bağlı olmaz; süre en geç cayma süresinin bittiği tarihten bir yıl sonra sona erer.",
      ],
    },
    {
      id: "istisna-ms",
      heading: "7. Derhal İfa ve Cayma Hakkının İstisnası",
      body: [
        "Mesafeli Sözleşmeler Yönetmeliği m.15/1-(ğ) ve (h) uyarınca, elektronik ortamda anında ifa edilen hizmetlerde veya cayma süresi dolmadan tüketicinin onayıyla ifaya başlanan hizmetlerde cayma hakkı kullanılamaz.",
        "Aroless, hizmete hemen erişim için ödeme öncesinde ayrı bir onay kutusuyla tüketicinin derhal ifa talebini ve cayma hakkını kaybedeceği bilgisini alır. Bu onay alınmadan abonelik başlatılmaz.",
        "Tüketici, derhal ifa onayı vermek zorunda değildir. Hizmete hemen erişmek istemiyorsa 14 gün sonra başlatılmak üzere Aroless'e başvurabilir; bu durumda cayma hakkı korunur.",
        "Derhal ifa onayı alınmadan hizmet başlatılmışsa tüketici cayma hakkını kullanabilir ve tahsil edilen tüm ödemeler iade edilir.",
      ],
    },
    {
      id: "ayipli-ms",
      heading: "8. Ayıplı Hizmet ve Sorumluluk",
      body: [
        "Aroless, hizmeti sözleşmeye uygun olarak ifa etmekle yükümlüdür. Hizmetin sözleşmede belirlenen sürede başlamaması veya kararlaştırılan/objektif olarak sahip olması gereken özellikleri taşımaması hâlinde hizmet ayıplı sayılır (6502 sayılı Kanun m.13).",
        "Ayıplı hizmet hâlinde tüketici, 6502 sayılı Kanun m.15 uyarınca hizmetin yeniden görülmesi, ayıp oranında bedelden indirim veya sözleşmeden dönme haklarından birini kullanabilir; Türk Borçlar Kanunu uyarınca tazminat da talep edebilir.",
        "Ticari kullanıcılar bakımından Aroless'nın toplam sorumluluğu, ihlal tarihinden önceki 12 ayda ödenen hizmet bedeliyle sınırlıdır; dolaylı zararlar, kâr kaybı ve veri kaybı kapsam dışıdır. Bu sınırlama kasıt, ağır ihmal, hile, ölüm/bedensel zarar ve emredici mevzuat hükümlerini kapsamaz.",
        "Mücbir sebep, doğal afet, salgın, savaş, altyapı/İnternet kesintisi gibi Aroless'nın makul kontrolü dışındaki nedenlerle ifa gecikirse Aroless sorumlu tutulamaz; tüketicinin kanuni hakları saklıdır.",
      ],
    },
    {
      id: "fikri-ms",
      heading: "9. Fikri Mülkiyet ve Kullanım Sınırları",
      body: [
        "Platform yazılımı, arayüzü, modelleri, skorlama metodolojisi ve markası Aroless'ya aittir. Tüketiciye, abonelik süresi boyunca kişisel ve devredilemez bir kullanım lisansı verilir.",
        "Hizmetin tersine mühendisliğe tabi tutulması, otomatik araçlarla toplu veri çekilmesi, API anahtarlarının paylaşılması veya yeniden satılması yasaktır.",
        "Tüketicinin platforma yüklediği veriler kendisine aittir. Tüketici, girdiği veriler ve çıktılar bakımından üçüncü kişilerin fikri mülkiyet ve kişisel veri haklarını ihlal etmemekle yükümlüdür.",
      ],
    },
    {
      id: "uyusmazlik-ms",
      heading: "10. Uyuşmazlık, Yetki ve Yürürlük",
      body: [
        "İşbu sözleşme Türkiye Cumhuriyeti hukukuna tabidir. Tüketici, 6502 sayılı Kanun m.68 uyarınca yerleşim yerindeki veya işlemin yapıldığı yerdeki Tüketici Hakem Heyeti'ne; m.73 uyarınca kendi yerleşim yerindeki veya işlemin yapıldığı yerdeki Tüketici Mahkemesi'ne başvurabilir.",
        "6502 sayılı Kanun m.73/A uyarınca tüketici mahkemesinde dava açmadan önce arabuluculuk dava şartıdır; tüketici hakem heyetinin görevi kapsamındaki uyuşmazlıklar bu şarttan muaftır.",
        "Ticari kullanıcılar bakımından İstanbul (Çağlayan) Mahkemeleri ve İcra Daireleri yetkilidir; ticari uyuşmazlıklarda arabuluculuk dava şartıdır.",
        "Sözleşmenin herhangi bir hükmünün geçersiz sayılması diğer hükümleri etkilemez. Sözleşme, Ön Bilgilendirme Formu ve ödeme ekranındaki onaylarla birlikte taraflar arasındaki anlaşmayı oluşturur.",
      ],
    },
  ],
};

export const LEGAL_DOCS: LegalDoc[] = [
  TOS,
  MESAFELI_SATIS,
  ON_BILGILENDIRME,
  KVKK,
  DPA,
  COOKIES,
  AFFILIATE_TERMS,
];

export const getLegalDoc = (slug: string) => LEGAL_DOCS.find((d) => d.slug === slug);
