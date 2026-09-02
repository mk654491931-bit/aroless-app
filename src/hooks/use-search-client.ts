/**
 * useSearchClient — crash-free search hook with timeout, abort, and safe state management.
 *
 * Wraps apiPost with an AbortController (10 s default timeout) and exposes
 * `isLoading`, `data`, `error`, and a `search()` trigger so callers never
 * need to manage AbortController or try-catch themselves.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api-client";

/** Default timeout — matches api-client default but callers can override. */
const SEARCH_TIMEOUT_MS = 10_000;

export type SearchStatus = "idle" | "loading" | "success" | "error" | "timeout";

export type SearchClientOptions<TInput, TOutput> = {
  /** Endpoint path, e.g. "/api/public/tool" */
  path: string;
  /** Build the POST body from the user-supplied input. */
  buildBody: (input: TInput) => unknown;
  /** Optional: transform the raw API response into the shape your UI expects. */
  transform?: (raw: unknown) => TOutput;
  /** Timeout in ms. Defaults to 10 000. */
  timeoutMs?: number;
};

export function useSearchClient<TInput, TOutput = unknown>({
  path,
  buildBody,
  transform,
  timeoutMs = SEARCH_TIMEOUT_MS,
}: SearchClientOptions<TInput, TOutput>) {
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [data, setData] = useState<TOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const search = useCallback(
    async (input: TInput): Promise<TOutput | null> => {
      // Abort any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (mountedRef.current) {
        setStatus("loading");
        setError(null);
      }

      const timeoutId = setTimeout(() => {
        controller.abort();
        if (mountedRef.current) {
          setStatus("timeout");
          setError("Arama zaman aşımına uğradı. Lütfen tekrar deneyin.");
        }
      }, timeoutMs);

      try {
        const body = buildBody(input);
        const raw = await apiPost<unknown>(path, body, timeoutMs + 2000);
        clearTimeout(timeoutId);

        if (controller.signal.aborted) return null;

        const result = (transform ? transform(raw) : raw) as TOutput;
        if (mountedRef.current) {
          setData(result);
          setStatus("success");
        }
        return result;
      } catch (e: unknown) {
        clearTimeout(timeoutId);
        if (!mountedRef.current) return null;

        if (controller.signal.aborted) {
          // Already handled by timeout — don't overwrite
          return null;
        }

        const msg =
          (e as Error)?.name === "AbortError"
            ? "Arama zaman aşımına uğradı. Lütfen tekrar deneyin."
            : (e as Error)?.message || "Bilinmeyen hata oluştu.";

        setStatus("error");
        setError(msg);
        return null;
      }
    },
    [path, buildBody, transform, timeoutMs],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setData(null);
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    search,
    reset,
    status,
    data,
    error,
    isLoading: status === "loading",
  };
}
