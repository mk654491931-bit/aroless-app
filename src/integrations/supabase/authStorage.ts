// Auth session storage for the browser Supabase client.
//
// Previously this brokered the session to an editor iframe over postMessage so
// preview surfaces could share one login. That bridge only ever activated
// inside the vendor's preview host; on localhost and on Vercel the code already
// fell straight through to localStorage. Removing it changes nothing about how
// the deployed app stores a session, and deletes an origin-validated
// postMessage channel that handled auth tokens -- code worth not carrying.
//
// Returning undefined on the server is deliberate: supabase-js then falls back
// to its own in-memory storage instead of touching a non-existent localStorage.
export function browserAuthStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    // Storage can throw when cookies are blocked entirely (Safari private mode,
    // hardened browser settings). In-memory is the correct fallback: the user
    // stays signed in for this tab rather than seeing auth fail outright.
    return undefined;
  }
}
