import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getMyPlanUsage } from "@/lib/plan-usage.functions";
import { emptyUsageCounts, planUsageRows, type UsageRow } from "@/lib/plan-usage";

/**
 * Bu ayın paket kullanımı (sol bar / üst bar / ayarlar tablosu).
 *
 * NEDEN 30 sn'de bir tazelenir: AI işleri farklı uçlardan koşar (araç ucu,
 * konsey, radar, bulucu). Her ucun arayüzü ayrı ayrı önbellek boşaltmak yerine
 * tek sayaç kaynağı kısa aralıkla okunur — böylece "kullandım ama sayı
 * değişmedi" belirtisi oluşmaz ve gereksiz invalidate çağrısı yazılmaz.
 */
export function usePlanUsage(): {
  rows: UsageRow[];
  loading: boolean;
  measured: boolean;
  /** Paket adı ("Pro", "Free" …) — tablo başlığı için. */
  tier: string | null;
  /** "2026-10" — sayaçların ait olduğu ay. */
  period: string | null;
  isAdmin: boolean;
  refresh: () => void;
} {
  const { user } = useAuth();
  const fn = useServerFn(getMyPlanUsage);
  const q = useQuery({
    queryKey: ["plan-usage", user?.id],
    queryFn: () => fn(),
    enabled: !!user,
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const data = q.data;
  // Sunucu yanıtı gelmeden gösterilecek satırlar: 0 kullanım / bilinmeyen limit.
  // Limit uydurmuyoruz; `loading` bayrağı arayüzde "—" göstermesini sağlar.
  const rows = data?.rows ?? planUsageRows(0, emptyUsageCounts());

  return {
    rows,
    loading: q.isLoading,
    measured: data?.measured ?? false,
    tier: data?.tier ?? null,
    period: data?.period ?? null,
    isAdmin: data?.isAdmin ?? false,
    refresh: () => void q.refetch(),
  };
}
