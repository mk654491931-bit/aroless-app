import "./lib/error-capture";
import { checkServerEnvOnce } from "./lib/env-check";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { applySecurityHeaders, isSecureRequest } from "./lib/security-headers";
import {
  budgetExceededPayload,
  hostRuntimeSummary,
  requestDeadlineMs,
  withDeadlineOutcome,
} from "./lib/host-runtime.server";
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

/**
 * Platform öldürmeden önce dönen yanıt: 504 DEĞİL, "hâlâ çalışıyor" bildirimi.
 *
 * NEDEN 503: Vercel fonksiyonu 300 sn'de keserse yanıt `504
 * FUNCTION_INVOCATION_TIMEOUT` olur — kullanıcı hem beklediği süreyi hem de
 * elindeki kısmi sonucu kaybeder, izleme araçları bunu altyapı arızası sayar ve
 * tarayıcı/proxy katmanları 5xx'i yeniden denerken isteği boşa tüketir. Bunun
 * yerine `Retry-After` ile birlikte açık bir "bütçe doldu, tekrar sor" yanıtı
 * dönüyoruz. `/api/*` JSON, sayfa istekleri kısa bir HTML alır.
 */
function budgetExceededResponse(request: Request): Response {
  const pathname = new URL(request.url).pathname;
  const headers = { "cache-control": "no-store", "retry-after": "5" };
  if (pathname.startsWith("/api/")) {
    return Response.json(budgetExceededPayload(), { status: 503, headers });
  }
  return new Response(BUSY_PAGE, {
    status: 503,
    headers: { ...headers, "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Bütçe dolduğunda sayfa isteklerine dönen küçük bilgi sayfası.
 *
 * Bilinçli olarak "hata" demiyoruz: iş arka planda sürüyor ve çoğu durumda
 * birkaç saniye sonra önbellekten hazır gelecek. Yanlış bir hata mesajı
 * kullanıcıyı gereksiz yere analizi yeniden başlatmaya iterdi.
 */
const BUSY_PAGE = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <title>Analiz hazırlanıyor</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="6" />
    <style>
      body { font: 15px/1.6 system-ui, -apple-system, sans-serif; background: #0b0f14; color: #e6edf3; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; text-align: center; }
      h1 { font-size: 1.1rem; margin: 0 0 .5rem; }
      p { margin: .25rem 0; color: #9aa7b4; }
      a { color: #7dd3fc; }
    </style>
  </head>
  <body>
    <div>
      <h1>Analiz hâlâ hazırlanıyor</h1>
      <p>Bu istek platformun süre sınırına yaklaştı; sonuç arka planda tamamlanıyor.</p>
      <p>Sayfa birkaç saniye içinde kendini yenileyecek — <a href="">şimdi yenile</a>.</p>
    </div>
  </body>
</html>`;

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
            // Sunucusuz ortamda platform işi kesmeden önce yanıt ürettiğimiz
            // an (ms). `null` → kalıcı süreç, global kesme yok.
            requestDeadlineMs: requestDeadlineMs() ?? null,
            // Ağır işlerin hangi yoldan gittiği: "qstash" | "in-process" | "inline".
            // ÜCRETSİZ hedef: `dispatch: "qstash"` (Vercel Hobby + QStash, ayrı
            // servis gerekmez). "inline" görünüyorsa `QSTASH_TOKEN` +
            // `JOB_WORKER_SECRET` tanımlı değil demektir; ağır hat istek içinde
            // koşar (280 sn sözü yine tutar ama ön sonuç/arka plan dayanıklılığı
            // olmaz). `longJob: "inline"` Vercel'de normaldir.
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

    /**
     * Tek isteği işler. `runHandler` ASLA reddetmez (kendi try/catch'i var),
     * böylece aşağıdaki zaman aşımı yarışı yalnızca "bitti" ile "bütçe doldu"
     * arasında karar verir.
     */
    const runHandler = async (): Promise<Response> => {
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
    };

    // 504'Ü YAPISAL OLARAK İMKÂNSIZ KILAN KORUMA: sunucusuz platformda
    // (Vercel Hobby 300 sn) iş platform tarafından öldürülmeden önce burada
    // yanıt üretiriz. Kalıcı süreçte `deadlineMs` `undefined`'dır ve akış
    // değişmez — uç nokta bazlı bütçeler (REQUEST_BUDGET_MS) yeterlidir.
    const deadlineMs = requestDeadlineMs();
    if (deadlineMs === undefined) return runHandler();

    const outcome = await withDeadlineOutcome(runHandler(), deadlineMs);
    if (outcome.kind === "value") return outcome.value;
    if (outcome.kind === "rejected") {
      // Kuramsal: `runHandler` hataları kendi içinde yakalar. Yine de buraya
      // düşersek sessizce askıda kalmak yerine açık bir 500 döneriz.
      return harden(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
    console.warn(
      `[deadline] ${pathname} ${deadlineMs} ms'de yanıt üretemedi; 503 ile bütçe doldu bildirildi.`,
    );
    return harden(budgetExceededResponse(request));
  },
};
