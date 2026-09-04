/**
 * Admin → Affiliate Partnerleri yönetimi.
 * Sunucu fonksiyonları admin rolüyle korunur (ensureAffiliateAdmin); bu arayüz
 * yalnızca /admin sayfasına gömülür ve her işlem sonrası listeyi tazeler.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Users,
  Megaphone,
  Plus,
  Loader2,
  Power,
  Pencil,
  Eye,
  EyeOff,
  Search,
  Wallet,
  Clock,
  BadgeDollarSign,
  RotateCcw,
  Check,
  Ban,
  X,
  CircleDollarSign,
  CalendarClock,
  UserPlus,
} from "lucide-react";
import {
  listAdminAffiliates,
  createAdminAffiliate,
  updateAdminAffiliate,
  getAdminAffiliateDetail,
  markCommissionsPaid,
  reverseAdminCommission,
  type AdminAffiliateRow,
  type AdminAffiliateDetail,
} from "@/lib/admin-affiliate.functions";

const usd = (c: number) =>
  `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, string> = {
  pending: "Bekliyor",
  paid: "Ödendi",
  reversed: "İptal",
  referred: "Kayıt oldu",
  active: "Aktif abone",
  canceled: "İptal etti",
};

function StatusChip({ status }: { status: string }) {
  const cls =
    status === "paid" || status === "active"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : status === "pending" || status === "referred"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
        : status === "reversed" || status === "canceled"
          ? "border-red-500/30 bg-red-500/10 text-red-300"
          : status === "inactive"
            ? "border-white/10 bg-white/5 text-muted-foreground"
            : "border-white/10 bg-white/5 text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function AdminAffiliates() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAdminAffiliates);
  const createFn = useServerFn(createAdminAffiliate);
  const updateFn = useServerFn(updateAdminAffiliate);
  const detailFn = useServerFn(getAdminAffiliateDetail);
  const payFn = useServerFn(markCommissionsPaid);
  const reverseFn = useServerFn(reverseAdminCommission);

  // ---- Filtreler ----
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const q = useQuery({
    queryKey: ["admin-affiliates", appliedSearch, dateFrom, dateTo],
    queryFn: () =>
      listFn({
        data: {
          search: appliedSearch,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      }),
  });

  // ---- Yeni partner formu ----
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newRate, setNewRate] = useState("30");
  const [newMonths, setNewMonths] = useState("12");

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          email: newEmail.trim() || undefined,
          displayName: newName.trim(),
          code: newCode.trim().toUpperCase() || undefined,
          commissionRatePct: Number(newRate),
          commissionDurationMonths: Number(newMonths),
        },
      }),
    onSuccess: (res) => {
      toast.success(`Partner oluşturuldu · kod: ${res.code}`);
      setShowCreate(false);
      setNewEmail("");
      setNewName("");
      setNewCode("");
      setNewRate("30");
      setNewMonths("12");
      qc.invalidateQueries({ queryKey: ["admin-affiliates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Seçili partner detayı ----
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailQ = useQuery({
    queryKey: ["admin-affiliate-detail", selectedId],
    queryFn: () => detailFn({ data: { affiliateId: selectedId! } }),
    enabled: !!selectedId,
  });
  const detail = detailQ.data as AdminAffiliateDetail | undefined;

  // ---- Düzenleme formu ----
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editMonths, setEditMonths] = useState("");

  const openEdit = (a: AdminAffiliateRow) => {
    setEditName(a.displayName);
    setEditCode(a.referralCode);
    setEditRate(String(a.commissionRatePct));
    setEditMonths(String(a.commissionDurationMonths));
    setEditOpen(true);
  };

  const update = useMutation({
    mutationFn: (patch: {
      displayName?: string;
      code?: string;
      commissionRatePct?: number;
      commissionDurationMonths?: number;
      status?: "active" | "inactive";
    }) => updateFn({ data: { affiliateId: selectedId!, ...patch } }),
    onSuccess: () => {
      toast.success("Güncellendi");
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-affiliates"] });
      qc.invalidateQueries({ queryKey: ["admin-affiliate-detail", selectedId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleStatus = useMutation({
    mutationFn: (a: AdminAffiliateRow) =>
      updateFn({
        data: {
          affiliateId: a.id,
          status: a.status === "active" ? "inactive" : "active",
        },
      }),
    onSuccess: () => {
      toast.success("Durum güncellendi");
      qc.invalidateQueries({ queryKey: ["admin-affiliates"] });
      qc.invalidateQueries({ queryKey: ["admin-affiliate-detail", selectedId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Payout ----
  const [payoutIds, setPayoutIds] = useState<Set<string>>(new Set());

  // ---- Komisyon tarih aralığı filtresi (admin görünümü) ----
  const [commFrom, setCommFrom] = useState("");
  const [commTo, setCommTo] = useState("");
  const visibleCommissions = useMemo(() => {
    const all = detail?.commissions ?? [];
    if (!commFrom && !commTo) return all;
    const from = commFrom ? new Date(`${commFrom}T00:00:00.000Z`).getTime() : -Infinity;
    const to = commTo ? new Date(`${commTo}T23:59:59.999Z`).getTime() : Infinity;
    return all.filter((c) => {
      const t = new Date(c.created_at).getTime();
      return t >= from && t <= to;
    });
  }, [detail, commFrom, commTo]);
  const pendingOfDetail = useMemo(
    () => visibleCommissions.filter((c) => c.status === "pending"),
    [visibleCommissions],
  );
  const togglePayout = (id: string) =>
    setPayoutIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllPending = () =>
    setPayoutIds((prev) => {
      const next = new Set(prev);
      const allSelected =
        pendingOfDetail.length > 0 && pendingOfDetail.every((c) => next.has(c.id));
      if (allSelected) pendingOfDetail.forEach((c) => next.delete(c.id));
      else pendingOfDetail.forEach((c) => next.add(c.id));
      return next;
    });

  const payout = useMutation({
    mutationFn: () => payFn({ data: { ids: [...payoutIds] } }),
    onSuccess: (res) => {
      toast.success(`${res.paid} komisyon ödendi`);
      setPayoutIds(new Set());
      qc.invalidateQueries({ queryKey: ["admin-affiliates"] });
      qc.invalidateQueries({ queryKey: ["admin-affiliate-detail", selectedId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reverse = useMutation({
    mutationFn: (id: string) => reverseFn({ data: { id, reason: "admin_manual" } }),
    onSuccess: (res) => {
      toast.success(`${res.reversed} kayıt iptal edildi`);
      qc.invalidateQueries({ queryKey: ["admin-affiliates"] });
      qc.invalidateQueries({ queryKey: ["admin-affiliate-detail", selectedId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Özetler ----
  const rows = useMemo(() => (q.data as AdminAffiliateRow[] | undefined) ?? [], [q.data]);
  const tot = useMemo(
    () => ({
      pending: rows.reduce((s, r) => s + r.pendingCents, 0),
      paid: rows.reduce((s, r) => s + r.paidCents, 0),
      reversed: rows.reduce((s, r) => s + r.reversedCents, 0),
      active: rows.filter((r) => r.status === "active").length,
    }),
    [rows],
  );

  const aff = detail?.affiliate ?? null;

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Megaphone size={16} className="text-[oklch(0.75_0.18_265)]" /> Affiliate Partnerler
        </h2>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-3 py-1.5 text-xs font-semibold text-white"
        >
          {showCreate ? <X size={13} /> : <Plus size={13} />}
          {showCreate ? "Vazgeç" : "Partner Ekle"}
        </button>
      </div>

      {/* Yeni partner formu */}
      {showCreate && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="grid gap-3 border-b border-white/10 bg-white/[0.02] p-5 sm:grid-cols-2 lg:grid-cols-6"
        >
          <label className="text-xs lg:col-span-2">
            <span className="mb-1 block text-muted-foreground">E-posta (kayıtlı kullanıcı) *</span>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
              placeholder="partner@ornek.com"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Görünen ad</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Marka / influencer"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Kod (opsiyonel)</span>
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase())}
              maxLength={16}
              placeholder="OTOMATİK"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm uppercase outline-none focus:border-[oklch(0.68_0.20_265)]"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Komisyon %</span>
            <input
              type="number"
              min={0}
              max={100}
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Süre (ay)</span>
            <input
              type="number"
              min={1}
              max={24}
              value={newMonths}
              onChange={(e) => setNewMonths(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
            />
          </label>
          <button
            type="submit"
            disabled={create.isPending}
            className="inline-flex items-center justify-center gap-1.5 self-end rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {create.isPending ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <UserPlus size={14} />
            )}
            Oluştur
          </button>
        </form>
      )}

      {/* Filtre satırı + özet */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-3">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setAppliedSearch(search.trim())}
            placeholder="İsim, e-posta veya kod ara…"
            className="w-64 rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-[oklch(0.68_0.20_265)]"
          />
        </div>
        <button
          onClick={() => setAppliedSearch(search.trim())}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
        >
          Ara
        </button>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock size={13} />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-[oklch(0.68_0.20_265)] [color-scheme:dark]"
          />
          <span>→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs outline-none focus:border-[oklch(0.68_0.20_265)] [color-scheme:dark]"
          />
        </div>
        <div className="ml-auto flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-muted-foreground">
            <Users size={10} className="mr-1 inline" />
            {tot.active} aktif
          </span>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-200">
            <Clock size={10} className="mr-1 inline" />
            {usd(tot.pending)} bekleyen
          </span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
            <BadgeDollarSign size={10} className="mr-1 inline" />
            {usd(tot.paid)} ödenen
          </span>
          <span className="rounded-full border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-red-300">
            {usd(tot.reversed)} iptal
          </span>
        </div>
      </div>

      {/* Liste */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-white/[0.02]">
            <tr>
              <Th>Partner</Th>
              <Th>Kod</Th>
              <Th className="text-right">Oran</Th>
              <Th className="text-right">Süre</Th>
              <Th className="text-center">Müşteri</Th>
              <Th className="text-right">Bekleyen</Th>
              <Th className="text-right">Ödenen</Th>
              <Th className="text-right">İptal</Th>
              <Th className="text-center">Durum</Th>
              <Th className="text-right">İşlem</Th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="inline animate-spin" />
                </td>
              </tr>
            )}
            {q.isError && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-sm text-red-300">
                  Liste yüklenemedi — {(q.error as Error).message}
                </td>
              </tr>
            )}
            {!q.isLoading && !q.isError && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-muted-foreground">
                  Henüz affiliate partner yok. “Partner Ekle” ile ilk partnerini oluştur.
                </td>
              </tr>
            )}
            {!q.isLoading &&
              rows.map((a) => (
                <tr
                  key={a.id}
                  className={`border-t border-white/5 hover:bg-white/[0.02] ${selectedId === a.id ? "bg-[oklch(0.68_0.20_265)]/[0.07]" : ""}`}
                >
                  <Td>
                    <div className="font-medium">{a.displayName}</div>
                    <div className="text-[11px] text-muted-foreground">{a.email || "—"}</div>
                  </Td>
                  <Td className="font-mono font-semibold">{a.referralCode}</Td>
                  <Td className="text-right">%{a.commissionRatePct}</Td>
                  <Td className="text-right">{a.commissionDurationMonths} ay</Td>
                  <Td className="text-center">{a.customerCount}</Td>
                  <Td className="text-right text-amber-200">{usd(a.pendingCents)}</Td>
                  <Td className="text-right text-emerald-300">{usd(a.paidCents)}</Td>
                  <Td className="text-right text-muted-foreground line-through">
                    {usd(a.reversedCents)}
                  </Td>
                  <Td className="text-center">
                    <StatusChip status={a.status} />
                  </Td>
                  <Td className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => {
                          setSelectedId((cur) => (cur === a.id ? null : a.id));
                          setEditOpen(false);
                          setPayoutIds(new Set());
                          setCommFrom("");
                          setCommTo("");
                        }}
                        title={selectedId === a.id ? "Kapat" : "İncele"}
                        className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10"
                      >
                        {selectedId === a.id ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button
                        onClick={() => {
                          setSelectedId(a.id);
                          openEdit(a);
                        }}
                        title="Düzenle"
                        className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => toggleStatus.mutate(a)}
                        disabled={toggleStatus.isPending}
                        title={a.status === "active" ? "Pasifleştir" : "Aktifleştir"}
                        className={`rounded-lg border p-1.5 ${
                          a.status === "active"
                            ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                        }`}
                      >
                        <Power size={13} />
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Partner detay paneli */}
      {selectedId && detailQ.isLoading && (
        <div className="border-t border-white/10 p-10 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 animate-spin" /> Detay yükleniyor…
        </div>
      )}
      {selectedId && detailQ.isError && (
        <div className="border-t border-white/10 p-8 text-center text-sm text-red-300">
          Detay yüklenemedi — {(detailQ.error as Error).message}
        </div>
      )}
      {selectedId && aff && detail && (
        <div className="border-t border-white/10 bg-white/[0.015] p-5 space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <h3 className="font-bold flex items-center gap-2">
                <Megaphone size={14} className="text-[oklch(0.75_0.18_265)]" />
                {aff.displayName}
                <StatusChip status={aff.status} />
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {aff.email ?? "—"} · Kod{" "}
                <b className="font-mono text-foreground">{aff.referralCode}</b> · %
                {aff.commissionRatePct} · {aff.commissionDurationMonths} ay · Kayıt:{" "}
                {new Date(aff.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              <StatBox label="Müşteri" value={String(aff.customerCount)} />
              <StatBox label="Bekleyen" value={usd(aff.pendingCents)} tone="amber" />
              <StatBox label="Ödenen" value={usd(aff.paidCents)} tone="green" />
              <StatBox label="İptal" value={usd(aff.reversedCents)} tone="red" />
            </div>
          </div>

          {/* Düzenleme */}
          {editOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                update.mutate({
                  displayName: editName.trim() || undefined,
                  code: editCode.trim().toUpperCase() || undefined,
                  commissionRatePct: editRate ? Number(editRate) : undefined,
                  commissionDurationMonths: editMonths ? Number(editMonths) : undefined,
                });
              }}
              className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-2 lg:grid-cols-5"
            >
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">Görünen ad</span>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">Referans kodu</span>
                <input
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                  maxLength={16}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-sm uppercase outline-none focus:border-[oklch(0.68_0.20_265)]"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">Komisyon %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={editRate}
                  onChange={(e) => setEditRate(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted-foreground">Süre (ay)</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={editMonths}
                  onChange={(e) => setEditMonths(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]"
                />
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  disabled={update.isPending}
                  className="rounded-lg bg-gradient-to-r from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {update.isPending ? (
                    <Loader2 className="mx-auto animate-spin" size={13} />
                  ) : (
                    "Kaydet"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/10"
                >
                  Kapat
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground sm:col-span-5">
                Oran/süre değişiklikleri yalnızca <b>yeni</b> müşterilere uygulanır; mevcut müşteri
                komisyonları ilk ödemedeki sabitlenmiş (snapshot) değerle devam eder.
              </p>
            </form>
          )}

          {/* Müşteriler */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Users size={12} /> Müşteriler ({detail.customers.length})
            </h4>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <Th>Müşteri</Th>
                    <Th>Plan</Th>
                    <Th>Durum</Th>
                    <Th>Kayıt</Th>
                    <Th className="text-right">İlk ödeme</Th>
                    <Th className="text-right">Kazanç</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.customers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                        Henüz müşteri yok
                      </td>
                    </tr>
                  )}
                  {detail.customers.map((c) => (
                    <tr key={c.customerId} className="border-t border-white/5">
                      <Td className="font-medium">{c.email}</Td>
                      <Td>{c.plan ?? "—"}</Td>
                      <Td>
                        <StatusChip status={c.status} />
                      </Td>
                      <Td className="text-muted-foreground">
                        {new Date(c.referredAt).toLocaleDateString()}
                      </Td>
                      <Td className="text-right text-muted-foreground">
                        {c.firstPaidAt ? new Date(c.firstPaidAt).toLocaleDateString() : "—"}
                      </Td>
                      <Td className="text-right font-semibold text-emerald-300">
                        {usd(c.earnedCents)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Komisyonlar + payout */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Wallet size={12} /> Komisyonlar ({visibleCommissions.length})
              </h4>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <CalendarClock size={12} />
                  <input
                    type="date"
                    value={commFrom}
                    onChange={(e) => {
                      setCommFrom(e.target.value);
                      setPayoutIds(new Set());
                    }}
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] outline-none focus:border-[oklch(0.68_0.20_265)] [color-scheme:dark]"
                    title="Komisyon başlangıç tarihi"
                  />
                  <span>→</span>
                  <input
                    type="date"
                    value={commTo}
                    onChange={(e) => {
                      setCommTo(e.target.value);
                      setPayoutIds(new Set());
                    }}
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] outline-none focus:border-[oklch(0.68_0.20_265)] [color-scheme:dark]"
                    title="Komisyon bitiş tarihi"
                  />
                  {(commFrom || commTo) && (
                    <button
                      onClick={() => {
                        setCommFrom("");
                        setCommTo("");
                        setPayoutIds(new Set());
                      }}
                      className="rounded-lg border border-white/10 px-2 py-1 hover:bg-white/10"
                    >
                      <X size={11} className="inline" /> Temizle
                    </button>
                  )}
                </div>
                {pendingOfDetail.length > 0 && (
                  <>
                    <button
                      onClick={toggleAllPending}
                      className="rounded-lg border border-white/10 px-2.5 py-1 text-[10px] hover:bg-white/10"
                    >
                      {pendingOfDetail.every((c) => payoutIds.has(c.id))
                        ? "Tümünü bırak"
                        : `Bekleyenleri seç (${pendingOfDetail.length})`}
                    </button>
                    <button
                      onClick={() => payout.mutate()}
                      disabled={payoutIds.size === 0 || payout.isPending}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/80 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      {payout.isPending ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <CircleDollarSign size={11} />
                      )}
                      {payoutIds.size} kaydı ödendi işaretle
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={
                          pendingOfDetail.length > 0 &&
                          pendingOfDetail.every((c) => payoutIds.has(c.id))
                        }
                        onChange={toggleAllPending}
                        disabled={pendingOfDetail.length === 0}
                        className="accent-[oklch(0.68_0.20_265)]"
                        title="Bekleyenleri seç"
                      />
                    </th>
                    <Th>Tarih</Th>
                    <Th>Müşteri</Th>
                    <Th>Plan</Th>
                    <Th>Ödeme ref.</Th>
                    <Th className="text-right">Ödeme</Th>
                    <Th className="text-right">Oran</Th>
                    <Th className="text-right">Komisyon</Th>
                    <Th className="text-center">Durum</Th>
                    <Th className="text-right">İşlem</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.commissions.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">
                        Henüz komisyon kaydı yok
                      </td>
                    </tr>
                  )}
                  {detail.commissions.length > 0 && visibleCommissions.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">
                        Seçilen tarih aralığında komisyon yok — filtreyi temizle.
                      </td>
                    </tr>
                  )}
                  {visibleCommissions.map((c) => (
                    <tr
                      key={c.id}
                      className={`border-t border-white/5 hover:bg-white/[0.02] ${c.status === "reversed" ? "opacity-60" : ""}`}
                    >
                      <td className="px-3 py-2">
                        {c.status === "pending" ? (
                          <input
                            type="checkbox"
                            checked={payoutIds.has(c.id)}
                            onChange={() => togglePayout(c.id)}
                            className="accent-[oklch(0.68_0.20_265)]"
                          />
                        ) : null}
                      </td>
                      <Td className="text-muted-foreground">
                        {new Date(c.created_at).toLocaleDateString()}
                      </Td>
                      <Td className="font-medium">
                        {detail.customers.find((x) => x.customerId === c.customer_id)?.email ?? "—"}
                      </Td>
                      <Td>{c.plan}</Td>
                      <Td className="font-mono text-[10px] text-muted-foreground">
                        {c.payment_id.slice(0, 18)}…
                      </Td>
                      <Td className="text-right">{usd(c.subscription_amount_cents)}</Td>
                      <Td className="text-right">%{c.commission_rate_pct}</Td>
                      <Td
                        className={`text-right font-semibold ${
                          c.status === "reversed"
                            ? "text-muted-foreground line-through"
                            : c.status === "paid"
                              ? "text-emerald-300"
                              : "text-amber-200"
                        }`}
                      >
                        {usd(c.commission_amount_cents)}
                      </Td>
                      <Td className="text-center">
                        <StatusChip status={c.status} />
                      </Td>
                      <Td className="text-right">
                        {c.status === "pending" && (
                          <button
                            onClick={() => reverse.mutate(c.id)}
                            disabled={reverse.isPending}
                            title="Komisyonu iptal et"
                            className="rounded-lg border border-red-500/30 bg-red-500/10 p-1.5 text-red-300 hover:bg-red-500/20"
                          >
                            <Ban size={12} />
                          </button>
                        )}
                        {c.status === "reversed" && (
                          <span
                            className="text-[10px] text-muted-foreground"
                            title={c.reversed_reason ?? ""}
                          >
                            <RotateCcw size={12} className="inline" /> iptal
                          </span>
                        )}
                        {c.status === "paid" && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
                            <Check size={12} /> ödendi
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "green" | "red";
}) {
  const cls =
    tone === "amber"
      ? "text-amber-200"
      : tone === "green"
        ? "text-emerald-300"
        : tone === "red"
          ? "text-red-300"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className={`text-sm font-bold ${cls}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
