/** Tarayıcı tarafı: cihazın benzersiz ziyaretçi kimliğini üretir. */
let cached: Promise<string> | null = null;

export function getVisitorId(): Promise<string> {
  if (typeof window === "undefined") return Promise.resolve("");
  if (!cached) {
    cached = import("@fingerprintjs/fingerprintjs")
      .then((mod) => mod.load())
      .then((fp) => fp.get())
      .then((res) => res.visitorId)
      .catch(() => "");
  }
  return cached;
}
