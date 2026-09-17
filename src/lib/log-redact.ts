/**
 * Sunucu loglarında kişisel veri maskeleme.
 *
 * Loglar Logflare/Cloudflare/Render gibi aracılara gidebilir; e-posta, IP ve
 * kullanıcı kimliği gibi alanlar ham hâlde yazılmaz (plan §5).
 */

/** `ayse.yilmaz@ornek.com` → `ay**********@ornek.com` */
export function maskEmail(value: string | null | undefined): string {
  const email = (value ?? "").trim();
  if (!email) return "***";
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

/** `203.0.113.42` → `203.0.*.*`, `2001:db8::1` → `2001:db8:*` */
export function maskIp(value: string | null | undefined): string {
  const ip = (value ?? "").trim();
  if (!ip) return "***";
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean);
    return groups.length <= 2 ? `${groups.join(":")}:*` : `${groups.slice(0, 2).join(":")}:*`;
  }
  const parts = ip.split(".");
  if (parts.length !== 4) return "***";
  return `${parts[0]}.${parts[1]}.*.*`;
}

/** Listenin tamamını maskeler (Resend/SES çok alıcılı gönderimler). */
export function maskEmails(values: string | string[] | null | undefined): string {
  const list = (Array.isArray(values) ? values : [values]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (list.length === 0) return "***";
  return list.map(maskEmail).join(", ");
}
