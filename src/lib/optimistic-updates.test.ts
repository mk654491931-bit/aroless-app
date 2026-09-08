import { describe, expect, it } from "vitest";
import {
  addOptimisticFavorite,
  markAllNotificationsReadOptimistically,
  markNotificationReadOptimistically,
  removeOptimisticFavorite,
  toggleNotificationPreferenceOptimistically,
} from "@/lib/optimistic-updates";

describe("optimistic updates", () => {
  it("adds a temporary favorite only once", () => {
    const product = { name: "Aurora Lamp" } as any;
    const rows = addOptimisticFavorite([], product);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "optimistic:Aurora Lamp",
      name: "Aurora Lamp",
      collection_name: "Default",
    });
    expect(addOptimisticFavorite(rows, product)).toEqual(rows);
  });

  it("removes only the targeted favorite", () => {
    expect(
      removeOptimisticFavorite(
        [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ] as any,
        "a",
      ),
    ).toEqual([{ id: "b", name: "B" }]);
  });

  it("marks one notification as read", () => {
    expect(
      markNotificationReadOptimistically(
        [
          { id: "a", read: false },
          { id: "b", read: false },
        ] as any,
        "b",
      ),
    ).toEqual([
      { id: "a", read: false },
      { id: "b", read: true },
    ]);
  });

  it("marks all matching notifications as read", () => {
    expect(
      markAllNotificationsReadOptimistically(
        [
          { id: "a", type: "trend_alert", read: false },
          { id: "b", type: "payment_success", read: false },
        ] as any,
        "trend_alert",
      ),
    ).toEqual([
      { id: "a", type: "trend_alert", read: true },
      { id: "b", type: "payment_success", read: false },
    ]);
  });

  it("toggles a notification preference from default values", () => {
    expect(toggleNotificationPreferenceOptimistically(undefined, "marketing")).toEqual({
      low_credit: true,
      trend_alert: true,
      payment_success: true,
      marketing: true,
    });
  });
});
