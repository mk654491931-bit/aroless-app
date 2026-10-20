/**
 * ADMIN KİMLİĞİ — tek kaynak (sunucu).
 *
 * NEDEN İKİ KONTROL: veritabanı admin'i iki yolla tanımlıyor:
 *   1. `user_roles` tablosunda `admin` rolü (asıl kaynak),
 *   2. `is_designated_admin(email)` — sabit e-posta listesi + ilk iki
 *      `@aroless.com` hesabı (trigger'ların ve hoş geldin 250 jetonunun
 *      dayandığı tanım).
 *
 * ÖLÇÜLEN HATA: yalnız (1) sorulduğu için, rolü herhangi bir sebeple
 * yazılmamış eski bir admin hesabı arayüzde \"Free\" görünüyor, 250 jetonluk
 * kotayı alamıyor ve bakiyesi 0 ise ürün bulucu onu `NO_CREDITS` ile
 * reddediyordu — oysa DB trigger'ı aynı e-postaya 250 jeton vermişti.
 *
 * KURAL: rol varsa hızlı yol (tek sorgu). Rol yoksa e-posta tabanlı DB
 * tanımına düşülür. İkisi de yoksa admin DEĞİLDİR (fail-closed).
 */

import { serviceReadDb, type ReadDb } from "./supabase-read.server";

/**
 * Kullanıcı admin mi? (Rol → e-posta tabanlı designated admin.)
 *
 * `db` verilirse okumalar O istemciyle yapılır. Kullanıcı isteğinden gelen
 * JWT istemcisi yeterlidir: `user_roles` ve `profiles` üzerinde "kendi
 * satırını okur" politikaları vardır. Böylece servis anahtarı tanımlı
 * olmasa da admin hesabı tanınır (aksi hâlde 250 jetonluk kota sessizce
 * kayboluyordu).
 */
export async function isAdminAccount(userId: string, db?: ReadDb | null): Promise<boolean> {
  if (!userId) return false;
  const client = db ?? serviceReadDb();

  try {
    if (client) {
      const { data, error } = await client
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      if (!error && data) return true;
    }
  } catch {
    /* rol sorgusu başarısız → e-posta yolunu dene */
  }

  if (!client) return false;

  try {
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) return false;
    const email = String((profile as { email?: string | null } | null)?.email ?? "").trim();
    if (!email) return false;

    // `is_designated_admin` migration'da tanımlı; generated tiplerde yok.
    const { data, error } = await client.rpc(
      "is_designated_admin" as never,
      { _email: email } as never,
    );
    return !error && data === true;
  } catch {
    return false;
  }
}
