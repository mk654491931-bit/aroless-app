export type TaskPriority = "high" | "normal" | "low";

export function requestIdleTask(
  callback: (deadline: IdleDeadline) => void,
  options?: IdleRequestOptions,
): number {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    return window.requestIdleCallback(callback, options);
  }

  const start = Date.now();
  return setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
    });
  }, 0) as unknown as number;
}

export function cancelIdleTask(id: number): void {
  if (typeof window !== "undefined" && "cancelIdleCallback" in window) {
    window.cancelIdleCallback(id);
    return;
  }

  clearTimeout(id);
}

export function scheduleTask(callback: () => void, priority: TaskPriority = "normal"): () => void {
  if (priority === "high") {
    Promise.resolve().then(callback);
    return () => {};
  }

  if (priority === "normal" && typeof window !== "undefined" && "setTimeout" in window) {
    const id = setTimeout(callback, 0);
    return () => clearTimeout(id);
  }

  const id = requestIdleTask(() => callback());
  return () => cancelIdleTask(id);
}
