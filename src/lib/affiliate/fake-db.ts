/**
 * Bellek içi sahte Supabase istemcisi — affiliate servis birim testleri için.
 * SELECT filtreleri, insert, upsert (onConflict + ignoreDuplicates semantiği),
 * update (eq/in) ve rpc'yi taklit eder.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AffDb, AffResult, AffSelect, AffUpdate } from "./affiliate.service";

type Row = Record<string, any>;

function matches(row: Row, col: string, op: string, val: any): boolean {
  const a = row[col];
  switch (op) {
    case "eq":
      return a === val;
    case "neq":
      return a !== val;
    case "is":
      return val === null ? a === null || a === undefined : a === val;
    case "in":
      return Array.isArray(val) && val.includes(a);
    case "gte":
      return a >= val;
    case "lte":
      return a <= val;
    default:
      return true;
  }
}

export class FakeDb implements AffDb {
  public tables: Record<string, Row[]>;
  public roles: Set<string>;
  public uuid = 0;

  constructor(seed: Record<string, Row[]> = {}, opts: { admins?: string[] } = {}) {
    this.tables = Object.fromEntries(
      Object.entries(seed).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]),
    );
    this.roles = new Set(opts.admins ?? []);
    for (const t of [
      "affiliates",
      "affiliate_referrals",
      "affiliate_clicks",
      "commissions",
      "profiles",
    ]) {
      if (!this.tables[t]) this.tables[t] = [];
    }
  }

  nextId(prefix = "id"): string {
    this.uuid += 1;
    return `${prefix}_${String(this.uuid).padStart(4, "0")}`;
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  private chain(table: string): AffSelect {
    const filters: { col: string; op: string; val: any }[] = [];
    let ordering: { col: string; asc: boolean } | null = null;
    let lim: number | null = null;
    const apply = () =>
      this.rows(table).filter((r) => filters.every((f) => matches(r, f.col, f.op, f.val)));
    const mk = (): AffSelect => ({
      eq: (c, v) => (filters.push({ col: c, op: "eq", val: v }), mk()),
      neq: (c, v) => (filters.push({ col: c, op: "neq", val: v }), mk()),
      in: (c, v) => (filters.push({ col: c, op: "in", val: v }), mk()),
      gte: (c, v) => (filters.push({ col: c, op: "gte", val: v }), mk()),
      lte: (c, v) => (filters.push({ col: c, op: "lte", val: v }), mk()),
      is: (c, v) => (filters.push({ col: c, op: "is", val: v }), mk()),
      order: (c, o) => ((ordering = { col: c, asc: o?.ascending ?? true }), mk()),
      limit: (n) => ((lim = n), mk()),
      maybeSingle: () => {
        let rows = apply();
        if (ordering) {
          rows = [...rows].sort((x, y) =>
            ordering!.asc
              ? x[ordering!.col] > y[ordering!.col]
                ? 1
                : -1
              : x[ordering!.col] < y[ordering!.col]
                ? 1
                : -1,
          );
        }
        const data = rows[0] ?? null;
        return Promise.resolve({ data: data ? { ...data } : null, error: null }) as AffResult;
      },
      single: () => {
        const rows = apply();
        const data = rows[0] ?? null;
        return Promise.resolve({ data: data ? { ...data } : null, error: null });
      },
      then: (onfulfilled?: any, onrejected?: any) => {
        let rows = apply();
        if (ordering) {
          rows = [...rows].sort((x, y) =>
            ordering!.asc
              ? x[ordering!.col] > y[ordering!.col]
                ? 1
                : -1
              : x[ordering!.col] < y[ordering!.col]
                ? 1
                : -1,
          );
        }
        if (lim !== null) rows = rows.slice(0, lim);
        const payload = { data: rows.map((r) => ({ ...r })), error: null };
        return Promise.resolve(payload).then(onfulfilled, onrejected);
      },
    });
    return mk();
  }

  from(table: string) {
    return {
      select: () => this.chain(table),
      insert: async (values: Row | Row[]) => {
        for (const v of Array.isArray(values) ? values : [values]) {
          const row: Row = { id: this.nextId(table), created_at: new Date().toISOString(), ...v };
          this.tables[table]!.push(row);
        }
        return { error: null };
      },
      upsert: async (values: Row, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        const conflictCols = (opts?.onConflict ?? "id").split(",").map((s) => s.trim());
        const existing = this.rows(table).find((r) =>
          conflictCols.every((c) => r[c] !== undefined && r[c] === values[c]),
        );
        if (existing) {
          if (opts?.ignoreDuplicates) return { error: null };
          Object.assign(existing, values);
          return { error: null };
        }
        const row: Row = {
          id: this.nextId(table),
          created_at: new Date().toISOString(),
          ...values,
        };
        this.tables[table]!.push(row);
        return { error: null };
      },
      update: (values: Row): AffUpdate => {
        const applyEq = async (col: string, val: any) => {
          for (const r of this.rows(table)) {
            if (r[col] === val) Object.assign(r, values);
          }
          return { error: null };
        };
        const applyIn = async (col: string, vals: any[]) => {
          for (const r of this.rows(table)) {
            if (vals.includes(r[col])) Object.assign(r, values);
          }
          return { error: null };
        };
        return {
          eq: (c, v) => applyEq(c, v),
          in: (c, v) => applyIn(c, v),
        };
      },
    };
  }

  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }> {
    if (fn === "has_role") {
      const ok = this.roles.has(String(args["_user_id"])) && args["_role"] === "admin";
      return Promise.resolve({ data: ok, error: null });
    }
    return Promise.resolve({ data: null, error: { message: `rpc ${fn} not stubbed` } });
  }
}
