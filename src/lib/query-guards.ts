/**
 * Runtime shape guard for data coming out of server-function queries.
 *
 * The TanStack Start client resolves a JSON response that lacks the start
 * serialization header with its raw body — even when the HTTP status is an
 * error (e.g. a gateway/platform 500 returning `{error: ...}`). That means a
 * query's `data` can be a non-array error object instead of `undefined`, and
 * `data ?? []` alone does NOT protect render code from `.map is not a
 * function` crashes. Always shape-check before treating query data as an array.
 */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}