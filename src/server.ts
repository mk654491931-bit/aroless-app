import "./lib/error-capture";
import { checkServerEnvOnce } from "./lib/env-check";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { applySecurityHeaders, isSecureRequest } from "./lib/security-headers";
import { hostRuntimeSummary } from "./lib/host-runtime.server";
import { backgroundJobStats } from "./lib/job-runner.server";
import { swrCacheStats } from "./lib/swr-cache.server";
import {
  discoveryDispatchPlan,
  longJobPlan,
  qstashConfigured,
  remoteWorkerConfigured,
} from "./lib/discovery-jobs.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Güvenlik başlıkları istisnasız her yanıta eklenir (plan §5): hata
    // sayfaları, API yanıtları ve sağlık kontrolü dahil.
    const secure = isSecureRequest(request);
    const harden = (response: Response) => applySecurityHeaders(response, { secure });

    const pathname = new URL(request.url).pathname;
    if (pathname === "/health" || pathname === "/healthz") {
      // Health check HIZLI ve yan etkisiz kalmalı (Render bu uçtan 2xx bekler);
      // yalnızca ucuz, sır içermeyen teşhis bilgisi ekliyoruz: hangi platformda
      // koştuğumuz, istek bütçemiz, arka plan kuyruğunun durumu. Böylece
      // "sürekli 504" gibi bir şikâyette tek adres burasıdır.
      return harden(
        Response.json(
          {
            status: "ok",
            ...hostRuntimeSummary(),
            // Ağır işlerin hangi yoldan gittiği: "qstash" | "in-process" | "inline".
            // Sunucusuz ortamda "inline" görünüyorsa uzun analizler hâlâ istek
            // içinde koşuyor demektir (QStash anahtarı girin ya da Render'a taşıyın).
            workflow: {
              // Ürün bulucu işi hangi yoldan gidiyor?
              dispatch: discoveryDispatchPlan(),
              // Konsey gibi ağır işler hangi yoldan gidiyor? Vercel'de
              // "qstash-worker" görünmüyorsa uzun analizler istek içinde kalır.
              longJob: longJobPlan(),
              qstashConfigured: qstashConfigured(),
              remoteWorkerConfigured: remoteWorkerConfigured(),
            },
            jobs: backgroundJobStats(),
            caches: swrCacheStats(),
          },
          { headers: { "cache-control": "no-store" } },
        ),
      );
    }

    checkServerEnvOnce();
    try {
      const handler = await getServerEntry();

      const response = await handler.fetch(request, env, ctx);
      return harden(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return harden(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
