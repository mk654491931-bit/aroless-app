// Velora derin analiz paneli — duman testi.
//
// Panelin DÜRÜSTLÜK sözleşmesini doğrular: hat koşmadan hiçbir skor gösterilmez
// ve analiz yalnızca geçerli bir nişle başlatılabilir. (Gerçek koşu sunucu
// tarafındadır; burada yalnızca başlangıç durumu render edilir.)
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VeloraDeepAnalysis } from "./velora-deep-analysis";

function render(node: React.ReactElement) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
  );
}

describe("VeloraDeepAnalysis", () => {
  it("niş yazılmadan hiçbir skor göstermez, ne yapılacağını söyler", () => {
    const html = render(<VeloraDeepAnalysis niche="" country="US" platforms={["Amazon"]} />);

    expect(html).toContain("Velora 14 ajan derin analizi");
    expect(html).toContain("en az 2 karakter");
    // Henüz koşmadı: tek bir skor bile render edilmemeli.
    expect(html).not.toContain("/100");
    expect(html).not.toContain("En iyi ürünler");
  });

  it("jeton harcamadığını ve ortak kanıtı açıkça söyler", () => {
    const html = render(<VeloraDeepAnalysis niche="mini ice maker" country="US" platforms={["Amazon"]} />);

    expect(html).toContain("jeton");
    expect(html).toContain("ortak");
    expect(html).not.toContain("/100");
  });
});
