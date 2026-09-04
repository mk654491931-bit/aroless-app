import { StrictMode, startTransition } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { StartClient } from "@tanstack/react-start/client";

import { getRouter } from "./router";

declare global {
  interface Window {
    /** SSR bootstrap payload injected by TanStack Start when a server renders the page. */
    $_TSR?: unknown;
  }
}

/**
 * Two boot paths:
 *
 * 1. SSR/dev — `window.$_TSR` is present (a TanStack Start server rendered the
 *    document). Hydrate exactly like the framework's default client entry.
 *
 * 2. Static SPA (no server, e.g. Freebuff static hosting) — no SSR payload
 *    ever exists, and the framework's `hydrate()` step throws
 *    "Invariant failed: Expected to find bootstrap data on window.$_TSR"
 *    on every page load (blank screen in production builds). Boot the router
 *    directly instead: `RouterProvider` renders the route tree and its
 *    internal `Transitioner` triggers the initial `router.load()`.
 */
const container = document.getElementById("root");

if (window.$_TSR) {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    );
  });
} else if (container) {
  const router = getRouter();
  createRoot(container).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
