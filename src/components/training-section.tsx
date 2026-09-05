import { useState } from "react";
import { Gamepad2, Rocket } from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { TrainingTab } from "./training-tab";
import { SandboxTab } from "./sandbox-tab";

type Mode = "sandbox" | "drill";

export function TrainingSection({
  catalog,
  onUpgrade,
}: {
  catalog: WinningProduct[];
  onUpgrade: () => void;
}) {
  const [mode, setMode] = useState<Mode>("sandbox");
  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-xl bg-white/5 border border-white/10 p-1">
        {[
          { id: "sandbox" as const, label: "E-Commerce Simulator", icon: Rocket },
          { id: "drill" as const, label: "Quick Drill", icon: Gamepad2 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${mode === id ? "bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] text-white glow" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      {mode === "sandbox" ? (
        <SandboxTab catalog={catalog} onUpgrade={onUpgrade} />
      ) : (
        <TrainingTab catalog={catalog} />
      )}
    </div>
  );
}
