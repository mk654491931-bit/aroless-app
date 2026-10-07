-- ============================================================================
-- AFFILIATE KODLARI İNDİRİM VERMEZ — indirimler Paddle'da tanımlanır.
--
-- NEDEN: promo kodları iki işi birlikte yapıyordu (indirim + komisyon atfı).
-- Sahibi indirimleri Paddle panelinden yönettiği için uygulama kodunun
-- indirim taşıması çift kaynak yaratıyordu: Paddle'da tanımlı indirim ile
-- koddaki yüzde çakışabiliyor ve "hangi indirim uygulandı?" sorusunun tek
-- yanıtı kalmıyordu. Artık uygulama kodu YALNIZ atıf/sayım içindir;
-- `discount_pct = 0` "indirim yok" demektir ve checkout'a indirim kodu
-- gönderilmez (kullanıcı kodunu Paddle ekranında kendisi girer).
--
-- Tek kaynak kuralı bozulmasın diye kısıt DB'de de gevşetilir: 0 geçerli bir
-- değerdir. Idempotenttir; tekrar çalıştırmak zarar vermez.
-- ============================================================================

ALTER TABLE public.promo_codes DROP CONSTRAINT IF EXISTS promo_codes_discount_range;

ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_discount_range CHECK (discount_pct >= 0 AND discount_pct <= 100);

-- Yeni kodların varsayılanı indirimsizdir; indirim Paddle'da tanımlanır.
ALTER TABLE public.promo_codes ALTER COLUMN discount_pct SET DEFAULT 0;

COMMENT ON COLUMN public.promo_codes.discount_pct IS
  '0 = indirim yok (yalnız komisyon atfı/sayım). İndirimler Paddle panelinde tanımlanır; uygulama checkout''a indirim kodu göndermez.';
