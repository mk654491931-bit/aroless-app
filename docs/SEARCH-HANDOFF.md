# Finder search handoff (`?q=`)

How a search term travels from any surface in the app to the finder that runs
it. Owned by `src/lib/search-handoff.ts` (pure, 26 unit tests) and
`src/hooks/use-search-handoff.ts` (React glue).

## The flow

1. **Write side.** A surface builds the link with `buildFinderPath(term)` and
   navigates. Never hand-write `?q=` — encoding, trimming and the length cap
   live in one place.
2. **Capture side.** `useCaptureSearchHandoff(pathname)` runs at the router
   root on every navigation. It reads `?q=`, parks the term in
   `sessionStorage`, then removes the parameter from the address bar with
   `history.replaceState`.
3. **Consume side.** The finder calls `useSearchHandoff(cb)` and receives the
   term at most once per mount.

## Why the parameter is stripped immediately

A finder search spends a credit and calls the AI engines. If `?q=` stayed in
the URL, a refresh, a back-navigation or a bookmarked link would silently spend
another one. `replaceState` is used rather than a router navigation so nothing
remounts and the page does not flicker.

## Why `sessionStorage` rather than `localStorage`

A handed-off term belongs to this tab and this visit. In `localStorage` it
would fire again in another tab, or tomorrow — a search the user never asked
for.

## Validation rules (all covered by tests)

- Non-strings, empty strings and whitespace-only input are rejected.
- Whitespace is collapsed, so `"  led   lamp "` and `"led lamp"` are one term.
- Control characters are **stripped**, not escaped: a URL must not be able to
  inject newlines into an AI prompt.
- Terms are capped at 200 characters.
- Whatever is already in storage is re-validated on read, so a term poisoned by
  hand still cannot reach an engine.
- Every storage call is wrapped: blocked storage (Safari private mode, quota)
  degrades to "no handoff", never to a broken navigation.

## Wiring the finder (the one remaining step)

The finder lives in `src/routes/index.tsx`, which is 154 KB and is being
decomposed in a later commit. Its consumption is deliberately a two-line change
rather than something buried in this commit:

```tsx
import { useSearchHandoff } from "@/hooks/use-search-handoff";

// inside the finder component, next to its existing query state:
useSearchHandoff((query) => {
  setQuery(query);      // whatever the local state setter is called
  void runSearch(query); // the existing submit path
});
```

Until that line exists, a `?q=` link lands on the finder with the term parked
and the URL cleaned, but does not auto-run the search. Everything else above is
live and tested.
