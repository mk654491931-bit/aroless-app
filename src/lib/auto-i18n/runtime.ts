/**
 * Site-wide automatic UI translation layer.
 *
 * The app's screens are authored with a mix of Turkish and English literals.
 * Instead of touching every component, this layer keeps a source-string ->
 * target-string dictionary per language and applies it to the live DOM
 * (text nodes + a few text-bearing attributes) after hydration, re-applying
 * on every DOM mutation so React re-renders stay translated.
 */

import { extrasFor } from "./extras";

export type AutoLang = "tr" | "en" | "es" | "de" | "fr" | "ar";

export const AUTO_LANGS: AutoLang[] = ["tr", "en", "es", "de", "fr", "ar"];

const loaders: Record<AutoLang, () => Promise<{ default: Record<string, string> }>> = {
  tr: () => import("./dict-tr"),
  en: () => import("./dict-en"),
  es: () => import("./dict-es"),
  de: () => import("./dict-de"),
  fr: () => import("./dict-fr"),
  ar: () => import("./dict-ar"),
};

const ATTRS = ["placeholder", "title", "aria-label", "alt", "aria-placeholder"] as const;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA", "SVG", "svg"]);

let dict: Record<string, string> = {};
let currentLang: AutoLang | null = null;
let observer: MutationObserver | null = null;
let headObserver: MutationObserver | null = null;
let scheduled = false;

const originalText = new WeakMap<Text, string>();
const originalAttrs = new WeakMap<Element, Record<string, string>>();
const dirty = new Set<Node>();

const SEGMENT_SPLIT = /(\s+[·•|—–]\s+)/;

function translateKey(key: string): string | null {
  const hit = dict[key];
  return hit && hit !== key ? hit : null;
}

/** Translates a segment, tolerating a trailing dynamic value ("son: 00:32"). */
function translateSegment(part: string): string | null {
  const trimmed = part.trim();
  const direct = translateKey(trimmed);
  if (direct) return part.replace(trimmed, direct);
  const m = trimmed.match(/^(.*?)[:：]\s*(\S.*)$/);
  if (m) {
    const head = translateKey(m[1]) ?? translateKey(`${m[1]}:`);
    if (head) return part.replace(trimmed, `${head.replace(/[:：]\s*$/, "")}: ${m[2]}`);
  }
  return null;
}

function translateBody(key: string): string | null {
  const direct = translateKey(key);
  if (direct) return direct;

  // "Label · other label" — translate each segment on its own.
  if (SEGMENT_SPLIT.test(key)) {
    const parts = key.split(SEGMENT_SPLIT);
    let changed = false;
    const mapped = parts.map((part) => {
      if (SEGMENT_SPLIT.test(part) || !part.trim()) return part;
      const seg = translateSegment(part);
      if (seg) {
        changed = true;
        return seg;
      }
      return part;
    });
    if (changed) return mapped.join("");
  }
  return translateSegment(key);
}

function lookup(raw: string): string | null {
  const key = raw.replace(/\s+/g, " ").trim();
  if (key.length < 2) return null;
  const hit = translateBody(key);
  if (!hit) return null;
  const lead = raw.match(/^\s*/)?.[0] ?? "";
  const tail = raw.match(/\s*$/)?.[0] ?? "";
  return lead + hit + tail;
}

function shouldSkip(el: Element | null): boolean {
  if (!el) return false;
  // Native closest is far cheaper than manual parent walk (40 levels) for every text node.
  // One call covers all SKIP_TAGS + data-no-translate in the ancestor chain.
  const hit = (el as HTMLElement).closest?.(
    "script,style,noscript,code,pre,textarea,svg,[data-no-translate]",
  );
  if (hit) return true;
  // Fallback for edge cases where closest is unavailable (e.g. detached text parent)
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 16) {
    if (SKIP_TAGS.has(node.tagName)) return true;
    node = node.parentElement;
    depth++;
  }
  return false;
}

function applyToText(node: Text) {
  const source = originalText.get(node) ?? node.nodeValue ?? "";
  if (!source.trim()) return;
  if (shouldSkip(node.parentElement)) return;
  const next = lookup(source);
  if (next == null) {
    if (originalText.has(node) && node.nodeValue !== source) {
      node.nodeValue = source;
      originalText.delete(node);
    }
    return;
  }
  if (!originalText.has(node)) originalText.set(node, source);
  if (node.nodeValue !== next) node.nodeValue = next;
}

function applyToElement(el: Element) {
  if (shouldSkip(el)) return;
  for (const attr of ATTRS) {
    const stored = originalAttrs.get(el)?.[attr];
    const source = stored ?? el.getAttribute(attr);
    if (!source || !source.trim()) continue;
    const next = lookup(source);
    if (next == null) {
      if (stored && el.getAttribute(attr) !== stored) el.setAttribute(attr, stored);
      continue;
    }
    if (!stored) {
      const bag = originalAttrs.get(el) ?? {};
      bag[attr] = source;
      originalAttrs.set(el, bag);
    }
    if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    applyToText(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  const el = root as Element;
  if (el.nodeType === Node.ELEMENT_NODE) applyToElement(el);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null = walker.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) applyToText(n as Text);
    else applyToElement(n as Element);
    n = walker.nextNode();
  }
}

function flush() {
  scheduled = false;
  if (!currentLang) {
    dirty.clear();
    return;
  }
  observer?.disconnect();
  try {
    if (dirty.size === 0) {
      walk(document.body);
    } else if (dirty.size > 24) {
      // Too many dirty roots — one coalesced walk is cheaper than 24+ subtree walks
      walk(document.body);
    } else {
      for (const node of dirty) {
        if ((node as Element).isConnected !== false) walk(node);
      }
    }
  } catch {
    /* never break the app because of translation */
  } finally {
    dirty.clear();
    connect();
  }
}

function schedule(node?: Node) {
  if (node) dirty.add(node);
  if (scheduled) return;
  scheduled = true;
  const run = () => flush();
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === "function") {
    ric(run, { timeout: 120 });
  } else {
    window.setTimeout(run, 32);
  }
}

function connect() {
  if (typeof document === "undefined") return;
  observer?.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS],
  });
}

// ---------- Dokument başlığı ve meta (head bölgesi) ----------
//
// DOM yürüyüşü `document.body` üzerinden çalıştığı için `<title>` ve meta
// etiketleri kapsam dışında kalıyordu: dil değişince tarayıcı sekmesi ve
// paylaşım/SEO meta'ları eski dilde kalıyordu. Bu bölüm başlığı ve meta
// içeriklerini de sözlükten çevirir ve route değişimlerinde yeniden uygular.

const META_TARGETS: Array<{ selector: string; attr: string }> = [
  { selector: 'meta[name="description"]', attr: "content" },
  { selector: 'meta[property="og:title"]', attr: "content" },
  { selector: 'meta[property="og:description"]', attr: "content" },
  { selector: 'meta[name="twitter:title"]', attr: "content" },
  { selector: 'meta[name="twitter:description"]', attr: "content" },
];

const TITLE_BASE_ATTR = "i18nTitleBase";
const metaBase = new WeakMap<Element, string>();

/**
 * Aynı metnin kaynak (çevrilmemiş) hâlini izler: route yeni bir başlık/meta
 * yazdığında kaynak güncellenir, aksi hâlde çevirinin üstüne yazılmaz.
 */
function syncSource(current: string, source: string | undefined, translate: (v: string) => string) {
  if (!source) return current;
  if (current === source) return source;
  return translate(source) === current ? source : current;
}

export function translateDocumentMetadata(): void {
  if (typeof document === "undefined") return;
  try {
    const root = document.documentElement;
    const title = document.title ?? "";
    const storedTitle = root.dataset[TITLE_BASE_ATTR];
    const nextBase = syncSource(title, storedTitle, (v) => lookup(v) ?? v);
    if (nextBase !== storedTitle) root.dataset[TITLE_BASE_ATTR] = nextBase;
    const nextTitle = lookup(nextBase) ?? nextBase;
    if (nextTitle !== title) document.title = nextTitle;

    for (const target of META_TARGETS) {
      const el = document.querySelector(target.selector);
      if (!el) continue;
      const current = el.getAttribute(target.attr) ?? "";
      if (!current.trim()) continue;
      const stored = metaBase.get(el);
      const base = syncSource(current, stored, (v) => lookup(v) ?? v) || current;
      if (base !== stored) metaBase.set(el, base);
      const next = lookup(base);
      if (next && next !== current) el.setAttribute(target.attr, next);
    }
  } catch {
    /* metadata çevirisi asla uygulamayı kırmaz */
  }
}

function connectHead() {
  if (typeof document === "undefined") return;
  headObserver?.observe(document.head, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["content"],
  });
}

function ensureObserver() {
  if (observer || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver((records) => {
    // Coalesce: collect dirty roots first, schedule once
    for (const r of records) {
      if (r.type === "characterData") dirty.add(r.target);
      else if (r.type === "attributes") dirty.add(r.target);
      else r.addedNodes.forEach((n) => dirty.add(n));
    }
    if (records.length) schedule();
  });
  connect();

  if (!headObserver) {
    // Yalnız yazıldığında (değer gerçekten değiştiğinde) tetiklenir — döngü yok.
    headObserver = new MutationObserver(() => translateDocumentMetadata());
  }
  connectHead();
}

function restoreAll() {
  observer?.disconnect();
  headObserver?.disconnect();
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  let n: Node | null = walker.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      const src = originalText.get(t);
      if (src != null && t.nodeValue !== src) t.nodeValue = src;
      originalText.delete(t);
    } else {
      const el = n as Element;
      const bag = originalAttrs.get(el);
      if (bag) {
        for (const [attr, src] of Object.entries(bag)) {
          if (el.getAttribute(attr) !== src) el.setAttribute(attr, src);
        }
        originalAttrs.delete(el);
      }
    }
    n = walker.nextNode();
  }
  connect();
  connectHead();
}

let loadToken = 0;

export async function setAutoLanguage(lang: string | undefined | null) {
  if (typeof document === "undefined") return;
  const code = (AUTO_LANGS as string[]).includes((lang ?? "").slice(0, 2))
    ? ((lang ?? "").slice(0, 2) as AutoLang)
    : "en";
  if (code === currentLang) return;
  const token = ++loadToken;
  let next: Record<string, string> = {};
  try {
    next = (await loaders[code]()).default;
  } catch {
    next = {};
  }
  if (token !== loadToken) return;
  currentLang = code;
  dict = { ...next, ...extrasFor(code) };
  ensureObserver();
  // Başlık ve meta'lar body yürüyüşünün dışında: ayrıca çevrilir.
  translateDocumentMetadata();
  restoreAll();
  dirty.clear();
  schedule();
}

/** Translate a single runtime string (for toasts, document.title, etc.). */
export function autoT(value: string): string {
  return lookup(value) ?? value;
}
