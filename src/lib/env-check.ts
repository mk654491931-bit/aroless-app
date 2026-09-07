/**
 * Sunucu tarafı ortam değişkeni doğrulayıcı.
 *
 * Eksik anahtar yüzünden anlamsız 500'ler yerine, ilk istekte tek satırlık
 * net bir uyarı basar. Yalnızca sunucuda çağrılır.
 */

let reported = false;

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

import { anyAiKeyConfigured } from "./ai-keys.server";

/** İlk çağrıda eksik zorunlu değişkenleri konsola yazar (bir kez). */
export function checkServerEnvOnce(): void {
  if (reported) return;
  reported = true;
  try {
    const env = process.env ?? {};
    const missing = REQUIRED.filter((k) => !String(env[k] ?? "").trim());
    if (missing.length > 0) {
      console.warn(
        `[env] Eksik zorunlu değişken(ler): ${missing.join(", ")} — .env dosyanızı kontrol edin (.env.example örnek alınabilir).`,
      );
    }
    if (!anyAiKeyConfigured()) {
      console.warn(
        "[env] Hiçbir AI sağlayıcı anahtarı tanımlı değil; yapay zeka modülleri devre dışı kalacak (GEMINI_API_KEY_N / GROQ_API_KEY_N / OPENROUTER_API_KEY_N / HF_TOKEN_N / CEREBRAS_API_KEY / SAMBANOVA_API_KEY veya AI_GATEWAY_*).",
      );
    }
  } catch {
    /* ortam okunamadıysa sessiz geç */
  }
}
