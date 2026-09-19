// Arka plan iş kuyruğu — Render'da isteği uzatmadan ağır işi koşturan katman.
//
// Kritik davranışlar: sunucusuz ortamda iş BAŞLATILMAZ (çağıran bunu görüp
// kendi bütçesine döner), aynı iş iki kez kuyruğa girmez, zaman aşımı kuyruk
// slotunu serbest bırakır ve eşzamanlılık sınırı korunur.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backgroundJobConcurrency,
  backgroundJobStats,
  describeBackgroundRunner,
  drainBackgroundJobs,
  isBackgroundJobRunning,
  resetJobRunnerCounters,
  runInBackground,
} from "./job-runner.server";

/** Kalıcı servis (Render) benzeri ortam. */
const PERSISTENT = { BACKGROUND_JOBS: "1" };
/** Sunucusuz (Vercel) benzeri ortam. */
const SERVERLESS = { BACKGROUND_JOBS: "false" };

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
  resetJobRunnerCounters();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await drainBackgroundJobs(2_000);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetJobRunnerCounters();
});

describe("runInBackground", () => {
  it("sunucusuz ortamda iş başlatmaz", async () => {
    const task = vi.fn(async () => "done");
    const result = runInBackground("test", task, { env: SERVERLESS });
    expect(result).toEqual({ started: false, reason: "host-unsupported" });
    await flush();
    expect(task).not.toHaveBeenCalled();
    expect(backgroundJobStats(SERVERLESS).skipped).toBe(1);
  });

  it("kalıcı süreçte işi kuyruğa alır ve tamamlar", async () => {
    const result = runInBackground("test", async () => "done", { env: PERSISTENT });
    expect(result.started).toBe(true);
    await drainBackgroundJobs(2_000);
    const stats = backgroundJobStats(PERSISTENT);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.active).toBe(0);
    expect(stats.lastLabel).toBe("test");
  });

  it("aynı key ile ikinci kez kuyruğa alınmaz", async () => {
    const first = runInBackground("a", () => new Promise(() => {}), { env: PERSISTENT, key: "job-1" });
    const second = runInBackground("a", async () => "x", { env: PERSISTENT, key: "job-1" });
    expect(first.started).toBe(true);
    expect(second).toEqual({ started: false, reason: "duplicate", key: "job-1" });
    expect(backgroundJobStats(PERSISTENT).skipped).toBe(1);
  });

  it("isBackgroundJobRunning kuyruktaki ve çalışan işi bildirir", async () => {
    // Konsey gibi pahalı işlerde kredi düşmeden önce sorulur.
    expect(isBackgroundJobRunning("yok")).toBe(false);
    runInBackground("council", () => new Promise(() => {}), {
      env: PERSISTENT,
      key: "council:1",
      timeoutMs: 30,
    });
    expect(isBackgroundJobRunning("council:1")).toBe(true);
    await drainBackgroundJobs(2_000);
    // Zaman aşımıyla biten iş kuyruktan düşer.
    expect(isBackgroundJobRunning("council:1")).toBe(false);
  });

  it("hata işi düşürmez, sayaçta ve özette görünür", async () => {
    runInBackground(
      "patlayan",
      async () => {
        throw new Error("gemini down");
      },
      { env: PERSISTENT },
    );
    await drainBackgroundJobs(2_000);
    const stats = backgroundJobStats(PERSISTENT);
    expect(stats.failed).toBe(1);
    expect(stats.lastError).toBe("patlayan: gemini down");
    expect(stats.active).toBe(0);
  });

  it("zaman aşımında kuyruk slotunu serbest bırakır", async () => {
    runInBackground("asmakalan", () => new Promise(() => {}), { env: PERSISTENT, timeoutMs: 30 });
    expect(await drainBackgroundJobs(2_000)).toBe(true);
    const stats = backgroundJobStats(PERSISTENT);
    expect(stats.timedOut).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.active).toBe(0);
  });

  it("eşzamanlılık sınırını aşmaz", async () => {
    vi.stubEnv("BACKGROUND_JOB_CONCURRENCY", "1");
    expect(backgroundJobConcurrency()).toBe(1);

    let parallel = 0;
    let maxParallel = 0;
    const task = () => async () => {
      parallel++;
      maxParallel = Math.max(maxParallel, parallel);
      await new Promise((resolve) => setTimeout(resolve, 5));
      parallel--;
    };

    runInBackground("a", task(), { env: PERSISTENT });
    runInBackground("b", task(), { env: PERSISTENT });
    runInBackground("c", task(), { env: PERSISTENT });

    await drainBackgroundJobs(3_000);
    expect(maxParallel).toBe(1);
    expect(backgroundJobStats(PERSISTENT).completed).toBe(3);
  });

  it("eşzamanlılık değerini 1..8 aralığına kırpar", () => {
    vi.stubEnv("BACKGROUND_JOB_CONCURRENCY", "0");
    expect(backgroundJobConcurrency()).toBe(2);
    vi.stubEnv("BACKGROUND_JOB_CONCURRENCY", "99");
    expect(backgroundJobConcurrency()).toBe(8);
    vi.stubEnv("BACKGROUND_JOB_CONCURRENCY", "abc");
    expect(backgroundJobConcurrency()).toBe(2);
  });
});

describe("describeBackgroundRunner", () => {
  it("teşhis satırında platform ve sayaçları yazar (sır yok)", () => {
    const line = describeBackgroundRunner(PERSISTENT);
    expect(line).toContain("etkin=true");
    expect(line).toContain("kuyruk=0");
    expect(line).not.toContain("SECRET");
  });
});
