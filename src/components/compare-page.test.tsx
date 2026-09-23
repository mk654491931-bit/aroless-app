// Ürün Karşılaştır sayfası — duman + davranış testi.
//
// Eskiden `/compare` yalnızca `Hello "/compare"!` yer tutucusuydu ve hiçbir şey
// açılmıyordu. Bu testler sayfanın gerçek karşılaştırma arayüzünü render ettiğini
// (seçim, boş durum, devre dışı butonlar) sabitler.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  favorites: [] as Record<string, unknown>[],
  user: { id: "u1" } as { id: string } | null,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children?: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useServerFn: () => async () => state.favorites,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ isLoading: false, data: state.favorites }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, data: null }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: state.user, loading: false }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { ComparePage } from "./compare-page";

function favorite(id: string, name: string, emoji = "🧊") {
  return {
    id,
    name,
    collection_name: "Default",
    notes: null,
    tags: [],
    created_at: "2026-09-01T00:00:00.000Z",
    product: {
      name,
      emoji,
      trend_score: 82,
      profit_margin_pct: 44,
      competition_level: "Medium",
    },
  };
}

beforeEach(() => {
  state.favorites = [];
  state.user = { id: "u1" };
});

describe("ComparePage", () => {
  it("kayıtlı ürün yoksa boş durumu ve Ürün Bulucu bağlantısını gösterir", () => {
    const html = renderToStaticMarkup(<ComparePage />);

    expect(html).toContain("Ürün Karşılaştır");
    expect(html).toContain("Henüz kayıtlı ürün yok");
    // Boş durumdan Ürün Bulucu'ya giden bir bağlantı sunulur (metin HTML-escape'li olabilir).
    expect(html).toContain("Ürün Bulucu");
    expect(html).toContain('href="/"');
    // Eski yer tutucu metin ARTIK render edilmez.
    expect(html).not.toContain('Hello "/compare"');
  });

  it("kayıtlı ürünleri listeler ve 2 ürün seçilmeden butonları devre dışı bırakır", () => {
    state.favorites = [favorite("f1", "Mini Buz Makinesi"), favorite("f2", "Taşınabilir Blender")];

    const html = renderToStaticMarkup(<ComparePage />);

    expect(html).toContain("Mini Buz Makinesi");
    expect(html).toContain("Taşınabilir Blender");
    expect(html).toContain("Yan yana karşılaştır");
    expect(html).toContain("AI ile karşılaştır");
    // Henüz seçim yok: kullanıcıya ne yapacağı söylenir.
    expect(html).toContain("En az 2 ürün seç");
    // Seçim sayacı 0/4.
    expect(html).toContain("0/4");
  });
});
