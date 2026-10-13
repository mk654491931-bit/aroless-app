import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Banknote,
  Check,
  Copy,
  Download,
  Loader2,
  Megaphone,
  ShieldCheck,
  ShieldX,
  Ticket,
  TriangleAlert,
  UserPlus,
  Wallet,
} from "lucide-react";
import {
  adminExportAffiliatePayoutCsv,
  adminListAffiliatePayouts,
  adminMarkAffiliatePaid,
  adminSetAffiliateStatus,
  adminUpdateAffiliatePayout,
  designateAdminAffiliate,
  findAdminAffiliateTarget,
  type AdminAffiliatePayout,
} from "@/lib/affiliate.functions";
import {
  AFFILIATE_CODE_DISCOUNT_PCT,
  DEFAULT_COMMISSION_RATE_PCT,
  MIN_PAYOUT_CENTS,
  isValidAffiliateCode,
  type PayoutMethod,
} from "@/lib/affiliate";
import { createPromoCode } from "@/lib/promo.functions";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: {
    label: "Bekliyor",
    cls: "border-[oklch(0.72_0.15_70)]/50 bg-[oklch(0.72_0.15_70)]/10 text-[oklch(0.82_0.15_70)]",
  },
  verified: {
    label: "Onaylı",
    cls: "border-[oklch(0.75_0.19_150)]/50 bg-[oklch(0.75_0.19_150)]/10 text-[oklch(0.75_0.19_150)]",
  },
  revoked: {
    label: "Askıda",
    cls: "border-[oklch(0.68_0.20_25)]/50 bg-[oklch(0.68_0.20_25)]/10 text-[oklch(0.72_0.19_25)]",
  },
};

const money = (cents: number | null | undefined) =>
  `$${((cents ?? 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Admin: affiliate başvurularını onayla ve manuel ödemeleri (Wise/IBAN) yönet. */
export function AdminAffiliates() {
  const qc = useQueryClient();
  const setFn = useServerFn(adminSetAffiliateStatus);
  const findFn = useServerFn(findAdminAffiliateTarget);
  const designateFn = useServerFn(designateAdminAffiliate);
  const listPayoutsFn = useServerFn(adminListAffiliatePayouts);
  const markPaidFn = useServerFn(adminMarkAffiliatePaid);
  const saveDetailsFn = useServerFn(adminUpdateAffiliatePayout);
  const exportCsvFn = useServerFn(adminExportAffiliatePayoutCsv);
  const createCodeFn = useServerFn(createPromoCode);

  const [email, setEmail] = useState("");
  const [rate, setRate] = useState("");
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [method, setMethod] = useState<PayoutMethod>("wise");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  // Yapılandırılmış ödeme alanları — ödeme talimatı bunlardan çıkar.
  const [accountHolder, setAccountHolder] = useState("");
  const [iban, setIban] = useState("");
  const [wiseEmail, setWiseEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  // Kod ELLE yazılır: hangi affiliate'e hangi kodu verdiğini admin belirler.
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState("");
  // Verilen son kod + paylaşım linki (toast kaybolmasın diye panelde de durur).
  const [issued, setIssued] = useState<{ email: string; code: string; link: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const q = useQuery({
    queryKey: ["admin-affiliate-payouts"],
    queryFn: () => listPayoutsFn(),
  });
  const rows = q.data ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-affiliate-payouts"] });
    qc.invalidateQueries({ queryKey: ["admin-affiliates"] });
  };

  const lookup = useMutation({
    mutationFn: (v: string) => findFn({ data: { email: v } }),
  });

  const designate = useMutation({
    mutationFn: (v: string) =>
      designateFn({ data: { email: v, ratePct: rate ? Number(rate) : null } }),
    onSuccess: (res) => {
      toast.success(`${res.target.email} affiliate olarak görevlendirildi`);
      setEmail("");
      setRate("");
      lookup.reset();
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: (v: { userId: string; status: "verified" | "revoked" }) =>
      setFn({ data: { userId: v.userId, status: v.status } }),
    onSuccess: (_res, v) => {
      toast.success(v.status === "verified" ? "Affiliate onaylandı" : "Affiliate askıya alındı");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markPaid = useMutation({
    mutationFn: (v: { userId: string; method: PayoutMethod; reference: string }) =>
      markPaidFn({ data: v }),
    onSuccess: (res) => {
      toast.success(
        `${money(res.paid_cents)} ödendi olarak işaretlendi (${res.paid_count} işlem · ${res.reference})`,
      );
      // Bildirim gönderilemediyse admin bunu BİLMELİ: affiliate ödemeyi yalnız
      // e-postadan öğreniyor olabilir ve sessiz kalırsak kişi parasını almamış
      // sanır. Ödeme kaydı yine geçerlidir; uyarı yalnız bildirimle ilgilidir.
      if (!res.notified) {
        toast.warning("Ödeme bildirimi e-postası gönderilemedi — e-posta servisi kurulu mu?");
      }
      setOpenFor(null);
      setReference("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Admin'in YAZDIĞI kodu bir affiliate'e bağlar.
   *
   * Kod indirim taşımaz (`AFFILIATE_CODE_DISCOUNT_PCT = 0`): indirimler Paddle
   * panelinde tanımlanır. Kod tek işi yapar — kimin getirdiğini ve komisyonun
   * kime gideceğini (`affiliate_id`) belirler. Kod zaten varsa sunucu
   * "Bu kod zaten var." der; sessizce yeniden adlandırmayız, admin karar verir.
   */
  const giveCode = useMutation({
    mutationFn: async (v: { userId: string; email: string | null; code: string }) => {
      return await createCodeFn({
        data: {
          code: v.code.trim().toUpperCase(),
          discount_pct: AFFILIATE_CODE_DISCOUNT_PCT,
          max_redemptions: null,
          expires_at: null,
          affiliate_id: v.userId,
        },
      });
    },
    onSuccess: (row, v) => {
      const link =
        typeof window === "undefined"
          ? ""
          : `${window.location.origin}/auth?promo=${encodeURIComponent(row.code)}`;
      setIssued({ email: v.email ?? "Affiliate", code: row.code, link });
      setCopiedCode(false);
      setCodeFor(null);
      setCodeDraft("");
      toast.success(`${v.email ?? "Affiliate"} için kod bağlandı: ${row.code} (indirimsiz)`);
      refresh();
      qc.invalidateQueries({ queryKey: ["admin-promos"] });
      qc.invalidateQueries({ queryKey: ["admin-promo-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyIssued = async () => {
    if (!issued?.link) return;
    await navigator.clipboard.writeText(issued.link);
    setCopiedCode(true);
    toast.success("Kayıt linki kopyalandı");
    setTimeout(() => setCopiedCode(false), 1600);
  };

  const saveDetails = useMutation({
    mutationFn: (v: {
      userId: string;
      method: PayoutMethod;
      note: string;
      accountHolder: string;
      iban: string;
      wiseEmail: string;
      taxId: string;
    }) =>
      saveDetailsFn({
        data: {
          userId: v.userId,
          method: v.method,
          // Boş alanlar gönderilmez → sunucu mevcut değeri KORUR (sessiz silme yok).
          note: v.note.trim() ? v.note : undefined,
          accountHolder: v.accountHolder.trim() ? v.accountHolder : undefined,
          iban: v.iban.trim() ? v.iban : undefined,
          wiseEmail: v.wiseEmail.trim() ? v.wiseEmail : undefined,
          taxId: v.taxId.trim() ? v.taxId : undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        res.state.ready
          ? "Ödeme bilgisi kaydedildi — ödeme yapılabilir."
          : `Kaydedildi — eksik: ${res.state.missing.join(", ")}. Ödeme bundan önce yapılamaz.`,
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportPayouts = useMutation({
    mutationFn: () => exportCsvFn(),
    onSuccess: (res) => {
      if (typeof window === "undefined") return;
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aroless-affiliate-payouts-${res.generatedAt.slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        res.affiliates === 0
          ? "Ödeme listesi boş — ödenebilir bakiye eşiği geçen affiliate yok."
          : `${res.affiliates} affiliate · ${money(res.totalCents)} listelendi` +
              (res.blockedCount > 0 ? ` (${res.blockedCount} satırda eksik ödeme bilgisi)` : ""),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openRow = (r: AdminAffiliatePayout) => {
    if (openFor === r.user_id) {
      setOpenFor(null);
      return;
    }
    setOpenFor(r.user_id);
    setMethod(r.payout_method ?? "wise");
    setReference("");
    setNote(r.payout_note ?? "");
    setAccountHolder(r.payout_account_holder ?? "");
    // IBAN maskeli geldiği için kayıtlı hâli tekrar yazılmaz; admin gerekirse yeni
    // IBAN girer. Boş bırakmak mevcut değeri SİLER (kaydet ile).
    setIban("");
    setWiseEmail(r.payout_wise_email ?? "");
    setTaxId("");
  };

  const totalPending = rows.reduce((s, r) => s + r.pending_cents, 0);
  const payableCount = rows.filter((r) => r.eligible).length;

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Megaphone size={16} className="text-[oklch(0.62_0.17_255)]" /> Affiliate Programı
        </h2>
        <span className="text-xs text-muted-foreground">
          {rows.filter((r) => r.status === "verified").length} onaylı ·{" "}
          {rows.filter((r) => r.status === "pending").length} bekleyen · {payableCount} ödemeye
          hazır
        </span>
      </div>

      {/* ÖDEME EŞİĞİ ÖZETİ */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 bg-white/[0.02] px-5 py-3 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Wallet size={13} /> Toplam ödenmemiş:
          <b className="text-foreground">{money(totalPending)}</b>
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Banknote size={13} /> Ödeme eşiği:
          <b className="text-foreground">{money(MIN_PAYOUT_CENTS)}</b>
        </span>
        <span className="text-muted-foreground">
          Ödenebilir bakiye eşiği geçtiğinde Wise/IBAN ile ödeyip “Ödendi işaretle”ye bas.
        </span>
        <button
          type="button"
          onClick={() => exportPayouts.mutate()}
          disabled={exportPayouts.isPending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium hover:bg-white/10 disabled:opacity-50"
        >
          {exportPayouts.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Download size={13} />
          )}
          Ödeme listesini indir (CSV)
        </button>
      </div>

      {/* Görevlendirme: başvuru beklenmeden herhangi bir hesabı affiliate yap. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          designate.mutate(email);
        }}
        className="grid gap-3 border-b border-white/10 p-5 sm:grid-cols-[1fr_8rem_auto]"
      >
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">
            Hesabı affiliate olarak görevlendir (e-posta)
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="influencer@ornek.com"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">
            Komisyon oranı % (boş = {DEFAULT_COMMISSION_RATE_PCT})
          </span>
          <input
            type="number"
            min={0}
            max={100}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder={String(DEFAULT_COMMISSION_RATE_PCT)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
          />
        </label>
        <button
          type="submit"
          disabled={designate.isPending}
          className="self-end inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {designate.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <UserPlus size={14} />
          )}
          Görevlendir
        </button>

        <div className="sm:col-span-3 -mt-1 text-xs text-muted-foreground">
          Kod vermek için listeden affiliate'in satırındaki <b>“Kod ver”</b> düğmesini kullan. Kodu
          sen yazarsın; kod <b>indirim taşımaz</b> (indirimler Paddle panelinde tanımlanır), yalnız
          komisyonun kime gideceğini belirler.
        </div>

        {/* Üretilen kod: admin'in kopyalayıp influencer'a gönderebilmesi için. */}
        {issued && (
          <div className="sm:col-span-3 flex flex-wrap items-center gap-2 rounded-lg border border-[oklch(0.75_0.19_150)]/30 bg-[oklch(0.75_0.19_150)]/10 px-3 py-2 text-xs">
            <Ticket size={13} className="text-[oklch(0.75_0.19_150)]" />
            <span>
              <b>{issued.email}</b> için kod hazır:
            </span>
            <code className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] font-semibold">
              {issued.code}
            </code>
            <button
              type="button"
              onClick={copyIssued}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 hover:bg-white/10"
            >
              {copiedCode ? <Check size={12} /> : <Copy size={12} />} Kayıt linkini kopyala
            </button>
            <span className="font-mono text-[10px] text-muted-foreground">{issued.link}</span>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="ml-auto rounded-lg border border-white/10 px-2 py-1 hover:bg-white/10"
            >
              Kapat
            </button>
          </div>
        )}

        <div className="sm:col-span-3 -mt-1 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => lookup.mutate(email)}
            disabled={!email || lookup.isPending}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 hover:bg-white/10 disabled:opacity-50"
          >
            {lookup.isPending ? "Aranıyor…" : "Hesabı kontrol et"}
          </button>
          {lookup.data && (
            <span className="text-muted-foreground">
              <b className="text-foreground">{lookup.data.email}</b> · paket{" "}
              <b className="text-foreground">{lookup.data.tier}</b> · promo kodu{" "}
              <b className="text-foreground">{lookup.data.promo_code ?? "—"}</b> · referral{" "}
              <b className="text-foreground">{lookup.data.referral_code ?? "—"}</b> · mevcut durum{" "}
              <b className="text-foreground">{lookup.data.affiliate_status ?? "yok"}</b>
            </span>
          )}
          {lookup.isError && (
            <span className="text-rose-300">Bu e-posta ile kayıtlı kullanıcı bulunamadı.</span>
          )}
        </div>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
            <tr>
              <th className="px-5 py-3 text-left font-medium">Email</th>
              <th className="px-5 py-3 text-left font-medium">Durum</th>
              <th className="px-5 py-3 text-right font-medium">Oran</th>
              <th className="px-5 py-3 text-left font-medium">Promo kodu</th>
              <th className="px-5 py-3 text-right font-medium">Birikmiş</th>
              <th className="px-5 py-3 text-right font-medium">Ödenmiş</th>
              <th className="px-5 py-3 text-right font-medium">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="inline animate-spin" />
                </td>
              </tr>
            )}
            {!q.isLoading &&
              rows.map((r) => {
                const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending;
                const open = openFor === r.user_id;
                return (
                  <FragmentRow
                    key={r.user_id}
                    row={r}
                    badge={badge}
                    open={open}
                    method={method}
                    reference={reference}
                    note={note}
                    accountHolder={accountHolder}
                    iban={iban}
                    wiseEmail={wiseEmail}
                    taxId={taxId}
                    saving={saveDetails.isPending}
                    paying={markPaid.isPending}
                    setMethod={setMethod}
                    setReference={setReference}
                    setNote={setNote}
                    setAccountHolder={setAccountHolder}
                    setIban={setIban}
                    setWiseEmail={setWiseEmail}
                    setTaxId={setTaxId}
                    onToggle={() => openRow(r)}
                    onSaveDetails={() =>
                      saveDetails.mutate({
                        userId: r.user_id,
                        method,
                        note,
                        accountHolder,
                        iban,
                        wiseEmail,
                        taxId,
                      })
                    }
                    onMarkPaid={() => markPaid.mutate({ userId: r.user_id, method, reference })}
                    onApprove={() => setStatus.mutate({ userId: r.user_id, status: "verified" })}
                    onSuspend={() => setStatus.mutate({ userId: r.user_id, status: "revoked" })}
                    codeOpen={codeFor === r.user_id}
                    codeDraft={codeDraft}
                    setCodeDraft={setCodeDraft}
                    onToggleCode={() => {
                      setCodeDraft("");
                      setCodeFor(codeFor === r.user_id ? null : r.user_id);
                    }}
                    onGiveCode={() =>
                      giveCode.mutate({ userId: r.user_id, email: r.email, code: codeDraft })
                    }
                    issuing={giveCode.isPending && giveCode.variables?.userId === r.user_id}
                    busy={setStatus.isPending}
                  />
                );
              })}
            {!q.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-muted-foreground">
                  Henüz affiliate başvurusu yok
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type RowProps = {
  row: AdminAffiliatePayout;
  badge: { label: string; cls: string };
  open: boolean;
  method: PayoutMethod;
  reference: string;
  note: string;
  accountHolder: string;
  iban: string;
  wiseEmail: string;
  taxId: string;
  saving: boolean;
  paying: boolean;
  busy: boolean;
  setMethod: (m: PayoutMethod) => void;
  setReference: (v: string) => void;
  setNote: (v: string) => void;
  setAccountHolder: (v: string) => void;
  setIban: (v: string) => void;
  setWiseEmail: (v: string) => void;
  setTaxId: (v: string) => void;
  onToggle: () => void;
  onSaveDetails: () => void;
  onMarkPaid: () => void;
  onApprove: () => void;
  onSuspend: () => void;
  /** Kod verme satırı açık mı? */
  codeOpen: boolean;
  codeDraft: string;
  setCodeDraft: (v: string) => void;
  onToggleCode: () => void;
  onGiveCode: () => void;
  issuing: boolean;
};

/** Tek affiliate satırı + açılır ödeme paneli. */
function FragmentRow({
  row,
  badge,
  open,
  method,
  reference,
  note,
  accountHolder,
  iban,
  wiseEmail,
  taxId,
  saving,
  paying,
  busy,
  setMethod,
  setReference,
  setNote,
  setAccountHolder,
  setIban,
  setWiseEmail,
  setTaxId,
  onToggle,
  onSaveDetails,
  onMarkPaid,
  onApprove,
  onSuspend,
  codeOpen,
  codeDraft,
  setCodeDraft,
  onToggleCode,
  onGiveCode,
  issuing,
}: RowProps) {
  // Eski/eksik kayıtlarda alan bulunmayabilir; erişimden önce normalize edilir.
  const missing = row.payout_missing ?? [];
  return (
    <>
      <tr className="border-t border-white/5 hover:bg-white/[0.02]">
        <td className="px-5 py-3 font-medium">{row.email ?? "—"}</td>
        <td className="px-5 py-3">
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
          >
            {badge.label}
          </span>
        </td>
        <td className="px-5 py-3 text-right">%{row.commission_rate_pct}</td>
        <td className="px-5 py-3">
          {row.promo_codes.length > 0 ? (
            <span className="inline-flex flex-wrap gap-1">
              {row.promo_codes.map((c) => (
                <code
                  key={c}
                  className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px]"
                >
                  {c}
                </code>
              ))}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">kod atanmadı</span>
          )}
        </td>
        <td className="px-5 py-3 text-right">
          <div className="font-semibold">{money(row.pending_cents)}</div>
          <div className="text-[10px] text-muted-foreground">{row.pending_count} işlem</div>
          <div className="text-[10px] text-[oklch(0.8_0.15_150)]">
            ödenebilir {money(row.payable_cents)}
          </div>
          {row.held_cents > 0 && (
            <div className="text-[10px] text-muted-foreground">
              beklemede {money(row.held_cents)}
            </div>
          )}
        </td>
        <td className="px-5 py-3 text-right">
          <div className="text-muted-foreground">{money(row.paid_cents)}</div>
          {row.reversed_cents > 0 && (
            <div className="text-[10px] text-[oklch(0.72_0.19_25)]">
              −{money(row.reversed_cents)} iade
            </div>
          )}
        </td>
        <td className="px-5 py-3 text-right whitespace-nowrap">
          <div className="inline-flex flex-wrap justify-end gap-1">
            <button
              onClick={onToggle}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                row.eligible
                  ? "border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 hover:bg-[oklch(0.75_0.19_150)]/20"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <Wallet size={12} /> Ödeme
            </button>
            <button
              onClick={onToggleCode}
              title="Bu affiliate'e kod ver (kodu sen yazarsın)"
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                codeOpen
                  ? "border-[oklch(0.62_0.17_255)]/60 bg-[oklch(0.62_0.17_255)]/20"
                  : "border-[oklch(0.62_0.17_255)]/40 bg-[oklch(0.62_0.17_255)]/10 hover:bg-[oklch(0.62_0.17_255)]/20"
              }`}
            >
              <Ticket size={12} /> Kod ver
            </button>
            {row.status === "verified" ? (
              <button
                onClick={onSuspend}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-[oklch(0.68_0.20_25)]/40 bg-[oklch(0.68_0.20_25)]/10 px-2.5 py-1.5 text-xs font-medium hover:bg-[oklch(0.68_0.20_25)]/20 disabled:opacity-50"
              >
                <ShieldX size={12} /> Askıya al
              </button>
            ) : (
              <button
                onClick={onApprove}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 px-2.5 py-1.5 text-xs font-medium hover:bg-[oklch(0.75_0.19_150)]/20 disabled:opacity-50"
              >
                <ShieldCheck size={12} /> Onayla
              </button>
            )}
          </div>
        </td>
      </tr>

      {open && (
        <tr className="border-t border-white/5 bg-white/[0.03]">
          <td colSpan={7} className="px-5 py-4">
            {/* ÖDEME EŞİĞİ + BEKLEME SÜRESİ NOTU */}
            <div
              className={`mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-xs ${
                row.eligible && missing.length === 0
                  ? "border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 text-[oklch(0.85_0.12_150)]"
                  : "border-white/10 bg-white/[0.02] text-muted-foreground"
              }`}
            >
              {row.eligible && missing.length === 0 ? (
                <>
                  <ShieldCheck size={13} />
                  <span>
                    Ödemeye hazır: <b>ödenebilir</b> {money(row.payable_cents)} eşiği (
                    {money(MIN_PAYOUT_CENTS)}) geçti. Wise/IBAN ile gönderdikten sonra işaretle.
                  </span>
                </>
              ) : !row.eligible ? (
                <>
                  <Banknote size={13} />
                  <span>
                    Ödeme eşiği <b className="text-foreground">{money(MIN_PAYOUT_CENTS)}</b>:
                    ödenebilir bakiye {money(row.payable_cents)} —{" "}
                    <b className="text-foreground">{money(row.remaining_cents)}</b> daha birikmeli.
                  </span>
                </>
              ) : (
                <>
                  <TriangleAlert size={13} className="text-[oklch(0.82_0.15_70)]" />
                  <span>
                    Eşik geçildi ama <b>ödeme bilgisi eksik</b>:{" "}
                    <b className="text-foreground">{missing.join(", ")}</b>. Ödeme bilgisini
                    tamamla.
                  </span>
                </>
              )}
            </div>

            {/* BEKLEME SÜRESİ + BAŞVURU BEYANI */}
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-xs text-muted-foreground">
              <span>
                Ödenebilir: <b className="text-foreground">{money(row.payable_cents)}</b> (
                {row.payable_count ?? 0} işlem)
              </span>
              <span>
                Beklemede (30 gün): <b className="text-foreground">{money(row.held_cents)}</b> (
                {row.held_count ?? 0} işlem)
              </span>
              <span>
                Komisyon penceresi: her müşteri için{" "}
                <b className="text-foreground">en fazla 12 ay</b>
              </span>
              {row.oldest_payable_at && (
                <span>
                  En eski ödenebilir: {new Date(row.oldest_payable_at).toLocaleDateString()}
                </span>
              )}
              {(row.audience || row.channels || row.social_handle) && (
                <span className="basis-full">
                  Başvuru: {row.audience ?? "—"}
                  {row.channels ? <> · kanallar: {row.channels}</> : null}
                  {row.social_handle ? <> · {row.social_handle}</> : null}
                  {row.terms_accepted_at ? (
                    <> · şartlar kabul: {new Date(row.terms_accepted_at).toLocaleDateString()}</>
                  ) : null}
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">Ödeme yöntemi</span>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PayoutMethod)}
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
                  placeholder="Ad Soyad"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">
                  IBAN{" "}
                  {row.payout_iban_masked ? (
                    <code className="font-mono text-[10px]">({row.payout_iban_masked})</code>
                  ) : null}
                </span>
                <input
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  maxLength={64}
                  placeholder={row.payout_iban_masked ? "Değiştirmek için yeni IBAN gir" : "TR.."}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                />
                {row.payout_iban_masked && !row.payout_iban_valid ? (
                  <span className="mt-1 block text-[oklch(0.82_0.15_70)]">
                    Kayıtlı IBAN doğrulanamadı (mod-97).
                  </span>
                ) : null}
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">Wise e-postası</span>
                <input
                  type="email"
                  value={wiseEmail}
                  onChange={(e) => setWiseEmail(e.target.value)}
                  maxLength={200}
                  placeholder="influencer@ornek.com"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">
                  Vergi no (opsiyonel — şirket değilse boş)
                </span>
                <input
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  maxLength={64}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">
                  Ödeme referansı (opsiyonel)
                </span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Wise transfer no / dekont no"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                />
              </label>
              <label className="text-xs lg:col-span-3">
                <span className="mb-1 block text-muted-foreground">Not (opsiyonel)</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ödeme koordinasyonu notu"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={onSaveDetails}
                disabled={saving}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium hover:bg-white/10 disabled:opacity-50"
              >
                Ödeme bilgisini kaydet
              </button>
              <button
                onClick={onMarkPaid}
                disabled={paying || !row.eligible || missing.length > 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {paying ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />}
                {money(row.payable_cents)} ödendi işaretle
              </button>
              <button
                onClick={onToggle}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/10"
              >
                Kapat
              </button>
            </div>
          </td>
        </tr>
      )}

      {/* KOD VERME — kodu admin YAZAR; kod indirim taşımaz, yalnız atıf yapar. */}
      {codeOpen && (
        <tr className="border-t border-white/5 bg-[oklch(0.62_0.17_255)]/[0.04]">
          <td colSpan={7} className="px-5 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">
                  {row.email ?? "Affiliate"} için kod (sen yazarsın)
                </span>
                <input
                  value={codeDraft}
                  onChange={(e) => setCodeDraft(e.target.value.toUpperCase())}
                  maxLength={32}
                  placeholder="ÖRNEK20"
                  className="w-56 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm uppercase outline-none focus:border-[oklch(0.62_0.17_255)]"
                />
              </label>
              <button
                onClick={onGiveCode}
                disabled={issuing || !isValidAffiliateCode(codeDraft)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {issuing ? <Loader2 size={13} className="animate-spin" /> : <Ticket size={13} />} Bu
                kodu ver
              </button>
              <button
                onClick={onToggleCode}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/10"
              >
                Vazgeç
              </button>
              <span className="text-xs text-muted-foreground">
                3-32 karakter, harf/rakam/<code className="font-mono">-</code>/
                <code className="font-mono">_</code> · <b>indirim yok</b>: indirimleri Paddle
                panelinde tanımla; bu kod yalnız komisyonu bu affiliate'e bağlar.
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
