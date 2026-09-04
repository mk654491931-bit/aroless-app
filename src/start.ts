import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachFreshSupabaseAuth } from "@/integrations/supabase/auth-fresh";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (
      error !== null &&
      error !== undefined &&
      typeof error === "object" &&
      "statusCode" in error
    ) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachFreshSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
