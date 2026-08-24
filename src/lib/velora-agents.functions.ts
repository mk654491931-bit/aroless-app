import { createServerFn } from "@tanstack/react-start";
import { PipelineInputSchema } from "./velora-pipeline.server";

/** Uygulama içi tipli çağrı: 14 ajanlı Velora hattını çalıştırır. */
export const runAgentPipeline = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PipelineInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { runVeloraAgentPipeline } = await import("./velora-pipeline.server");
    return runVeloraAgentPipeline(data);
  });
