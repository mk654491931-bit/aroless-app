import { FileText } from "lucide-react";
import type { LegalDoc } from "@/lib/legal-content";

export function LegalDocBody({ doc, compact = false }: { doc: LegalDoc; compact?: boolean }) {
  return (
    <article className={compact ? "space-y-6" : "space-y-9"}>
      {!compact && <p className="text-sm leading-relaxed text-muted-foreground">{doc.summary}</p>}
      {doc.sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-28">
          <h2 className="flex items-start gap-2 text-base font-semibold tracking-tight text-foreground md:text-lg">
            <FileText className="mt-1 h-4 w-4 shrink-0 text-[var(--brand,var(--primary))]" />
            {s.heading}
          </h2>
          <div className="mt-3 space-y-2.5 border-l border-border/70 pl-4">
            {s.body.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                {p}
              </p>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}
