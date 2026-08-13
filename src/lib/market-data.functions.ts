import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getGoogleTrends, getSourcingEstimate, getProductPhysical,
  type TrendSeries, type SourcingEstimate, type ProductPhysical,
} from "./market-data.server";

export type { TrendSeries, SourcingEstimate, ProductPhysical };

export type MarketIntel = {
  trends: TrendSeries;
  sourcing: SourcingEstimate;
  physical: ProductPhysical;
};

const IntelInput = z.object({
  query: z.string().min(2).max(200),
  country: z.string().min(2).max(8).default("GLOBAL"),
  selling_price_usd: z.number().min(0).max(100000).default(49),
  barcode: z.string().max(20).default(""),
});

/** Free external enrichment: Google Trends + AliExpress sourcing + Open Products Facts. */
export const getMarketIntel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IntelInput.parse(i))
  .handler(async ({ data }): Promise<MarketIntel> => {
    const [trends, sourcing, physical] = await Promise.all([
      getGoogleTrends(data.query, data.country),
      getSourcingEstimate(data.query, data.selling_price_usd),
      getProductPhysical(data.barcode),
    ]);
    return { trends, sourcing, physical };
  });
