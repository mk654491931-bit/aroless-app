/**
 * Geliştirilmiş API Hata Yönetim Sistemi
 * Type-safe error handling, retry logic, ve user-friendly messages
 */

export type ApiErrorCode =
  | "auth_required"
  | "auth_invalid"
  | "rate_limited"
  | "validation_error"
  | "server_error"
  | "network_error"
  | "not_found"
  | "conflict"
  | "payload_too_large";

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    public message: string,
    public statusCode: number = 500,
    public retryable: boolean = false,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static fromResponse(response: Response, body: unknown): ApiError {
    const bodyObj = typeof body === "object" ? (body as Record<string, unknown>) : {};
    const message = (bodyObj.error as string | undefined) || response.statusText;

    const codeMap: Record<number, ApiErrorCode> = {
      400: "validation_error",
      401: "auth_invalid",
      403: "auth_required",
      404: "not_found",
      409: "conflict",
      413: "payload_too_large",
      429: "rate_limited",
    };

    const code: ApiErrorCode = (codeMap[response.status] as ApiErrorCode) || "server_error";
    const retryable = response.status >= 500 || response.status === 429;

    return new ApiError(code, message, response.status, retryable, bodyObj);
  }

  static network(): ApiError {
    return new ApiError(
      "network_error",
      "Ağ bağlantısı koptu. Lütfen kontrol edin ve tekrar deneyin.",
      0,
      true,
    );
  }

  userMessage(): string {
    const messages: Record<ApiErrorCode, string> = {
      auth_required: "Bu işlem için giriş yapmalısınız.",
      auth_invalid: "Oturumunuz geçersiz. Lütfen tekrar giriş yapın.",
      rate_limited: "Çok fazla istek gönderdiniz. Lütfen biraz sonra tekrar deneyin.",
      validation_error: "Gönderilen veri geçersiz. Lütfen kontrol edin.",
      server_error: "Sunucu hatası oluştu. Lütfen tekrar deneyin.",
      network_error: "Ağ bağlantısı koptu. Lütfen kontrol edin.",
      not_found: "İstenen kaynak bulunamadı.",
      conflict: "Bu işlem çakışma oluşturdu. Lütfen tekrar deneyin.",
      payload_too_large: "Gönderilen veri çok büyük. Lütfen daha küçük boyutta gönderin.",
    };
    return messages[this.code] || this.message;
  }
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

/**
 * Hata işleme ile API çağrısı
 */
export async function apiCall<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw ApiError.fromResponse(response, body);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof TypeError) throw ApiError.network();
    throw new ApiError("server_error", String(error), 500, false);
  }
}

/**
 * Retry mantığı ile API çağrısı
 */
export async function apiCallWithRetry<T = unknown>(
  url: string,
  options?: RequestInit,
  retryOpts?: RetryOptions,
): Promise<T> {
  const maxAttempts = retryOpts?.maxAttempts ?? 3;
  const baseDelayMs = retryOpts?.baseDelayMs ?? 1000;
  const maxDelayMs = retryOpts?.maxDelayMs ?? 10000;
  const backoffMultiplier = retryOpts?.backoffMultiplier ?? 2;

  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await apiCall<T>(url, options);
    } catch (error) {
      lastError = error as ApiError;

      if (!lastError.retryable) {
        throw lastError;
      }

      if (attempt < maxAttempts - 1) {
        const delayMs = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

/**
 * Hata loglaması (development ve production için)
 */
export function logApiError(error: ApiError, context?: Record<string, unknown>): void {
  const errorObj = {
    code: error.code,
    statusCode: error.statusCode,
    message: error.message,
    context,
    timestamp: new Date().toISOString(),
  };

  if (error.statusCode >= 500) {
    console.error("[API Error]", errorObj);
  } else {
    console.warn("[API Warning]", errorObj);
  }

  // Optionally send to error tracking service
  if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).__LOVABLE_ERROR_TRACKING) {
    ((window as unknown as Record<string, unknown>).__LOVABLE_ERROR_TRACKING as { captureException?: (err: Error, ctx?: Record<string, unknown>) => void }).captureException?.(error, { extra: context });
  }
}
