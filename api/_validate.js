import { isId, str, num } from "./_lib.js";

export const BANKS = new Set(["", "kbank", "ktb", "scb", "bbl", "bay", "ttb", "gsb"]);
export function cleanPatch(f) {
  const out = {};
  if (!f || typeof f !== "object") return out;
  if ("title" in f) { const t = str(f.title, 60); if (t) out.title = t; }
  if ("place" in f) out.place = str(f.place, 80);
  if ("when" in f) out.when = str(f.when, 20);
  if ("max" in f) out.max = Math.round(num(f.max, 0, 50));
  if ("note" in f) out.note = str(f.note, 200);
  if ("payerId" in f) out.payerId = isId(f.payerId) ? f.payerId : "";
  if ("promptpay" in f) out.promptpay = str(f.promptpay, 20);
  if ("service" in f) out.service = !!f.service;
  if ("vat" in f) out.vat = !!f.vat;
  if ("round" in f) out.round = !!f.round;
  if ("discount" in f) out.discount = num(f.discount, 0, 1e6);
  if ("bank" in f && BANKS.has(f.bank)) out.bank = f.bank;
  if ("bankAcct" in f) out.bankAcct = str(f.bankAcct, 20);
  if ("bankAcctName" in f) out.bankAcctName = str(f.bankAcctName, 60);
  if ("discounts" in f && Array.isArray(f.discounts)) {
    out.discounts = f.discounts.slice(0, 20).filter((d) => d && isId(d.id)).map((d) => {
      const pct = d.type === "pct";
      return {
        id: d.id, label: str(d.label, 40), type: pct ? "pct" : "baht",
        value: pct ? num(d.value, 0, 100) : num(d.value, 0, 1e6),
        items: Array.isArray(d.items) ? d.items.filter(isId).slice(0, 100) : [],
      };
    });
  }
  return out;
}
export function cleanItem(it, k) {
  const name = str(it && it.name, 60);
  if (!name) return null;
  return {
    name, price: Math.round(num(it.price, 0, 1e6) * 100) / 100, qty: Math.round(num(it.qty, 1, 999, 1)),
    shares: Array.isArray(it.shares) ? it.shares.filter(isId).slice(0, 60) : [], createdAt: Date.now() + k,
  };
}
