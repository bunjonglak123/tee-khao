import postgres from "postgres";
import { randomBytes } from "node:crypto";

let sql;
export function db() {
  if (!sql) {
    const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!raw) throw httpError(503, "ยังไม่ได้เชื่อมฐานข้อมูลกับโปรเจกต์นี้ (ไม่มี POSTGRES_URL)");
    const u = new URL(raw);
    u.search = "";
    sql = postgres(u.toString(), { ssl: process.env.PGSSLMODE === "disable" ? false : "require", prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  }
  return sql;
}

let ready;
export function ensure() {
  if (!ready) {
    ready = (async () => {
      const s = db();
      await s`create schema if not exists teekhao`;
      await s`create table if not exists teekhao.parties (
        id text primary key, rev bigint not null default 1, data jsonb not null, created_at timestamptz not null default now())`;
      await s`create table if not exists teekhao.members (
        party_id text not null references teekhao.parties(id) on delete cascade,
        id text not null, data jsonb not null, primary key (party_id, id))`;
      await s`create table if not exists teekhao.items (
        party_id text not null references teekhao.parties(id) on delete cascade,
        id text not null, data jsonb not null, primary key (party_id, id))`;
      await s`create table if not exists teekhao.scans (day text primary key, n int not null default 0)`;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
export const newId = () => randomBytes(8).toString("hex");
export const isId = (v) => typeof v === "string" && /^[A-Za-z0-9]{6,32}$/.test(v);
export const str = (v, max) => String(v ?? "").trim().slice(0, max);
export const num = (v, min, max, dflt = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };

export async function readState(s, id) {
  const [p] = await s`select id, rev, data from teekhao.parties where id = ${id}`;
  if (!p) return null;
  const members = await s`select id, data from teekhao.members where party_id = ${id}`;
  const items = await s`select id, data from teekhao.items where party_id = ${id}`;
  return {
    rev: Number(p.rev),
    party: { ...p.data, id: p.id },
    members: members.map((r) => ({ ...r.data, id: r.id })),
    items: items.map((r) => ({ ...r.data, id: r.id })),
  };
}

export function handle(fn) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      res.status(status).json({ error: e.status ? e.message : "เซิร์ฟเวอร์มีปัญหา ลองใหม่อีกครั้ง" });
    }
  };
}
