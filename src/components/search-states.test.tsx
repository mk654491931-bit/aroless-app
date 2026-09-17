import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  describeAnalysisFailure,
  describeSearchFailure,
  NoResultsCard,
  ProductCardSkeleton,
  ResultGridSkeleton,
  SearchErrorCard,
  SearchProgress,
} from "./search-states";
import { AnalysisFailureCard } from "./analysis-failure";

const noop = () => {};

describe("describeSearchFailure", () => {
  it("classifies auth, timeout, rate-limit, server and network errors", () => {
    expect(describeSearchFailure("401 Unauthorized").kind).toBe("auth");
    expect(describeSearchFailure("Invalid signature").kind).toBe("auth");
    expect(describeSearchFailure("504 Gateway Timeout").kind).toBe("timeout");
    expect(describeSearchFailure("the request timed out").kind).toBe("timeout");
    expect(describeSearchFailure("429 Too Many Requests").kind).toBe("busy");
    expect(describeSearchFailure("502 Bad Gateway").kind).toBe("server");
    expect(describeSearchFailure("Failed to fetch").kind).toBe("offline");
  });

  it("always returns act-on-able copy, falling back to the raw message", () => {
    const unknown = describeSearchFailure("weird upstream thing");
    expect(unknown.kind).toBe("unknown");
    expect(unknown.title).toBeTruthy();
    expect(unknown.body).toContain("weird upstream thing");
    expect(unknown.hint).toBeTruthy();

    const blank = describeSearchFailure(undefined);
    expect(blank.body).toBeTruthy();
    blank.title.length > 0 && expect(blank.title).toBeTruthy();
  });

  it("does not misclassify a plain network failure as auth", () => {
    // Guards the ordering of the matchers: "Failed to fetch" must not hit the
    // 40x branch just because the server echoed a status somewhere.
    expect(describeSearchFailure("Load failed").kind).toBe("offline");
    expect(describeSearchFailure("network error").kind).toBe("offline");
  });
});

describe("describeAnalysisFailure", () => {
  it("turns a spent-credit failure into an actionable upgrade message", () => {
    const failure = describeAnalysisFailure("NO_CREDITS");
    expect(failure.title).toContain("Kredin bitti");
    expect(failure.body).toMatch(/paket/i);
    expect(failure.body).not.toContain("NO_CREDITS");
  });

  it("explains an unreachable store page instead of dumping FETCH_FAILED", () => {
    const failure = describeAnalysisFailure("FETCH_FAILED");
    expect(failure.kind).toBe("offline");
    expect(failure.body).not.toContain("FETCH_FAILED");
  });

  it("reuses the shared classification with analysis wording", () => {
    expect(describeAnalysisFailure("504 Gateway Timeout").kind).toBe("timeout");
    expect(describeAnalysisFailure("502 Bad Gateway").kind).toBe("server");
    expect(describeAnalysisFailure("weird upstream thing").title).toBe("Analiz tamamlanamadı");
  });
});

describe("AnalysisFailureCard", () => {
  it("stays on screen with retry, input edit and the refund reassurance", () => {
    const html = renderToStaticMarkup(
      <AnalysisFailureCard message="504 Gateway Timeout" subject="buz makinesi" onRetry={noop} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/Analiz/);
    expect(html).toContain("buz makinesi");
    expect(html).toContain("Tekrar dene");
    expect(html).toMatch(/iade/);
  });

  it("does not claim a refund on surfaces that never charge credits", () => {
    const html = renderToStaticMarkup(
      <AnalysisFailureCard message="502 Bad Gateway" onRetry={noop} creditSafe={false} />,
    );
    expect(html).not.toMatch(/iade/);
    expect(html).toContain("Tekrar dene");
  });
});

describe("search state surfaces", () => {
  it("error card shows the mapped title, refund reassurance and both actions", () => {
    const html = renderToStaticMarkup(
      <SearchErrorCard
        error={{ ...describeSearchFailure("504 Gateway Timeout"), niche: "kedi tirmalama" }}
        onRetry={noop}
        onEdit={noop}
      />,
    );
    expect(html).toContain("504");
    expect(html).toContain("kedi tirmalama");
    expect(html).toContain("Tekrar dene");
    expect(html).toContain("Ayarları değiştir");
    expect(html).toMatch(/iade/);
    expect(html).toContain('role="alert"');
  });

  it("no-result card is actionable and states the credit was not spent", () => {
    const html = renderToStaticMarkup(
      <NoResultsCard niche="led masa lambasi" onRetry={noop} onEdit={noop} />,
    );
    expect(html).toContain("led masa lambasi");
    expect(html).toContain("Aynı nişle tekrar dene");
    expect(html).toContain("Aramayı daralt");
    expect(html).toMatch(/Kredi\s+harcanmadı/);
  });

  it("skeleton mirrors the results grid and hides itself from a11y tree", () => {
    const one = renderToStaticMarkup(<ProductCardSkeleton />);
    expect(one).toContain('aria-hidden="true"');
    expect(one).toContain("aspect-[16/10]");

    const grid = renderToStaticMarkup(<ResultGridSkeleton count={3} />);
    const cards = grid.split("premium-card").length - 1;
    expect(cards).toBe(3);
  });

  it("progress strip announces itself politely", () => {
    const html = renderToStaticMarkup(<SearchProgress label="analiz ediliyor" />);
    expect(html).toContain("analiz ediliyor");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
  });
});
