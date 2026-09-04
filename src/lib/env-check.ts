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

const AI_KEYS = [
  "LOVABLE_API_KEY",
  "AI_GATEWAY_API_KEY",
  "GEMINI_1_API_KEY",
  "GEMINI_API_KEY_1",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY1",
  "OPENROUTER_API_KEY",
  "SAMBANOVA_API_KEY",
  "HF_TOKEN",
  "HUGGING_FACE_API_KEY1",
] as const;

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
    const hasNumberedAiKey = Object.keys(env).some(
      (key) =>
        /^(?:GEMINI|GROQ|OPENROUTER|SAMBANOVA|HF_TOKEN|HUGGING_FACE_API_KEY)/i.test(key) &&
        String(env[key] ?? "").trim(),
    );
    if (!AI_KEYS.some((k) => String(env[k] ?? "").trim()) && !hasNumberedAiKey) {
      console.warn(
        "[env] Hiçbir AI sağlayıcı anahtarı tanımlı değil; yapay zeka modülleri devre dışı kalacak (Gemini / Groq / OpenRouter / SambaNova / Hugging Face veya AI_GATEWAY_*).",
      );
    }
  } catch {
    /* ortam okunamadıysa sessiz geç */
  }
}
