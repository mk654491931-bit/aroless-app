import { createServerFn } from "@tanstack/react-start";
import { PipelineInputSchema } from "./velora-pipeline.server";

/** Uygulama içi tipli çağrı: 14 ajanlı Velora hattını çalıştırır. */
export const runAgentPipeline = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PipelineInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { runVeloraAgentPipeline } = await import("./velora-pipeline.server");
    const { raceBudget } = await import("@/lib/deadline.server");
    // 14 ajanlı hat gateway sınırını aşabilir: süre dolarsa 524 yerine net hata.
    const result = await raceBudget(() => runVeloraAgentPipeline(data));
    if (result === null) {
      throw new Error("Ajan hattı 90 saniyelik sunucu sınırına takıldı. Lütfen tekrar deneyin.");
    }
    return result;
  });
