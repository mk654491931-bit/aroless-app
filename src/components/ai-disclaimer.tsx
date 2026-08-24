import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AI_DISCLAIMER_TR } from "@/lib/ai-guidance";

/**
 * AI üretimli her rapor/kart/panel altında gösterilen sade yasal uyarı.
 * Görünür ama dikkat dağıtmayan (muted) bir dipnot olarak tasarlandı.
 */
export function AiDisclaimer({
  className,
  icon = true,
}: {
  className?: string;
  icon?: boolean;
}) {
  return (
    <p
      role="note"
      className={cn(
        "mt-4 flex items-start gap-1.5 border-t border-border/40 pt-3 text-[10px] leading-relaxed text-muted-foreground/70 sm:text-[11px]",
        className,
      )}
    >
      {icon && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 opacity-60" aria-hidden />}
      <span>{AI_DISCLAIMER_TR}</span>
    </p>
  );
}

export default AiDisclaimer;
