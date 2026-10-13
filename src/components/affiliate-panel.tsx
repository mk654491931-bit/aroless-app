import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BadgeCheck,
  Copy,
  Check,
  Loader2,
  Megaphone,
  Coins,
  CalendarClock,
  ShieldCheck,
  Ticket,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import {
  getMyAffiliateStatus,
  getMyPromoPerformance,
  applyForAffiliate,
  updateMyPayoutProfile,
  type AffiliateSummary,
} from "@/lib/affiliate.functions";
import { DEFAULT_COMMISSION_RATE_PCT, type PayoutMethod } from "@/lib/affiliate";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: {
    label: "İncelemede",
    cls: "border-[oklch(0.72_0.15_70)]/50 bg-[oklch(0.72_0.15_70)]/10 text-[oklch(0.82_0.15_70)]",
  },
  verified: {
    label: "Onaylı Affiliate",
    cls: "border-[oklch(0.75_0.19_150)]/50 bg-[oklch(0.75_0.19_150)]/10 text-[oklch(0.75_0.19_150)]",
  },
  revoked: {
    label: "Askıya alındı",
    cls: "border-[oklch(0.68_0.20_25)]/50 bg-[oklch(0.68_0.20_25)]/10 text-[oklch(0.72_0.19_25)]",
  },
};

export function AffiliatePanel() {
  const qc = useQueryClient();
  const summaryFn = useServerFn(getMyAffiliateStatus);
  const promoFn = useServerFn(getMyPromoPerformance);
  const applyFn = useServerFn(applyForAffiliate);
  const payoutFn = useServerFn(updateMyPayoutProfile);
  const [copied, setCopied] = useState(false);

  // Başvuru formu — şart kabulü ZORUNLU, kitle/kanal adminin değerlendirmesi için.
  const [audience, setAudience] = useState("");
  const [channels, setChannels] = useState("");
  const [socialHandle, setSocialHandle] = useState("");
  const [terms, setTerms] = useState(false);

  // Ödeme bilgisi formu — IBAN mod-97 doğrulaması sunucuda.
  const [payMethod, setPayMethod] = useState<PayoutMethod>("wise");
  const [accountHolder, setAccountHolder] = useState("");
  const [iban, setIban] = useState("");
  const [wiseEmail, setWiseEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [payFormOpen, setPayFormOpen] = useState(false);

  const q = useQuery({ queryKey: ["affiliate"], queryFn: () => summaryFn() });
  // Yalnızca admin'in görevlendirdiği (verified) hesaplar kendi promo kodunun
  // rakamlarını görür; sunucu başka kodların verisini hiç sorgulamaz.
  const promoQ = useQuery({
    queryKey: ["affiliate-promo"],
    queryFn: () => promoFn(),
    enabled: q.data?.status === "verified",
  });

  const apply = useMutation({
    mutationFn: () =>
      applyFn({
        data: {
          audience: audience.trim(),
          channels: channels.trim(),
          socialHandle: socialHandle.trim(),
          termsAccepted: terms,
        },
      }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(
          "Affiliate başvurun alındı — admin onayından sonra komisyon kazanmaya başlarsın.",
        );
        qc.invalidateQueries({ queryKey: ["affiliate"] });
      } else {
        toast.error(res.reason ?? "Başvuru kaydedilemedi, lütfen tekrar dene.");
        qc.invalidateQueries({ queryKey: ["affiliate"] });
      }
    },
    onError: (e: Error) => {
      toast.error(e.message);
      // Sunucuya ulaşılamadıysa panelde "başvurulmadı" gibi görünmesin.
      qc.invalidateQueries({ queryKey: ["affiliate"] });
    },
  });

  const savePayout = useMutation({
    mutationFn: () =>
      payoutFn({
        data: {
          method: payMethod,
          accountHolder: accountHolder.trim(),
          iban: iban.trim() || null,
          wiseEmail: wiseEmail.trim() || null,
          taxId: taxId.trim() || null,
        },
      }),
    onSuccess: (res) => {
      if (res.state.ready) toast.success("Ödeme bilgin kaydedildi.");
      else
        toast.success(
          `Kaydedildi — eksik: ${res.state.missing.join(", ")}. Ödeme bundan önce yapılamaz.`,
        );
      qc.invalidateQueries({ queryKey: ["affiliate"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data: AffiliateSummary | undefined = q.data;
  // Ödeme bloğu eski/eksik yanıtlarda bulunmayabilir; tek yerde normalize edilir.
  const payout = data?.payout ?? null;
  // Paylaşılacak link İKİ FARKLI PROGRAMDIR ve karıştırılmamalıdır:
  //   • `/auth?promo=KOD` → admin'in verdiği affiliate kodu. Sınırsız kayıt,
  //     %30 aylık komisyon — bir müşteri için EN FAZLA 12 AY (müşteri kaç ay
  //     ücretli kaldıysa o kadar; kod `promo_codes.affiliate_id` ile eşlenir).
  //   • `/auth?ref=KOD`   → davet programı. En fazla 2 arkadaş + 1 kredi
  //     (`claimReferral` → referrer_limit) ve ORANSAL komisyon garantisi yok.
  // Ölçülen tuzak: affiliate kodu henüz tanımlanmamışken panel davet linkini
  // "affiliate linkin" gibi gösteriyordu; influencer 3. kullanıcıda sessizce
  // komisyon kaybediyordu. Artık ikisi AYRI etiketlenir.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const affiliateLink = data?.promo_code ? `${origin}/auth?promo=${data.promo_code}` : "";
  const inviteLink =
    !affiliateLink && data?.referral_code ? `${origin}/auth?ref=${data.referral_code}` : "";
  const link = affiliateLink || inviteLink;
  const status = data?.status ?? null;
  const meta = status ? STATUS_META[status] : null;
  const money = (cents: number | undefined) =>
    `$${((cents ?? 0) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Affiliate linkin kopyalandı");
    setTimeout(() => setCopied(false), 1600);
  };

  /** Ödeme formunu açarken KAYITLI değerleri yükle (IBAN güvenlik için boş kalır). */
  const togglePayForm = () => {
    if (payFormOpen) {
      setPayFormOpen(false);
      return;
    }
    setPayMethod(payout?.method ?? "wise");
    setAccountHolder(payout?.account_holder ?? "");
    setIban("");
    setWiseEmail(payout?.wise_email ?? "");
    setTaxId("");
    setPayFormOpen(true);
  };

  return (
    <div className="glass rounded-2xl p-5 border border-[oklch(0.62_0.17_255)]/20">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Megaphone size={18} className="text-[oklch(0.62_0.17_255)]" />
          <h2 className="font-semibold">Affiliate Programı · Mikro-influencer</h2>
        </div>
        {status && meta && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.cls}`}
          >
            {status === "verified" ? <BadgeCheck size={12} /> : <CalendarClock size={12} />}
            {meta.label}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        Davet ettiğin kullanıcıların her başarılı abonelik ödemesinde{" "}
        <b>%{data?.commission_rate_pct ?? DEFAULT_COMMISSION_RATE_PCT} tekrarlayan komisyon</b>{" "}
        kazanırsın — iptal edilene kadar her fatura dönemi. Program yalnızca{" "}
        <b>admin tarafından onaylanmış</b> hesaplara açıktır; başvurun manuel olarak incelenir.
      </p>

      {q.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Yükleniyor…
        </div>
      ) : q.isError ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm">
          <TriangleAlert size={14} className="text-rose-300" />
          <span className="text-rose-200">Affiliate durumu yüklenemedi.</span>
          <button
            onClick={() => q.refetch()}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs hover:bg-white/10"
          >
            Tekrar dene
          </button>
        </div>
      ) : (
        <>
          {!status && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (terms && !apply.isPending) apply.mutate();
              }}
              className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <p className="text-sm">
                Kitle oluşturmuş bir içerik üreticisi veya mikro-influencer mısın? Davet linkinle
                abone olanların ödemelerinden komisyon kazanmaya başla. Başvurun admin tarafından
                incelenir.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="mb-1 block text-muted-foreground">
                    Kitle (kimlere ulaşıyorsun, kabaca büyüklük)
                  </span>
                  <input
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    maxLength={300}
                    placeholder="Ör. ABD'li e-ticaret satıcıları, ~25K takipçi"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-muted-foreground">
                    Kanallar (YouTube, Instagram, newsletter…)
                  </span>
                  <input
                    value={channels}
                    onChange={(e) => setChannels(e.target.value)}
                    maxLength={300}
                    placeholder="Ör. YouTube + newsletter"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                  />
                </label>
                <label className="text-xs sm:col-span-2">
                  <span className="mb-1 block text-muted-foreground">
                    Ana kanal adresi / kullanıcı adı (opsiyonel)
                  </span>
                  <input
                    value={socialHandle}
                    onChange={(e) => setSocialHandle(e.target.value)}
                    maxLength={160}
                    placeholder="@kanalim veya kanal linki"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                  />
                </label>
              </div>
              <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <a
                    href="/legal/affiliate-program-sartlari"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[oklch(0.75_0.17_255)] underline underline-offset-2"
                  >
                    Affiliate program şartlarını
                  </a>{" "}
                  kabul ediyorum: <b>%30</b> komisyon (bir müşteri için <b>en fazla 12 ay</b> —
                  müşteri kaç ay ücretli kaldıysa o kadar), birikmiş kazanç <b>$75</b> eşiğini
                  geçince ödeme, ödemeden önce <b>30 gün</b> iade/chargeback beklemesi ve iade
                  edilen ödemelerin komisyondan mahsubu.
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    Kendi kodunla kendi hesabından alım yapmak (kendine atıf) yasaktır; tespit
                    edilirse komisyon ödenmez. Vergi/mükellefiyet yükümlülüğü katılımcıya aittir.
                  </span>
                </span>
              </label>
              <button
                type="submit"
                disabled={!terms || apply.isPending}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {apply.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ShieldCheck size={14} />
                )}
                Başvuru yap
              </button>
            </form>
          )}

          {status === "pending" && (
            <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
              Başvurun <b>inceleniyor</b>. Admin onayından sonra bu panelde komisyon linkin
              aktifleşir ve kazançların görünür olur.
            </p>
          )}

          {status === "revoked" && (
            <p className="mt-4 rounded-xl border border-[oklch(0.68_0.20_25)]/30 bg-[oklch(0.68_0.20_25)]/10 p-4 text-sm">
              Affiliate yetkin şu anda <b>askıda</b>. Soruların için destek ekibiyle iletişime geç.
            </p>
          )}

          {/* ÖDEME BİLGİSİ — eksikse ödeme yapılamaz; affiliate kendi girer. */}
          {status && status !== "revoked" && (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Wallet size={15} className="text-[oklch(0.62_0.17_255)]" /> Ödeme bilgin
                </div>
                {payout?.ready ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 px-2 py-0.5 text-[11px] font-semibold text-[oklch(0.8_0.15_150)]">
                    <BadgeCheck size={12} /> Hazır
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[oklch(0.72_0.15_70)]/50 bg-[oklch(0.72_0.15_70)]/10 px-2 py-0.5 text-[11px] font-semibold text-[oklch(0.85_0.1_70)]">
                    <TriangleAlert size={12} /> Eksik
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {payout?.ready ? (
                  <>
                    Yöntem: <b className="text-foreground">{payout.method}</b>
                    {payout.iban_masked ? (
                      <>
                        {" "}
                        · IBAN: <code className="font-mono">{payout.iban_masked}</code>
                      </>
                    ) : null}
                    {payout.wise_email ? <> · Wise: {payout.wise_email}</> : null}
                  </>
                ) : (
                  <>
                    Ödeme yapılabilmesi için yöntem ve hesap bilgisi gerekir. Eksik:{" "}
                    <b className="text-foreground">{(payout?.missing ?? []).join(", ")}</b>
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={togglePayForm}
                className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
              >
                {payFormOpen ? "Kapat" : "Ödeme bilgisini gir / güncelle"}
              </button>

              {payFormOpen && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!savePayout.isPending) savePayout.mutate();
                  }}
                  className="mt-3 grid gap-3 sm:grid-cols-2"
                >
                  <label className="text-xs">
                    <span className="mb-1 block text-muted-foreground">Ödeme yöntemi</span>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value as PayoutMethod)}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                    >
                      <option value="wise">Wise</option>
                      <option value="iban">IBAN (banka havalesi)</option>
                      <option value="other">Diğer</option>
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-muted-foreground">Hesap sahibi adı</span>
                    <input
                      value={accountHolder}
                      onChange={(e) => setAccountHolder(e.target.value)}
                      maxLength={160}
                      required
                      placeholder="Ad Soyad"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                    />
                  </label>
                  {(payMethod === "iban" || payMethod === "wise") && (
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">
                        IBAN {payMethod === "wise" ? "(yoksa Wise e-postası yeterli)" : ""}
                      </span>
                      <input
                        value={iban}
                        onChange={(e) => setIban(e.target.value)}
                        maxLength={64}
                        placeholder="TR\.\."
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                      />
                    </label>
                  )}
                  {payMethod === "wise" && (
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">
                        Wise hesabının e-postası
                      </span>
                      <input
                        type="email"
                        value={wiseEmail}
                        onChange={(e) => setWiseEmail(e.target.value)}
                        maxLength={200}
                        placeholder="sen@ornek.com"
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                      />
                    </label>
                  )}
                  <label className="text-xs">
                    <span className="mb-1 block text-muted-foreground">
                      Vergi kimlik no (opsiyonel — şirket değilsen boş bırak)
                    </span>
                    <input
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      maxLength={64}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                    />
                  </label>
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={savePayout.isPending || !accountHolder.trim()}
                      className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {savePayout.isPending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Wallet size={14} />
                      )}
                      Ödeme bilgini kaydet
                    </button>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      IBAN, mod-97 kontrolünden geçmezse kaydedilmez. Vergi no opsiyoneldir: şirket
                      değilsen boş bırakabilirsin ve bu ödemeni engellemez. Bilgilerin yalnız ödeme
                      yapılırken yönetici tarafından görülür.
                    </p>
                  </div>
                </form>
              )}
            </div>
          )}

          {status === "verified" && (
            <>
              <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {affiliateLink ? "Affiliate linkin" : "Davet linkin"}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm break-all flex-1 min-w-[200px]">
                  {link || "—"}
                </code>
                <button
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />} Kopyala
                </button>
              </div>

              {/* Kod atanmadan önce ne paylaşabileceği DÜRÜSTÇE söylenir. */}
              {!affiliateLink && inviteLink && (
                <p className="mt-2 rounded-xl border border-[oklch(0.72_0.15_70)]/30 bg-[oklch(0.72_0.15_70)]/10 p-3 text-xs text-[oklch(0.85_0.1_70)]">
                  Sana özel <b>affiliate kodun henüz tanımlanmadı</b> — yönetici kodunu
                  tanımladığında burada görünür. O zamana kadar {link} paylaşabilirsin: bu davet
                  programıdır (en fazla 2 arkadaş · 1 kredi) ve %
                  {data?.commission_rate_pct ?? DEFAULT_COMMISSION_RATE_PCT} komisyon yalnız{" "}
                  <b>affiliate koduyla</b> gelen aboneliklerde işler.
                </p>
              )}
              {!link && (
                <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-muted-foreground">
                  Paylaşılacak link henüz oluşmadı. Yönetici sana özel affiliate kodunu
                  tanımladığında burada görünecek.
                </p>
              )}

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Coins size={13} /> Birikmiş (ödenmemiş)
                  </div>
                  <div className="text-2xl font-bold">{money(data?.pending_cents)}</div>
                </div>
                <div className="rounded-xl border border-[oklch(0.75_0.19_150)]/30 bg-[oklch(0.75_0.19_150)]/10 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <BadgeCheck size={13} /> Ödenebilir
                  </div>
                  <div className="text-2xl font-bold text-[oklch(0.8_0.15_150)]">
                    {money(data?.payable_cents)}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarClock size={13} /> Beklemede
                  </div>
                  <div className="text-2xl font-bold">{money(data?.held_cents)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check size={13} /> Ödenen toplam
                  </div>
                  <div className="text-2xl font-bold">{money(data?.paid_cents)}</div>
                </div>
              </div>

              {/* BEKLEME SÜRESİ — iade penceresi kapanmadan para ödenmez. */}
              {(data?.held_cents ?? 0) > 0 && (
                <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-muted-foreground">
                  <CalendarClock size={12} className="mr-1 inline align-[-2px]" />
                  Beklemedeki komisyonlar iade/chargeback riski kapanana kadar (her komisyon için{" "}
                  <b className="text-foreground">30 gün</b>) ödenmez.
                  {data?.next_unlock_at ? (
                    <>
                      {" "}
                      İlk tutar{" "}
                      <b className="text-foreground">
                        {new Date(data.next_unlock_at).toLocaleDateString()}
                      </b>{" "}
                      tarihinde ödenebilir olur.
                    </>
                  ) : null}
                </p>
              )}

              {/* KOMİSYON PENCERESİ — müşteri kaç ay ücretli kaldıysa o kadar, en fazla 12 ay. */}
              <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-muted-foreground">
                <Coins size={12} className="mr-1 inline align-[-2px]" />
                Komisyon, getirdiğin müşteri{" "}
                <b className="text-foreground">ücretli kaldığı sürece</b> her yenilemede yazılır —
                bir müşteri için{" "}
                <b className="text-foreground">en fazla {data?.commission_max_months ?? 12} ay</b>.
                Müşteri erken bırakırsa yalnız ücretli kaldığı ayların komisyonunu kazanırsın.
              </p>

              {data?.totals_exact === false && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Not: komisyon geçmişin çok uzun olduğu için yukarıdaki toplamlar alt sınırdır;
                  ödeme eşiği yönetici ekranındaki kesin toplamla değerlendirilir.
                </p>
              )}

              {/* ÖDEME EŞİĞİ NOTU — ödemeler birikmiş kazanç $75'i geçince yapılır. */}
              <div
                className={`mt-3 flex flex-wrap items-center gap-2 rounded-xl border p-3 text-xs ${
                  data?.payout_eligible
                    ? "border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 text-[oklch(0.85_0.12_150)]"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground"
                }`}
              >
                {data?.payout_eligible ? (
                  <>
                    <BadgeCheck size={13} />
                    <span>
                      <b>Ödemeye hazır.</b> Ödenebilir kazancın {money(data?.min_payout_cents)}{" "}
                      eşiğini geçti; ödemen admin tarafından <b>Wise</b> veya <b>IBAN</b> ile
                      yapılır.
                    </span>
                  </>
                ) : (
                  <>
                    <CalendarClock size={13} />
                    <span>
                      Ödeme eşiği <b className="text-foreground">{money(data?.min_payout_cents)}</b>
                      : ödenebilir kazancın{" "}
                      <b className="text-foreground">{money(data?.payout_remaining_cents)}</b> daha
                      biriktiğinde ödeme yapılır (beklemedeki tutar da toplama girer, süresi
                      dolunca). Bakiye devreder.
                    </span>
                  </>
                )}
              </div>

              {/* Kendi promo kodunun performansı — yalnızca toplamlar. */}
              {promoQ.data && (
                <div className="mt-4 rounded-xl border border-[oklch(0.62_0.17_255)]/30 bg-[oklch(0.62_0.17_255)]/[0.06] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Ticket size={14} className="text-[oklch(0.75_0.19_150)]" />
                    <span className="text-sm font-semibold">Promo kodun</span>
                    <code className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs">
                      {promoQ.data.code}
                    </code>
                    <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px]">
                      Paketin: {promoQ.data.own_tier}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Metric label="Getirdiği kullanıcı" value={promoQ.data.signups} />
                    <Metric label="Pakete dönüşen" value={promoQ.data.purchases} />
                    <Metric label="Dönüşüm" value={`%${promoQ.data.conversion_pct}`} />
                    <Metric
                      label="Toplam ciro"
                      value={`$${(promoQ.data.revenue_cents / 100).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                    />
                  </div>

                  {promoQ.data.by_tier.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                        Kodun getirdiklerinin paketleri
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {promoQ.data.by_tier.map((t) => (
                          <span
                            key={t.tier}
                            className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px]"
                          >
                            {t.tier}: <b className="text-foreground">{t.users}</b>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {promoQ.data.last_signup_at && (
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      Son kayıt: {new Date(promoQ.data.last_signup_at).toLocaleDateString()} · bu
                      bilgiler yalnızca senin koduna aittir.
                    </p>
                  )}
                </div>
              )}

              {(data?.recent.length ?? 0) > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Son komisyonlar
                  </div>
                  <ul className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
                    {data!.recent.slice(0, 5).map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                      >
                        <span className="truncate">
                          {c.tier ?? "Abonelik"} · ${(c.gross_amount_cents / 100).toFixed(2)} ödeme
                        </span>
                        <span className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] ${
                              c.status === "paid"
                                ? "border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 text-[oklch(0.75_0.19_150)]"
                                : c.status === "reversed"
                                  ? "border-[oklch(0.68_0.20_25)]/40 bg-[oklch(0.68_0.20_25)]/10 text-[oklch(0.72_0.19_25)]"
                                  : "border-white/10 bg-white/5 text-muted-foreground"
                            }`}
                          >
                            {c.status === "paid"
                              ? "Ödendi"
                              : c.status === "reversed"
                                ? "İade"
                                : "Bekliyor"}
                          </span>
                          <span
                            className={`font-semibold ${
                              c.status === "reversed"
                                ? "text-muted-foreground line-through"
                                : "text-[oklch(0.75_0.19_150)]"
                            }`}
                          >
                            +${(c.commission_cents / 100).toFixed(2)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Küçük sayı kartı (etiket + değer). */
function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-bold">{value}</div>
    </div>
  );
}
