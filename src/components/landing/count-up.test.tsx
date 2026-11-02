import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CountUp } from "./count-up";

describe("CountUp — sunucu çıktısı", () => {
  it("ilk karede 0 değil, gerçek değeri gösterir", () => {
    const html = renderToStaticMarkup(<CountUp end={99.9} decimals={1} suffix="%" />);
    // Regresyon: `useState(0)` SSR'da "0.0%" basıyordu; crawler ve JS'siz
    // ziyaretçi landing metriklerini sıfır sanıyordu.
    expect(html).toContain("99.9%");
    expect(html).not.toContain("0.0%");
  });
});
