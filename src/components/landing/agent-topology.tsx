import { useState } from "react";
import { GitBranch } from "lucide-react";

type TopoNode = {
  id: string;
  label: string;
  x: number;
  cy: number;
  accent: "slate" | "indigo" | "emerald";
};

const W = 900;
const H = 430;
const NODE_W = 158;
const NODE_H = 46;

const COLUMNS = [
  { x: 130, label: "Data Ingestion" },
  { x: 450, label: "Agent Decision Mesh" },
  { x: 770, label: "Automated Conversion" },
];

const NODES: TopoNode[] = [
  { id: "data-lake", label: "Data Lake · Events", x: 130, cy: 96, accent: "slate" },
  { id: "merchant-feeds", label: "Merchant Feeds", x: 130, cy: 205, accent: "slate" },
  { id: "trend-scan", label: "Trend-Scan-01", x: 450, cy: 78, accent: "indigo" },
  { id: "deal-engine", label: "Deal-Engine-04", x: 450, cy: 175, accent: "indigo" },
  { id: "attribution", label: "Attribution Mesh", x: 450, cy: 272, accent: "indigo" },
  { id: "content-orch", label: "Content-Orchestrator", x: 770, cy: 104, accent: "emerald" },
  { id: "payout", label: "Payout-Infra", x: 770, cy: 226, accent: "emerald" },
];

const EDGES: Array<{ from: string; to: string }> = [
  { from: "data-lake", to: "trend-scan" },
  { from: "merchant-feeds", to: "deal-engine" },
  { from: "data-lake", to: "attribution" },
  { from: "trend-scan", to: "content-orch" },
  { from: "deal-engine", to: "payout" },
  { from: "attribution", to: "payout" },
];

const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));

const accentStroke: Record<TopoNode["accent"], string> = {
  slate: "#64748b",
  indigo: "#6366f1",
  emerald: "#10b981",
};

/**
 * Agent topology — a vector pipeline (ingestion → decision mesh → conversion)
 * with hover-aware flow highlighting. Deterministic SVG/CSS; no remote data.
 */
export function AgentTopology() {
  const [hovered, setHovered] = useState<string | null>(null);
  const related = (id: string) =>
    new Set(
      EDGES.filter((e) => e.from === id || e.to === id).flatMap((e) => [e.from, e.to]),
    );

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0F1117]/70 p-4 backdrop-blur-xl sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-200">
          <GitBranch size={15} className="text-indigo-300" /> Agent topology
        </p>
        <p className="text-[11px] text-slate-500">Hover a node to trace its live data paths.</p>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto mt-3 w-full max-w-4xl"
        role="img"
        aria-label="Aroless agent topology diagram"
      >
        <defs>
          <linearGradient id="entEdge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.9" />
          </linearGradient>
          <radialGradient id="nodeGlow">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Column headers */}
        {COLUMNS.map((c) => (
          <text
            key={c.label}
            x={c.x}
            y={22}
            textAnchor="middle"
            className="fill-slate-500"
            style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}
          >
            {c.label}
          </text>
        ))}
        <text x={W / 2} y={H - 12} textAnchor="middle" className="fill-slate-600" style={{ fontSize: 10 }}>
          deterministic simulation payload · rendered locally
        </text>

        {/* Edges */}
        {EDGES.map((edge) => {
          const a = nodeById[edge.from]!;
          const b = nodeById[edge.to]!;
          const x1 = a.x + NODE_W / 2;
          const y1 = a.cy;
          const x2 = b.x - NODE_W / 2;
          const y2 = b.cy;
          const mx = (x1 + x2) / 2;
          const lit = hovered !== null && (edge.from === hovered || edge.to === hovered);
          const dim = hovered !== null && !lit;
          const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
          return (
            <g key={`${edge.from}-${edge.to}`} opacity={dim ? 0.18 : 1} className="transition-opacity duration-300">
              <path
                d={d}
                fill="none"
                stroke="url(#entEdge)"
                strokeWidth={lit ? 2.2 : 1.1}
                strokeLinecap="round"
                className={lit ? "ent-edge ent-edge-lit" : "ent-edge"}
              />
            </g>
          );
        })}

        {/* Nodes */}
        {NODES.map((node) => {
          const x = node.x - NODE_W / 2;
          const y = node.cy - NODE_H / 2;
          const dim = hovered !== null && hovered !== node.id && !related(hovered).has(node.id);
          const lit = hovered === node.id;
          return (
            <g
              key={node.id}
              opacity={dim ? 0.3 : 1}
              className="transition-opacity duration-300"
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "pointer" }}
            >
              {lit && <circle cx={node.x} cy={node.cy} r={86} fill="url(#nodeGlow)" />}
              <rect
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx={12}
                fill="#0B0D13"
                stroke={lit ? accentStroke[node.accent] : "rgba(255,255,255,0.1)"}
                strokeWidth={lit ? 1.4 : 1}
                className="transition-all duration-300"
                style={lit ? { filter: `drop-shadow(0 0 10px ${accentStroke[node.accent]}66)` } : undefined}
              />
              <rect x={x} y={y} width={NODE_W} height={2} rx={1} fill={accentStroke[node.accent]} opacity={lit ? 1 : 0.5} />
              <text
                x={node.x}
                y={node.cy + 2}
                textAnchor="middle"
                className="fill-slate-200"
                style={{ fontSize: 12.5, fontWeight: 600 }}
              >
                {node.label}
              </text>
              <text x={x + 10} y={y + NODE_H - 9} className="fill-slate-600" style={{ fontSize: 9, fontFamily: "monospace" }}>
                {node.accent === "indigo" ? "● mesh" : node.accent === "emerald" ? "● output" : "○ ingest"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
