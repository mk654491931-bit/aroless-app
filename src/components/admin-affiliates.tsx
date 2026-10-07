import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Banknote, Loader2, Megaphone, ShieldCheck, ShieldX, UserPlus, Wallet } from "lucide-react";
import {
  adminListAffiliatePayouts,
  adminMarkAffiliatePaid,
  adminSetAffiliateStatus,
  adminUpdateAffiliatePayout,
  designateAdminAffiliate,
  findAdminAffiliateTarget,
  type AdminAffiliatePayout,
} from "@/lib/affiliate.functions";
import { DEFAULT_COMMISSION_RATE_PCT, MIN_PAYOUT_CENTS, type PayoutMethod } from "@/lib/affiliate";

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

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, {
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

  const [email, setEmail] = useState("");
  const [rate, setRate] = useState("");
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [method, setMethod] = useState<PayoutMethod>("wise");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

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
      setOpenFor(null);
      setReference("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveDetails = useMutation({
    mutationFn: (v: { userId: string; method: PayoutMethod; note: string }) =>
      saveDetailsFn({ data: { userId: v.userId, method: v.method, note: v.note || null } }),
    onSuccess: () => {
      toast.success("Ödeme bilgisi kaydedildi");
      refresh();
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
          Birikmiş kazanç eşiği geçtiğinde Wise/IBAN ile ödeyip “Ödendi işaretle”ye bas.
        </span>
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
                    saving={saveDetails.isPending}
                    paying={markPaid.isPending}
                    setMethod={setMethod}
                    setReference={setReference}
                    setNote={setNote}
                    onToggle={() => openRow(r)}
                    onSaveDetails={() => saveDetails.mutate({ userId: r.user_id, method, note })}
                    onMarkPaid={() => markPaid.mutate({ userId: r.user_id, method, reference })}
                    onApprove={() => setStatus.mutate({ userId: r.user_id, status: "verified" })}
                    onSuspend={() => setStatus.mutate({ userId: r.user_id, status: "revoked" })}
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
  saving: boolean;
  paying: boolean;
  busy: boolean;
  setMethod: (m: PayoutMethod) => void;
  setReference: (v: string) => void;
  setNote: (v: string) => void;
  onToggle: () => void;
  onSaveDetails: () => void;
  onMarkPaid: () => void;
  onApprove: () => void;
  onSuspend: () => void;
};

/** Tek affiliate satırı + açılır ödeme paneli. */
function FragmentRow({
  row,
  badge,
  open,
  method,
  reference,
  note,
  saving,
  paying,
  busy,
  setMethod,
  setReference,
  setNote,
  onToggle,
  onSaveDetails,
  onMarkPaid,
  onApprove,
  onSuspend,
}: RowProps) {
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
            {/* ÖDEME EŞİĞİ NOTU */}
            <div
              className={`mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-xs ${
                row.eligible
                  ? "border-[oklch(0.75_0.19_150)]/40 bg-[oklch(0.75_0.19_150)]/10 text-[oklch(0.85_0.12_150)]"
                  : "border-white/10 bg-white/[0.02] text-muted-foreground"
              }`}
            >
              {row.eligible ? (
                <>
                  <ShieldCheck size={13} />
                  <span>
                    Ödemeye hazır: birikmiş <b>{money(row.pending_cents)}</b> eşiği (
                    {money(MIN_PAYOUT_CENTS)}) geçti. Wise/IBAN ile gönderdikten sonra işaretle.
                  </span>
                </>
              ) : (
                <>
                  <Banknote size={13} />
                  <span>
                    Ödeme eşiği <b className="text-foreground">{money(MIN_PAYOUT_CENTS)}</b>: ödeme
                    için <b className="text-foreground">{money(row.remaining_cents)}</b> daha
                    birikmeli. Bakiye devreder.
                  </span>
                </>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
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
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">
                  Ödeme bilgisi (IBAN / Wise e-posta)
                </span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="TR.. / influencer@ornek.com"
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
                disabled={paying || !row.eligible}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {paying ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />}
                {money(row.pending_cents)} ödendi işaretle
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
    </>
  );
}
