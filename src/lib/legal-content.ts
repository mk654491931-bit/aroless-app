export type LegalSection = { id: string; heading: string; body: string[] };
export type LegalDoc = {
  slug: string;
  title: string;
  short: string;
  summary: string;
  updated: string;
  sections: LegalSection[];
};

export const LAST_UPDATED = "4 Ağustos 2026";

export const TOS: LegalDoc = {
  slug: "kullanim-kosullari",
  title: "Kullanım Koşulları",
  short: "Kullanım Koşulları",
  summary:
    "Velora B2B e-ticaret altyapı platformunun kullanımına ilişkin hak, yükümlülük ve sorumluluk sınırlarını düzenler.",
  updated: LAST_UPDATED,
  sections: [
    {
      id: "taraflar",
      heading: "1. Taraflar ve Kapsam",
      body: [
        "İşbu Kullanım Koşulları (\"Sözleşme\"); Velora platformunu işleten hizmet sağlayıcı (\"Velora\") ile platforma kayıt olan gerçek veya tüzel kişi kullanıcı (\"Kullanıcı\" veya \"Üye\") arasında elektronik ortamda kurulur.",
        "Platforma kayıt olarak, hesabınızı kullanarak veya hizmetlerin herhangi bir bileşenine erişerek işbu Sözleşme'yi, KVKK Aydınlatma Metni'ni, Veri İşleme Sözleşmesi'ni ve Çerez Politikası'nı okuduğunuzu ve kabul ettiğinizi beyan edersiniz.",
        "Velora, işletmeler arası (B2B) bir yazılım hizmeti (SaaS) sunar; tüketiciye yönelik bir satış platformu değildir.",
      ],
    },
    {
      id: "hizmet",
      heading: "2. Hizmet Tanımı",
      body: [
        "Velora; ürün araştırma, tedarikçi analizi, maliyet ve kâr simülasyonu, trend radarı, reklam istihbaratı ve uyum araçlarından oluşan bir yapay zekâ destekli e-ticaret altyapısıdır.",
        "Platform üzerinde üretilen skorlar, tahminler ve öneriler karar destek amaçlıdır; yatırım, hukuki, vergisel veya gümrük danışmanlığı niteliği taşımaz.",
        "Velora, hizmet kapsamındaki modülleri geliştirmek, değiştirmek veya sonlandırmak hakkını saklı tutar; esaslı değişiklikler makul süre önce Kullanıcı'ya bildirilir.",
      ],
    },
    {
      id: "hesap",
      heading: "3. Hesap Oluşturma ve Güvenlik",
      body: [
        "Kullanıcı, kayıt sırasında verdiği bilgilerin doğru, güncel ve eksiksiz olduğunu taahhüt eder.",
        "Hesap kimlik bilgilerinin gizliliğinden ve hesap üzerinden gerçekleştirilen tüm işlemlerden Kullanıcı sorumludur. Yetkisiz erişim şüphesi derhâl Velora'ya bildirilmelidir.",
        "18 yaşından küçük kişiler ve ticari faaliyet ehliyeti bulunmayanlar platforma üye olamaz.",
      ],
    },
    {
      id: "kredi",
      heading: "4. Abonelik, Kredi ve Ödeme",
      body: [
        "Analiz ve simülasyon işlemleri kredi tüketir. Kredi bakiyesi, paket satın alımı veya abonelik yenilenmesi ile artar.",
        "Ücretler, satın alma anında görüntülenen fiyat listesi üzerinden tahsil edilir. Vergiler yürürlükteki mevzuata göre eklenir.",
        "Tüketilmiş krediler iade edilmez. Hizmetin sunulamadığı teknik kesintilerde tüketilen kredi, talep üzerine Kullanıcı hesabına iade edilir.",
      ],
    },
    {
      id: "yasak",
      heading: "5. Yasaklı Kullanımlar",
      body: [
        "Platformun tersine mühendisliğe tabi tutulması, otomatik araçlarla toplu veri çekilmesi (scraping), API anahtarlarının paylaşılması veya hizmetin yeniden satılması yasaktır.",
        "Yasa dışı, yanıltıcı, üçüncü kişilerin fikri mülkiyet haklarını ihlal eden veya rekabet hukukuna aykırı içerik üretilmesi amacıyla platform kullanılamaz.",
        "İhlal hâlinde Velora, hesabı bildirimsiz askıya alabilir veya kapatabilir.",
      ],
    },
    {
      id: "fikri",
      heading: "6. Fikri Mülkiyet",
      body: [
        "Platform yazılımı, arayüzü, modelleri, skorlama metodolojisi ve markası Velora'ya aittir.",
        "Kullanıcı'nın platforma yüklediği veriler Kullanıcı'ya aittir; Velora bu verileri yalnızca hizmetin sunulması amacıyla işler.",
        "Kullanıcı, platform çıktısı olan raporları kendi ticari faaliyetinde serbestçe kullanabilir.",
      ],
    },
    {
      id: "sorumluluk",
      heading: "7. Sorumluluğun Sınırlandırılması",
      body: [
        "Hizmet \"olduğu gibi\" sunulur. Velora, yapay zekâ çıktılarının doğruluğu, güncelliği veya belirli bir ticari sonucu sağlayacağı konusunda garanti vermez.",
        "Velora'nın toplam sorumluluğu, ihlalin gerçekleştiği tarihten önceki 12 ay içinde Kullanıcı tarafından ödenen toplam hizmet bedeli ile sınırlıdır.",
        "Dolaylı zararlar, kâr kaybı ve veri kaybından doğan talepler kapsam dışıdır.",
      ],
    },
    {
      id: "fesih",
      heading: "8. Sözleşmenin Feshi",
      body: [
        "Kullanıcı, hesabını dilediği zaman kapatarak sözleşmeyi feshedebilir.",
        "Fesih hâlinde hesaba ilişkin veriler, yasal saklama süreleri saklı kalmak kaydıyla 30 gün içinde silinir veya anonim hâle getirilir.",
      ],
    },
    {
      id: "uyusmazlik",
      heading: "9. Uygulanacak Hukuk ve Yetki",
      body: [
        "İşbu Sözleşme Türkiye Cumhuriyeti hukukuna tabidir.",
        "Uyuşmazlıklarda İstanbul (Çağlayan) Mahkemeleri ve İcra Daireleri yetkilidir. Ticari uyuşmazlıklarda arabuluculuk dava şartıdır.",
      ],
    },
    {
      id: "iletisim-tos",
      heading: "10. İletişim",
      body: ["Sözleşmeye ilişkin talepleriniz için: mk65449191@gmail.com"],
    },
  ],
};

export const KVKK: LegalDoc = {
  slug: "kvkk-aydinlatma-metni",
  title: "KVKK Aydınlatma Metni",
  short: "KVKK Aydınlatma Metni",
  summary:
    "6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında, Velora üyelerinin kişisel verilerinin işlenmesine ilişkin aydınlatma metni.",
  updated: LAST_UPDATED,
  sections: [
    {
      id: "veri-sorumlusu",
      heading: "1. Veri Sorumlusunun Kimliği",
      body: [
        "6698 sayılı Kişisel Verilerin Korunması Kanunu (\"KVKK\") uyarınca veri sorumlusu sıfatıyla Velora hareket etmektedir.",
        "İletişim: mk65449191@gmail.com",
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
        "Açık rıza verilmesi hâlinde ticari elektronik ileti gönderimi ve kampanya duyuruları.",
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
        "Bazı hizmet sağlayıcıların sunucuları yurt dışında bulunabilir. Bu durumda aktarım, KVKK m.9 kapsamında standart sözleşme hükümleri veya açık rızaya dayanılarak gerçekleştirilir.",
        "Yasal talep hâlinde yetkili kamu kurum ve kuruluşlarıyla paylaşım yapılabilir.",
      ],
    },
    {
      id: "saklama",
      heading: "6. Saklama Süreleri",
      body: [
        "Üyelik verileri, üyelik süresince ve sona ermesinden itibaren 10 yıl (Türk Ticaret Kanunu) boyunca saklanır.",
        "Log ve işlem güvenliği kayıtları en az 2 yıl saklanır.",
        "Pazarlama izni, izin geri alınana kadar saklanır; geri alma sonrası kayıt 3 yıl ispat amacıyla tutulur.",
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
    "Velora'nın veri işleyen sıfatıyla, müşterinin (veri sorumlusu) verilerini nasıl işlediğini düzenleyen kurumsal ek sözleşme.",
  updated: LAST_UPDATED,
  sections: [
    {
      id: "amac-dpa",
      heading: "1. Amaç ve Roller",
      body: [
        "İşbu Veri İşleme Sözleşmesi (\"DPA\"), Kullanım Koşulları'nın ayrılmaz ekidir.",
        "Müşteri, platforma yüklediği son müşteri/tedarikçi verileri bakımından veri sorumlusu; Velora ise veri işleyen sıfatıyla hareket eder.",
        "Velora, verileri yalnızca Müşteri'nin belgelenmiş talimatları ve hizmetin ifası doğrultusunda işler.",
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
        "Velora, hizmetin sunulması için alt işleyenler kullanabilir (bulut barındırma, veritabanı, e-posta, ödeme ve yapay zekâ model sağlayıcıları).",
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
        "Velora, bir kişisel veri ihlalinden haberdar olmasını takiben gecikmeksizin ve en geç 24 saat içinde Müşteri'yi bilgilendirir.",
        "Bildirim; ihlalin niteliği, etkilenen veri kategorileri, olası sonuçları ve alınan önlemleri içerir.",
        "Kurul'a ve ilgili kişilere bildirim yükümlülüğü veri sorumlusu sıfatıyla Müşteri'ye aittir; Velora makul desteği sağlar.",
      ],
    },
    {
      id: "ilgili-kisi-talep",
      heading: "6. İlgili Kişi Taleplerine Destek",
      body: [
        "Velora'ya doğrudan ulaşan ilgili kişi talepleri, gecikmeksizin Müşteri'ye yönlendirilir.",
        "Velora, talepleri karşılamak için gerekli teknik desteği (erişim, düzeltme, silme, taşınabilirlik) sağlar.",
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
        "Müşteri, yılda bir kez ve makul bildirimle Velora'nın bu DPA'ya uyumunu denetleyebilir veya denetim raporlarını talep edebilir.",
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
    "Velora'nın kullandığı çerez türleri, amaçları, saklama süreleri ve tercihlerinizi nasıl yönetebileceğiniz.",
  updated: LAST_UPDATED,
  sections: [
    {
      id: "cerez-nedir",
      heading: "1. Çerez Nedir?",
      body: [
        "Çerezler, ziyaret ettiğiniz web siteleri tarafından tarayıcınıza kaydedilen küçük metin dosyalarıdır.",
        "Velora; oturumun sürdürülmesi, tercihlerin hatırlanması ve platform performansının ölçülmesi amacıyla çerez ve benzeri teknolojiler (localStorage, sessionStorage) kullanır.",
      ],
    },
    {
      id: "cerez-turleri",
      heading: "2. Kullanılan Çerez Türleri",
      body: [
        "Zorunlu çerezler: Oturum açma, güvenlik ve yük dengeleme için gereklidir; devre dışı bırakılamaz. (Örn. kimlik doğrulama tokenı, velora_cookie_consent)",
        "Analitik çerezler: Sayfa görüntüleme ve özellik kullanımını anonimleştirilmiş şekilde ölçer; ürünü iyileştirmek için kullanılır.",
        "Pazarlama çerezleri: Kampanya performansının ölçülmesi ve ilgi alanına dayalı iletişim için kullanılır; yalnızca açık rıza ile etkinleşir.",
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
        "Sayfa alt bilgisindeki \"Çerez Tercihleri\" bağlantısı ile dilediğiniz zaman seçiminizi değiştirebilirsiniz.",
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

export const LEGAL_DOCS: LegalDoc[] = [TOS, KVKK, DPA, COOKIES];

export const getLegalDoc = (slug: string) => LEGAL_DOCS.find((d) => d.slug === slug);
