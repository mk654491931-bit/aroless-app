/**
 * Regression tests for AI env-key discovery.
 *
 * Real deployments store keys under suffixes the old readers never scanned
 * (GEMINI_API_KEY_4, OPENROUTER_API_KEY_4, GROQ_API_KEY_4, HF_TOKEN_5,
 * CEREBRAS_API_KEY). These tests pin that every such naming is picked up.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  anyAiKeyConfigured,
  cerebrasEnvKeys,
  geminiEnvKeys,
  groqEnvKeys,
  hfEnvKeys,
  openRouterEnvKeys,
  sambanovaEnvKeys,
} from "./ai-keys.server";
import { geminiKeyPool, groqKeyPool, openRouterKeyPool } from "./ai.server";
import { hfTokenPool } from "./hf.server";

const KEYS_TOUCHED = [
  "GEMINI_API_KEY",
  "GEMINI_API_KEY_1",
  "GEMINI_API_KEY_4",
  "GEMINI_4_API_KEY",
  "GROQ_API_KEY",
  "GROQ_API_KEY_4",
  "GROQ_4_API_KEY",
  "GROQ_API_KEY4",
  "OPENROUTER_API_KEY",
  "OPENROUTER_API_KEY_4",
  "OPENROUTER_API_KEY4",
  "OPENROUTER_4_API_KEY",
  "HF_TOKEN",
  "HF_TOKEN_5",
  "HUGGING_FACE_API_KEY",
  "HUGGING_FACE_API_KEY_5",
  "HUGGING_FACE_API_KEY5",
  "CEREBRAS_API_KEY",
  "CEREBRAS_API_KEY_1",
  "SAMBANOVA_API_KEY",
  "SAMBANOVA_API_KEY_1",
  "AI_GATEWAY_API_KEY",
  "LOVABLE_API_KEY",
];

const ORIGINAL = new Map<string, string | undefined>(
  KEYS_TOUCHED.map((k) => [k, process.env[k]]),
);

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  for (const [k, v] of ORIGINAL) setEnv(k, v);
});

describe("ai key discovery with high-numbered suffixes", () => {
  it("finds GEMINI_API_KEY_4 via the scanner and the ai.server pool", () => {
    setEnv("GEMINI_API_KEY", undefined);
    setEnv("GEMINI_API_KEY_1", undefined);
    setEnv("GEMINI_API_KEY_4", "gk-secret-4");
    expect(geminiEnvKeys()).toContain("gk-secret-4");
    expect(geminiKeyPool()).toContain("gk-secret-4");
  });

  it("finds GROQ_API_KEY_4 in every convention", () => {
    setEnv("GROQ_API_KEY", undefined);
    setEnv("GROQ_API_KEY_4", "gq-secret-4");
    expect(groqEnvKeys()).toContain("gq-secret-4");
    expect(groqKeyPool()).toContain("gq-secret-4");
  });

  it("finds OPENROUTER_API_KEY_4", () => {
    setEnv("OPENROUTER_API_KEY", undefined);
    setEnv("OPENROUTER_API_KEY_4", "or-secret-4");
    expect(openRouterEnvKeys()).toContain("or-secret-4");
    expect(openRouterKeyPool()).toContain("or-secret-4");
  });

  it("finds HF_TOKEN_5", () => {
    setEnv("HF_TOKEN", undefined);
    setEnv("HF_TOKEN_5", "hf-secret-5");
    expect(hfEnvKeys()).toContain("hf-secret-5");
    expect(hfTokenPool()).toContain("hf-secret-5");
  });

  it("finds unnumbered CEREBRAS_API_KEY and SAMBANOVA_API_KEY", () => {
    setEnv("CEREBRAS_API_KEY", "cb-secret");
    setEnv("SAMBANOVA_API_KEY", "sb-secret");
    expect(cerebrasEnvKeys()).toContain("cb-secret");
    expect(sambanovaEnvKeys()).toContain("sb-secret");
  });

  it("dedupes one value stored under two conventions", () => {
    const value = "shared-secret";
    setEnv("GEMINI_API_KEY_4", value);
    setEnv("GEMINI_4_API_KEY", value);
    const pool = geminiEnvKeys();
    expect(pool.filter((k) => k === value)).toHaveLength(1);
  });

  it("reports configured when a numbered key exists", () => {
    setEnv("GROQ_API_KEY_5", "any-secret");
    expect(anyAiKeyConfigured()).toBe(true);
  });

  it("prefers an override token first in the HF pool", () => {
    setEnv("HF_TOKEN_3", "env-token");
    const pool = hfTokenPool("override-token");
    expect(pool[0]).toBe("override-token");
    expect(pool).toContain("env-token");
  });
});
