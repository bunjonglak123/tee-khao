// Pure bill math and PromptPay payload. Shared by the browser (app.js) and tests.

// Discounts: each one is % or baht, applied to the ticked menus (none ticked = every menu).
// Older parties stored a single baht "discount" for the whole bill; treat it as one such entry.
export function discountsOf(p) {
  const ds = Array.isArray(p.discounts) ? p.discounts.slice() : [];
  if (!ds.length && Number(p.discount) > 0) ds.push({ id: "legacy", label: "ส่วนลดรวม", type: "baht", value: Number(p.discount), items: [] });
  return ds;
}
// Per-menu discount stored on the item itself: { type: "pct" | "baht", value }.
export function itemDiscOff(it, a) {
  const d = it.disc, v = Number(d && d.value) || 0;
  if (!d || v <= 0) return 0;
  return d.type === "pct" ? a * Math.min(v, 100) / 100 : Math.min(v, a);
}

export function computeBill(p, ms, its) {
  const net = {}; let sub = 0, itemOff = 0;
  for (const it of its) {
    const a = (Number(it.price) || 0) * (Number(it.qty) || 1), o = itemDiscOff(it, a);
    net[it.id] = a - o; sub += a; itemOff += o;
  }
  const allItems = its.map((i) => i.id);
  const offs = [];
  for (const d of discountsOf(p)) {
    const v = Number(d.value) || 0;
    let tg = (d.items || []).filter((i) => i in net);
    if (!tg.length) tg = allItems;
    const base = tg.reduce((a, i) => a + net[i], 0);
    if (v <= 0 || base <= 0) { offs.push({ d, off: 0 }); continue; }
    const off = d.type === "pct" ? base * Math.min(v, 100) / 100 : Math.min(v, base);
    const f = 1 - off / base;
    tg.forEach((i) => (net[i] *= f));
    offs.push({ d, off });
  }
  const base = {}; ms.forEach((m) => (base[m.id] = 0));
  const all = ms.map((m) => m.id);
  for (const it of its) {
    let sh = (it.shares || []).filter((i) => i in base);
    if (!sh.length) sh = all;
    if (!sh.length) continue;
    sh.forEach((i) => (base[i] += net[it.id] / sh.length));
  }
  const netSum = allItems.reduce((a, i) => a + net[i], 0);
  const svc = p.service ? 0.10 : 0, vat = p.vat ? 0.07 : 0;
  const rows = ms.map((m) => {
    const n = base[m.id], s = n * svc, v = (n + s) * vat, exact = n + s + v;
    const due = p.round ? Math.ceil(exact - 1e-9) : Math.round(exact * 100) / 100;
    return { m, b: n, exact, due };
  });
  const S = netSum * svc, V = (netSum + S) * vat;
  return { rows, sub, D: sub - netSum, itemOff, offs, S, V, grand: netSum + S + V, collected: rows.reduce((a, r) => a + r.due, 0) };
}

// ---------- PromptPay (EMVCo) ----------
export function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  return c.toString(16).toUpperCase().padStart(4, "0");
}
export const tlv = (t, v) => t + String(v.length).padStart(2, "0") + v;
export function ppPayload(id, amount) {
  const d = String(id || "").replace(/\D/g, "");
  let acc;
  if (d.length === 10 && d[0] === "0") acc = tlv("01", "0066" + d.slice(1));
  else if (d.length === 13) acc = tlv("02", d);
  else if (d.length === 15) acc = tlv("03", d);
  else return null;
  const amt = Number(amount) > 0;
  let s = tlv("00", "01") + tlv("01", amt ? "12" : "11") + tlv("29", tlv("00", "A000000677010111") + acc) + tlv("58", "TH") + tlv("53", "764");
  if (amt) s += tlv("54", Number(amount).toFixed(2));
  s += "6304";
  return s + crc16(s);
}
