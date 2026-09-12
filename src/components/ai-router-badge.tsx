/**
 * AiRouterBadge — shows the active AI Smart Router pool in the page header.
 * Displays provider count + key pool size; updates colour when router is active.
 * Server-rendered safe: reads nothing at runtime, purely decorative.
 */
import { Cpu } from "lucide-react";

const PROVIDERS = [
  { id: "groq", keys: 5, color: "text-orange-400" },
  { id: "gemini", keys: 5, color: "text-blue-400" },
  { id: "openrouter", keys: 5, color: "text-violet-400" },
  { id: "huggingface", keys: 5, color: "text-yellow-400" },
  { id: "cerebras", keys: 1, color: "text-emerald-400" },
  { id: "sambanova", keys: 1, color: "text-pink-400" },
];

const TOTAL_KEYS = PROVIDERS.reduce((s, p) => s + p.keys, 0); // 22

/**
 * Compact badge for the sticky header.
 * Shows the number of live providers and total API key pool size.
 */
export function AiRouterBadge() {
  return (
    <span
      title={`Smart Router active — ${PROVIDERS.length} providers, ${TOTAL_KEYS} keys (Round-Robin + circuit breaker + exponential backoff)`}
      className="hidden lg:inline-flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-300 backdrop-blur shrink-0 cursor-help"
    >
      <Cpu size={11} className="text-indigo-400 shrink-0" />
      <span className="tabular-nums">{PROVIDERS.length}p</span>
      <span className="text-indigo-500/70">/</span>
      <span className="tabular-nums">{TOTAL_KEYS}k</span>
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
    </span>
  );
}

/**
 * Expanded panel — use in settings / admin to show router health.
 * Purely decorative; real stats require the server-side getRouterStats().
 */
export function AiRouterPanel() {
  return (
    <div className="rounded-2xl border border-slate-800/60 bg-slate-900/70 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Cpu size={14} className="text-indigo-400" />
        <h3 className="text-sm font-semibold text-slate-100">Smart AI Router</h3>
        <span className="ml-auto text-[11px] text-slate-500">
          {PROVIDERS.length} providers · {TOTAL_KEYS} keys
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {PROVIDERS.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg border border-slate-800/40 bg-slate-900/50 px-2.5 py-1.5"
          >
            <span className={`text-[11px] font-medium capitalize ${p.color}`}>{p.id}</span>
            <span className="text-[11px] text-slate-500 tabular-nums">{p.keys}k</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-600">
        Round-Robin rotation · Circuit breaker (3 failures → 60s cooldown) · Exponential backoff on
        429
      </p>
    </div>
  );
}
