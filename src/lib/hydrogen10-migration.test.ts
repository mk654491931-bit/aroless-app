import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  fileURLToPath(new URL("../../docs/hydrogen10/MIGRATION.sql", import.meta.url)),
  "utf8",
);

const TABLES = [
  "h10_sources",
  "h10_niches",
  "h10_products",
  "h10_runs",
  "h10_source_runs",
  "h10_offers",
  "h10_observations",
  "h10_ingest_rows",
] as const;

/**
 * Migration canlı DB'ye uygulanmadan önce sözleşmeyi statik olarak kilitler.
 * Amaç SQL'i çalıştırmak değil; tablo/RLS/grant/ingest kapsamının sessizce
 * eksilmesini engellemek.
 */
describe("Hidrojen10 migration sözleşmesi", () => {
  it("sekiz tabloyu da oluşturur ve tekrar çalıştırılabilir", () => {
    expect(sql).toContain("begin;");
    expect(sql).toContain("commit;");
    for (const table of TABLES) {
      expect(sql).toContain(`create table if not exists public.${table} (`);
    }
    expect(sql).toContain("create unique index if not exists h10_runs_one_active_per_niche_idx");
    expect(sql).toContain("drop trigger if exists h10_niches_touch_updated_at");
  });

  it("her ham satırı ve filtre kararını saklayacak kolonları taşır", () => {
    expect(sql).toMatch(/h10_ingest_rows[\s\S]*raw jsonb not null default '\{\}'::jsonb/);
    expect(sql).toMatch(/h10_ingest_rows[\s\S]*eligible boolean not null default false/);
    expect(sql).toMatch(/h10_ingest_rows[\s\S]*rejection_reason text/);
    expect(sql).toMatch(/h10_observations[\s\S]*eligible boolean not null default true/);
    expect(sql).toMatch(/h10_observations[\s\S]*changed boolean not null default false/);
    expect(sql).toContain("unique (niche_id, product_id, source)");
  });

  it("ortak cache tablolarında RLS açar, policy eklemez ve service_role yetkisi verir", () => {
    for (const table of TABLES) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(sql).toContain("grant select, insert, update on public.h10_niches to service_role;");
    expect(sql).toContain(
      "grant select, insert, update, delete on public.h10_offers to service_role;",
    );
    expect(sql).toContain("grant select, insert on public.h10_observations to service_role;");
    expect(sql).toContain("grant select, insert on public.h10_ingest_rows to service_role;");
    expect(sql).toContain("grant select, insert on public.h10_source_runs to service_role;");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("grant usage, select on sequence public.h10_observations_id_seq");
    expect(sql).toContain("grant usage, select on sequence public.h10_ingest_rows_id_seq");
  });

  it("append-only arşivlerde UPDATE/DELETE yetkisi vermez ve eski yetkileri geri alır", () => {
    expect(sql).toContain("revoke update, delete on public.h10_observations from service_role;");
    expect(sql).toContain("revoke update, delete on public.h10_ingest_rows from service_role;");
    expect(sql).not.toContain(
      "grant select, insert, update, delete on public.h10_observations to service_role;",
    );
    expect(sql).not.toContain(
      "grant select, insert, update, delete on public.h10_ingest_rows to service_role;",
    );
  });
});
