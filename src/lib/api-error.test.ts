import { describe, expect, it, vi } from "vitest";
import { ApiError, logApiError, setApiErrorReporter } from "@/lib/api-error";

describe("api error reporting seam", () => {
  it("calls the configured reporter", () => {
    const reporter = vi.fn();
    setApiErrorReporter(reporter);
    const error = new ApiError("server_error", "x", 500);
    logApiError(error, { route: "/api/public/tool" });
    expect(reporter).toHaveBeenCalledWith(error, { route: "/api/public/tool" });
    setApiErrorReporter();
  });

  it("defaults to a no-op reporter", () => {
    setApiErrorReporter();
    const error = new ApiError("validation_error", "x", 400);
    expect(() => logApiError(error, { route: "/api/public/tool" })).not.toThrow();
  });
});
