// Deprecated shim.
//
// The postMessage session broker is gone (see ./authStorage.ts for why). This
// re-export exists so the Supabase client keeps working unchanged; prefer
// browserAuthStorage() in new code.
import { browserAuthStorage } from "./authStorage";

/** @deprecated Use browserAuthStorage() from ./authStorage instead. */
export function brokeredPreviewStorage(): Storage | undefined {
  return browserAuthStorage();
}
