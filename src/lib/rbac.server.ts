/**
 * Role-Based Access Control (RBAC) guard helpers.
 *
 * Sunucu tarafında admin/role kontrolü yapmak için kullanılır.
 * Her API endpoint'inde yetkilendirme kontrolü için bu modülü kullanın.
 */

export type RbacCheckResult =
  { allowed: true; userId: string } | { allowed: false; response: Response };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Kullanıcının belirli bir role'e sahip olup olmadığını kontrol eder.
 * Supabase RPC: has_role(_user_id, _role)
 */
export async function requireRole(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  role: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: role,
    });
    if (error) {
      console.error(`[rbac] role check failed for ${role}`, error);
      return false;
    }
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Admin-only endpoint guard: auth + admin role kontrolü.
 *
 * Kullanım:
 *   const guard = await requireAdmin(request, "resource-name");
 *   if (!guard.allowed) return guard.response;
 *   // guard.userId ile devam et
 */
export async function requireAdmin(request: Request, resource: string): Promise<RbacCheckResult> {
  // Auth kontrolü
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.split(".").length !== 3) {
    return {
      allowed: false,
      response: json(401, { error: "Bu işlem için giriş yapmalısınız." }),
    };
  }

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    return {
      allowed: false,
      response: json(500, { error: "Sunucu yapılandırması eksik." }),
    };
  }

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        allowed: false,
        response: json(401, { error: "Oturumunuz geçersiz." }),
      };
    }
    const user = (await res.json()) as { id?: string };
    if (!user?.id) {
      return {
        allowed: false,
        response: json(401, { error: "Oturumunuz geçersiz." }),
      };
    }

    // Admin role kontrolü
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const isAdmin = await requireRole(supabaseAdmin, user.id, "admin");
    if (!isAdmin) {
      console.warn(`[rbac] non-admin user ${user.id} attempted ${resource}`);
      return {
        allowed: false,
        response: json(403, { error: "Bu alana yalnızca yöneticiler erişebilir." }),
      };
    }

    return { allowed: true, userId: user.id };
  } catch {
    return {
      allowed: false,
      response: json(500, { error: "Yetkilendirme kontrolü başarısız." }),
    };
  }
}

/**
 * Middleware-style guard for server functions that already have auth context.
 * useServerFn handler içinde isAdmin kontrolü için.
 */
export async function assertAdminOrThrow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<void> {
  const isAdmin = await requireRole(supabase, userId, "admin");
  if (!isAdmin) {
    throw new Error("Forbidden: admin role required");
  }
}
