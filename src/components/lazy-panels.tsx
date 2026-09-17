import { memo, Suspense, lazy, type ComponentProps, type ComponentType } from "react";

import type { AnalysisPipelineModal as AnalysisPipelineModalType } from "@/components/analysis-pipeline-modal";
import type { ReportModal as ReportModalType } from "@/components/report-modal";
import type { ProductDeepDive as ProductDeepDiveType } from "@/components/product-deep-dive";
import type { ProductDeepDiveModal as ProductDeepDiveModalType } from "@/components/product-deep-dive-modal";
import type { ConsensusReportModal as ConsensusReportModalType } from "@/components/consensus-report";
import type { DraggableCopilot as DraggableCopilotType } from "@/components/draggable-copilot";
import type { BuyerSimulation as BuyerSimulationType } from "@/components/buyer-simulation";

import type { TrainingSection as TrainingSectionType } from "@/components/training-section";
import type { PredictiveTrendsTab as PredictiveTrendsTabType } from "@/components/predictive-trends-tab";


/**
 * Ağır panellerin ertelenmiş (deferred) sürümleri.
 *
 * Neden: bu bileşenler ayrı kod parçalarına bölünmeden ana sayfayla birlikte
 * iniyor, ilk etkileşime kadar ana iş parçacığını meşgul ediyordu. Burada
 * her biri (a) `lazy` ile ayrı chunk'tan yüklenir, (b) `memo` ile sarılır
 * (kart içinde kullanılanlarda ebeveyn her tuş vuruşunda yeniden çizilse bile
 * alt ağaç yeniden render edilmez), (c) Suspense ile sarılır.
 *
 * Import yolları `@/components/lazy-panels` olarak değiştirilir; çağrı
 * yerleri ve prop tipleri aynı kalır, görsel çıktı değişmez.
 */

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

/** lazy + memo + Suspense: gerektiğinde inen, gereksiz yeniden çizilmeyen bileşen. */
function deferred<P extends object>(load: Loader<P>) {
  const Lazy = lazy(load);
  const Memo = memo(Lazy as unknown as ComponentType<P>);
  function Deferred(props: P) {
    return (
      <Suspense fallback={null}>
        <Memo {...props} />
      </Suspense>
    );
  }
  Deferred.displayName = "Deferred";
  return Deferred;
}

export const AnalysisPipelineModal = deferred<ComponentProps<typeof AnalysisPipelineModalType>>(
  () =>
    import("@/components/analysis-pipeline-modal").then((m) => ({
      default: m.AnalysisPipelineModal,
    })),
);

export const ReportModal = deferred<ComponentProps<typeof ReportModalType>>(() =>
  import("@/components/report-modal").then((m) => ({ default: m.ReportModal })),
);

export const ProductDeepDive = deferred<ComponentProps<typeof ProductDeepDiveType>>(() =>
  import("@/components/product-deep-dive").then((m) => ({ default: m.ProductDeepDive })),
);

export const ProductDeepDiveModal = deferred<ComponentProps<typeof ProductDeepDiveModalType>>(() =>
  import("@/components/product-deep-dive-modal").then((m) => ({
    default: m.ProductDeepDiveModal,
  })),
);

export const ConsensusReportModal = deferred<ComponentProps<typeof ConsensusReportModalType>>(() =>
  import("@/components/consensus-report").then((m) => ({ default: m.ConsensusReportModal })),
);

export const DraggableCopilot = deferred<ComponentProps<typeof DraggableCopilotType>>(() =>
  import("@/components/draggable-copilot").then((m) => ({ default: m.DraggableCopilot })),
);

export const BuyerSimulation = deferred<ComponentProps<typeof BuyerSimulationType>>(() =>
  import("@/components/buyer-simulation").then((m) => ({ default: m.BuyerSimulation })),
);

// Prop almayan panellerde prop tipi `unknown` geldiği için boş nesne tipi verilir.
export const AcademyTab = deferred<Record<string, never>>(() =>
  import("@/components/academy-tab").then((m) => ({ default: m.AcademyTab })),
);

export const TrainingSection = deferred<ComponentProps<typeof TrainingSectionType>>(() =>
  import("@/components/training-section").then((m) => ({ default: m.TrainingSection })),
);

export const PredictiveTrendsTab = deferred<ComponentProps<typeof PredictiveTrendsTabType>>(() =>
  import("@/components/predictive-trends-tab").then((m) => ({
    default: m.PredictiveTrendsTab,
  })),
);

export const HotTicker = deferred<Record<string, never>>(() =>
  import("@/components/hot-ticker").then((m) => ({ default: m.HotTicker })),
);
