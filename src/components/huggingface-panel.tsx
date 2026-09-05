import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Cpu, Loader2, PlugZap, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { huggingFaceStatus } from "@/lib/hf.functions";
import { HF_TOKEN_STORAGE_KEY, ENGINES } from "@/lib/engines";

type Status = "idle" | "testing" | "connected" | "fallback";

/** HF_TOKEN input + live connection status for the settings page. */
export function HuggingFacePanel() {
  const statusFn = useServerFn(huggingFaceStatus);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    setToken(window.localStorage.getItem(HF_TOKEN_STORAGE_KEY) ?? "");
  }, []);

  const test = async (value?: string) => {
    setStatus("testing");
    try {
      const res = await statusFn({ data: { token: (value ?? token).trim() || undefined } });
      setStatus(res.ok ? "connected" : "fallback");
      setDetail(res.ok ? "Qwen 2.5 & Llama 3.1 reachable" : res.message);
    } catch (e) {
      setStatus("fallback");
      setDetail((e as Error).message);
    }
  };

  const save = () => {
    const v = token.trim();
    if (v) window.localStorage.setItem(HF_TOKEN_STORAGE_KEY, v);
    else window.localStorage.removeItem(HF_TOKEN_STORAGE_KEY);
    toast.success(v ? "Hugging Face token saved on this device" : "Using the server-side token");
    void test(v);
  };

  const badge = {
    idle: {
      cls: "border-white/15 bg-white/5 text-muted-foreground",
      icon: <PlugZap size={12} />,
      label: "Not tested",
    },
    testing: {
      cls: "border-white/15 bg-white/5 text-muted-foreground",
      icon: <Loader2 size={12} className="animate-spin" />,
      label: "Testing…",
    },
    connected: {
      cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
      icon: <ShieldCheck size={12} />,
      label: "Connected",
    },
    fallback: {
      cls: "border-amber-400/40 bg-amber-400/10 text-amber-300",
      icon: <TriangleAlert size={12} />,
      label: "Fallback Ready",
    },
  }[status];

  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="font-semibold mb-1 flex items-center gap-2">
        <Cpu size={16} /> Hugging Face Engines
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${badge.cls}`}
        >
          {badge.icon} {badge.label}
        </span>
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Powers the search engine switcher:{" "}
        {ENGINES.filter((e) => e.id !== "default")
          .map((e) => e.model)
          .join(" · ")}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="HF_TOKEN (hf_…) — leave empty to use the server token"
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)]"
        />
        <button
          onClick={save}
          className="rounded-lg bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-4 py-2.5 text-sm font-semibold text-white glow"
        >
          Save & Test
        </button>
        <button
          onClick={() => void test()}
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm hover:bg-white/10"
        >
          Test
        </button>
      </div>
      {detail && <p className="mt-2 text-[11px] text-muted-foreground break-all">{detail}</p>}
    </section>
  );
}
