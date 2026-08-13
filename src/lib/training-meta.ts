import { DIFFICULTIES, RUN_LENGTH, netMarginPct, unitProfit, marketShare, type SimState } from "./training-sim";

/* ---------------- XP & levels ---------------- */

export type LevelInfo = { xp: number; level: number; title: string; into: number; need: number; pct: number };

const TITLES = [
  "Çırak Satıcı",
  "Mağaza Sahibi",
  "Performans Pazarlamacı",
  "Marka Kurucusu",
  "Ölçekleme Ustası",
  "Velora Operatörü",
];

/** XP is derived from the run state so it can never be faked by editing storage alone. */
export function computeXp(s: SimState): number {
  const cfg = DIFFICULTIES[s.difficulty];
  const diffMult = s.difficulty === "hard" ? 1.6 : s.difficulty === "normal" ? 1.25 : 1;
  const profitXp = Math.max(0, s.totalProfit) * 0.35;
  const orderXp = s.totalOrders * 4;
  const dayXp = (s.history.length ?? 0) * 12;
  const reviewXp = s.products.reduce((a, p) => a + p.reviews * 2, 0);
  const brandXp = (s.brand ?? 0) * 9;
  const shareXp = (s.share ?? 0) * 700;
  const abXp = (s.abWins ?? 0) * 90;
  const supportXp = (s.supportResolved ?? 0) * 1.2 - (s.slaBreaches ?? 0) * 15;
  const seasonXp = ((s.season ?? 1) - 1) * 500;
  const targetXp = s.totalProfit >= cfg.targetProfit ? 600 : 0;
  return Math.round(Math.max(0,
    (profitXp + orderXp + dayXp + reviewXp + brandXp + shareXp + abXp + supportXp + seasonXp + targetXp) * diffMult,
  ));
}


export function levelFromXp(xp: number): LevelInfo {
  let level = 1;
  let need = 400;
  let rest = xp;
  while (rest >= need && level < 30) {
    rest -= need;
    level += 1;
    need = Math.round(need * 1.35);
  }
  return {
    xp,
    level,
    title: TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 2))],
    into: Math.round(rest),
    need,
    pct: Math.max(0, Math.min(100, (rest / need) * 100)),
  };
}

/* ---------------- Missions ---------------- */

export type Mission = {
  id: string;
  title: string;
  hint: string;
  reward: number;
  tier: 1 | 2 | 3;
  progress: (s: SimState) => { value: number; goal: number };
};

export const MISSIONS: Mission[] = [
  {
    id: "list", tier: 1, reward: 60,
    title: "İlk ürününü vitrine koy",
    hint: "Katalog & Stok sekmesinden araştırdığın ürünlerden birini mağazana ekle.",
    progress: (s) => ({ value: s.products.length, goal: 1 }),
  },
  {
    id: "stock", tier: 1, reward: 80,
    title: "Reklamdan önce stok al",
    hint: "Tedarikçiye sipariş ver; stok yokken reklam harcaması nakit yakar.",
    progress: (s) => ({ value: s.products.reduce((a, p) => a + p.stock + p.incoming.reduce((b, i) => b + i.qty, 0), 0), goal: 25 }),
  },
  {
    id: "firstsale", tier: 1, reward: 100,
    title: "İlk 10 siparişini al",
    hint: "Bütçe aç, günleri ilerlet ve dönüşüm oranını izle.",
    progress: (s) => ({ value: s.totalOrders, goal: 10 }),
  },
  {
    id: "margin", tier: 2, reward: 140,
    title: "Sağlıklı marj kur",
    hint: "En az 2 üründe net marj %25'in üzerinde olsun (fiyat + tedarik maliyeti dengesi).",
    progress: (s) => {
      const cfg = DIFFICULTIES[s.difficulty];
      return { value: s.products.filter((p) => netMarginPct(p, cfg) >= 25).length, goal: 2 };
    },
  },
  {
    id: "roas", tier: 2, reward: 180,
    title: "3x ROAS'a ulaş",
    hint: "Toplam ciro / toplam reklam harcaması ≥ 3 olsun.",
    progress: (s) => {
      const ad = s.history.reduce((a, d) => a + d.adSpend, 0);
      const rev = s.history.reduce((a, d) => a + d.revenue, 0);
      return { value: ad > 0 ? Math.min(3, rev / ad) : 0, goal: 3 };
    },
  },
  {
    id: "reviews", tier: 2, reward: 150,
    title: "Sosyal kanıt biriktir",
    hint: "Toplam 40 değerlendirme topla — organik trafiği besler.",
    progress: (s) => ({ value: s.products.reduce((a, p) => a + p.reviews, 0), goal: 40 }),
  },
  {
    id: "nostockout", tier: 3, reward: 200,
    title: "Stoksuz kalma",
    hint: "10 gün boyunca hiçbir üründe stok tükenmesi yaşamadan ilerle.",
    progress: (s) => ({
      value: s.products.reduce((a, p) => a + p.stockouts, 0) === 0 ? Math.min(10, s.history.length) : 0,
      goal: 10,
    }),
  },
  {
    id: "scale", tier: 3, reward: 260,
    title: "Kârlı ölçeklendir",
    hint: "Günlük reklam bütçesi 100$ üzerindeyken 3 gün üst üste kâr et.",
    progress: (s) => {
      let best = 0, cur = 0;
      for (const d of s.history) { if (d.adSpend >= 100 && d.profit > 0) { cur++; best = Math.max(best, cur); } else cur = 0; }
      return { value: best, goal: 3 };
    },
  },
  {
    id: "target", tier: 3, reward: 400,
    title: "Kâr hedefini geç",
    hint: "Seçtiğin zorluk seviyesinin net kâr hedefine ulaş.",
    progress: (s) => ({ value: Math.max(0, s.totalProfit), goal: DIFFICULTIES[s.difficulty].targetProfit }),
  },
  {
    id: "survive", tier: 3, reward: 320,
    title: `${RUN_LENGTH} günü tamamla`,
    hint: "İflas etmeden sezonu bitir.",
    progress: (s) => ({ value: Math.min(RUN_LENGTH, s.history.length), goal: RUN_LENGTH }),
  },
];

export function missionState(s: SimState) {
  return MISSIONS.map((m) => {
    const { value, goal } = m.progress(s);
    const pct = Math.max(0, Math.min(100, (value / goal) * 100));
    return { ...m, value, goal, pct, done: value >= goal };
  });
}

/* ---------------- Coach ---------------- */

export type Tip = { kind: "warn" | "idea" | "good"; title: string; body: string };

export function coachTips(s: SimState): Tip[] {
  const cfg = DIFFICULTIES[s.difficulty];
  const tips: Tip[] = [];
  const last = s.history[s.history.length - 1];
  const last3 = s.history.slice(-3);
  const dailyAds = s.products.reduce((a, p) => a + (p.listed ? p.adBudget : 0), 0);

  if (s.products.length === 0) {
    tips.push({ kind: "idea", title: "Vitrin boş", body: "Önce Katalog & Stok sekmesinden ürün ekle. Ürün olmadan trafik satın almanın anlamı yok." });
  }
  for (const p of s.products) {
    if (p.listed && p.adBudget > 0 && p.stock <= 0) {
      tips.push({ kind: "warn", title: `${p.name}: stoksuz reklam`, body: "Stok sıfırken tıklama satın alıyorsun. Bütçeyi durdur veya acil sipariş ver." });
    }
    if (unitProfit(p, cfg) <= 0) {
      tips.push({ kind: "warn", title: `${p.name}: negatif birim kâr`, body: `Fiyat ${p.price.toFixed(2)}$ iken komisyon + kargo sonrası zarardasın. Fiyatı yükselt ya da ürünü çıkar.` });
    } else if (netMarginPct(p, cfg) < 15) {
      tips.push({ kind: "idea", title: `${p.name}: marj dar`, body: "Net marj %15'in altında. Küçük bir iade dalgası bile bu ürünü zarara çevirir." });
    }
    if (p.rating < 4 && p.reviews > 5) {
      tips.push({ kind: "warn", title: `${p.name}: puan düşüyor`, body: "Düşük puan iade oranını ve dönüşümü doğrudan bozar. Fiyatı değeriyle hizala." });
    }
    if ((p.fatigue ?? 0) > 0.55 && p.adBudget > 0) {
      tips.push({ kind: "warn", title: `${p.name}: kreatif yorgun`, body: `Yorgunluk %${Math.round((p.fatigue ?? 0) * 100)}. Aynı reklam tıklama başına daha pahalı ve daha az satıyor — yeni kreatif çek ya da bütçeyi birkaç gün dinlendir.` });
    }
    if ((p.returnPool ?? 0) > 25) {
      tips.push({ kind: "good", title: `${p.name}: sadık kitle oluştu`, body: "Geri dönen müşteri havuzun büyüyor; bu trafiği bedava alıyorsun. Stoğu boş bırakma." });
    }
    if ((p.channel ?? "meta") === "tiktok" && p.price > p.recommendedPrice) {
      tips.push({ kind: "idea", title: `${p.name}: kanal-fiyat uyumsuz`, body: "TikTok kitlesi düşük niyetli ve fiyat hassas. Premium fiyat için Google, agresif fiyat için TikTok daha uygun." });
    }
    if (p.stock > 0 && p.listed && p.adBudget === 0 && p.unitsSold < 5) {
      tips.push({ kind: "idea", title: `${p.name}: trafik yok`, body: "Stok var ama bütçe 0. Küçük bir test bütçesiyle (10-25$/gün) veri toplamaya başla." });
    }
  }
  if (dailyAds > 0 && s.cash / dailyAds < 5) {
    tips.push({ kind: "warn", title: "Nakit pisti kısa", body: "Mevcut nakit 5 günlük reklam harcamasını zor karşılıyor. Bütçeyi kıs veya stok alımını ertele." });
  }
  if (last3.length === 3 && last3.every((d) => d.profit < 0)) {
    tips.push({ kind: "warn", title: "3 gündür zarar", body: "Fiyat/bütçe kombinasyonu çalışmıyor. Bütçeyi yarıya indir, fiyatı önerilen fiyata yaklaştır." });
  }
  if (last && last.visitors > 300 && last.orders === 0) {
    tips.push({ kind: "warn", title: "Trafik var, satış yok", body: "Dönüşüm sorunu: fiyat çok yüksek ya da puan düşük. Önce fiyatı test et." });
  }
  const ad = s.history.reduce((a, d) => a + d.adSpend, 0);
  const rev = s.history.reduce((a, d) => a + d.revenue, 0);
  if (ad > 50 && rev / ad >= 3) {
    tips.push({ kind: "good", title: "ROAS güçlü", body: "3x üzeri getiri yakaladın. Stok yetiyorsa bütçeyi %20-30 adımlarla artır." });
  }
  const mi = s.marketIndex ?? 1;
  if (mi < 0.93 && s.products.some((p) => p.price > p.recommendedPrice * mi * 1.05)) {
    tips.push({ kind: "warn", title: "Rakipler fiyat kırdı", body: `Piyasa endeksi ${mi.toFixed(2)}. Fiyatların referansın üzerinde kaldı; dönüşüm düşer. Fiyatı endekse yaklaştır ya da paketle değer yarat.` });
  }
  if (mi > 1.07 && s.products.some((p) => p.price < p.recommendedPrice * mi * 0.98)) {
    tips.push({ kind: "idea", title: "Zam penceresi açık", body: `Piyasa endeksi ${mi.toFixed(2)}; rakipler pahalı. Fiyatı yükselterek marjı büyütebilirsin.` });
  }
  if ((s.loan?.balance ?? 0) > 0) {
    tips.push({ kind: "warn", title: "Kredi faizi işliyor", body: `Borç $${(s.loan?.balance ?? 0).toFixed(0)}, bugüne kadar $${(s.loan?.paidInterest ?? 0).toFixed(2)} faiz ödedin. Nakit rahatladıkça kapat.` });
  }
  if ((s.subscribers ?? 0) >= 60 && (s.day - (s.lastCampaignDay ?? -99)) >= 4) {
    tips.push({ kind: "good", title: "Liste kampanyaya hazır", body: `${Math.floor(s.subscribers ?? 0)} abonen var. Büyüme sekmesinden bedava trafikle sipariş al.` });
  }
  if ((s.upgrades?.length ?? 0) === 0 && s.cash > 400) {
    tips.push({ kind: "idea", title: "Yükseltme almadın", body: "Nakit yeterli. Tek tık ödeme veya 3PL anlaşması her siparişte kalıcı kazanç sağlar." });
  }
  if (s.activeEvent) {
    tips.push({ kind: "idea", title: "Piyasa olayı aktif", body: `${s.activeEvent.text} Bu pencerede bütçeni buna göre ayarla.` });
  }
  if (tips.length === 0) {
    tips.push({ kind: "good", title: "Panel temiz", body: "Kritik bir uyarı yok. Günleri ilerlet ve analitikte dönüşüm eğilimini izle." });
  }
  return tips.slice(0, 6);
}

/* ---------------- Hall of fame ---------------- */

export type RunResult = {
  storeName: string;
  difficulty: string;
  profit: number;
  revenue: number;
  orders: number;
  days: number;
  xp: number;
  status: string;
  at: number;
};

const HOF_KEY = "omni-training-hof-v1";

export function loadHof(): RunResult[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(HOF_KEY) || "[]") as RunResult[]; } catch { return []; }
}

export function saveHof(r: RunResult) {
  if (typeof window === "undefined") return;
  const all = [...loadHof(), r].sort((a, b) => b.profit - a.profit).slice(0, 10);
  window.localStorage.setItem(HOF_KEY, JSON.stringify(all));
}
