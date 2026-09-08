import type { FavoriteRow, WinningProduct } from "@/lib/gemini.functions";
import type { NotificationPreferences, NotificationRow } from "@/lib/notifications.functions";

export function addOptimisticFavorite(
  favorites: readonly FavoriteRow[] | undefined,
  product: WinningProduct,
): FavoriteRow[] {
  const current = favorites ?? [];
  if (current.some((favorite) => favorite.name === product.name)) return [...current];

  return [
    {
      id: `optimistic:${product.name}`,
      name: product.name,
      collection_name: "Default",
      notes: null,
      tags: [],
      product,
      created_at: new Date().toISOString(),
    },
    ...current,
  ];
}

export function removeOptimisticFavorite(
  favorites: readonly FavoriteRow[] | undefined,
  id: string,
): FavoriteRow[] {
  return (favorites ?? []).filter((favorite) => favorite.id !== id);
}

export function markNotificationReadOptimistically(
  notifications: readonly NotificationRow[] | undefined,
  id: string,
): NotificationRow[] {
  return (notifications ?? []).map((notification) =>
    notification.id === id ? { ...notification, read: true } : notification,
  );
}

export function markAllNotificationsReadOptimistically(
  notifications: readonly NotificationRow[] | undefined,
  type?: string,
): NotificationRow[] {
  return (notifications ?? []).map((notification) =>
    !type || notification.type === type ? { ...notification, read: true } : notification,
  );
}

export function toggleNotificationPreferenceOptimistically<
  TKey extends keyof NotificationPreferences,
>(preferences: NotificationPreferences | undefined, key: TKey): NotificationPreferences {
  const current = preferences ?? {
    low_credit: true,
    trend_alert: true,
    payment_success: true,
    marketing: false,
  };

  return { ...current, [key]: !current[key] };
}
