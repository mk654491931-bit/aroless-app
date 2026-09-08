# Deployment — Vercel only

There is one supported target. `nitro.config.ts` pins `preset: "vercel"`, and
`npm run build` emits the client bundle plus a Vercel function for the SSR
handler, every TanStack server function and every route under
`src/routes/api/`. No editor-hosted publish path, no Cloudflare preset, no
separate API host.

## Build

| | |
| --- | --- |
| Build command | `npm run build` (set in `vercel.json`) |
| Node | >= 20 |
| Output | `.vercel/output` (produced by the Nitro Vercel preset) |

`vite build` now **fails** if Nitro cannot be loaded. Previously the import was
wrapped in a `try/catch` that silently skipped it — which produced a green build
with no server bundle, so every server function and `/api` route 404'd in
production while CI looked healthy.

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**, for
Preview and Production. `.env` is for local development only and is
git-ignored.

### Required

| Variable | Used by |
| --- | --- |
| `SUPABASE_URL` | client + server |
| `SUPABASE_PUBLISHABLE_KEY` | browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | server only — never expose to the browser |

### Payments (required for billing)

| Variable | Notes |
| --- | --- |
| `PADDLE_API_KEY` | server only |
| `PADDLE_WEBHOOK_SECRET_KEY` | verifies every webhook signature; falls back to `PADDLE_WEBHOOK_SECRET` |
| `PADDLE_CLIENT_TOKEN` | browser checkout |
| `PADDLE_ENV` | `sandbox` or `production` |
| `PADDLE_STARTER_PRICE_ID` / `PADDLE_PRO_PRICE_ID` / `PADDLE_BUSINESS_PRICE_ID` | plan mapping |

Webhook endpoint to register in Paddle:
`https://<your-domain>/api/public/webhook/paddle`

### AI engines (optional; the app degrades instead of failing)

`AI_GATEWAY_API_KEY` / `AI_GATEWAY_URL` (OpenAI-compatible), Gemini key pool,
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, Hugging Face tokens. With no key
configured the engines report "not configured" rather than throwing.

## Supabase

Add the deployed origin to **Auth → URL Configuration**: Site URL, plus
`https://<your-domain>/auth/callback` in Redirect URLs. OAuth goes straight
through `supabase.auth.signInWithOAuth` — there is no third-party bridge.

Database migrations in `supabase/migrations/` are applied with the Supabase CLI
(`supabase db push`), not by the Vercel build.

## After rotating a secret

Update it in Vercel and redeploy. The running functions read the environment at
cold start, so an old value can survive in a warm function until then.
