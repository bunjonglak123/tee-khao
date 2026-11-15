import { clientKey, db, ensure, handle, hit, httpError, str, num } from "./_lib.js";

const PROMPT = `This image is a restaurant receipt, most likely from Thailand. Extract the ordered food and drink items.
Reply with only JSON in this shape:
{"items":[{"name":"ชุดหมูรวม","qty":2,"unit_price":299}],"service_charge":false,"vat_added":true,"discount":0,"total":683.93}
Rules:
- name: as printed on the receipt (keep Thai text as Thai).
- qty: quantity ordered (1 if not shown). unit_price: price of ONE unit in baht (line total divided by qty).
- Skip lines that are not items: subtotal, service charge, VAT/tax, discount, total, cash, change, card, table number.
- service_charge: true if a service charge is added on top.
- vat_added: true only if VAT is ADDED on top of the item prices. false if the receipt says VAT is included (ราคารวม VAT / VAT included) or there is no VAT.
- discount: total discount in baht as a positive number, 0 if none.
- total: the final amount to pay as printed, or null if unreadable.
If the image is not a receipt, reply {"items":[]}.`;

function bangkokDay() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}

export default handle(async (req, res) => {
  if (req.method !== "POST") throw httpError(405, "ใช้ POST เท่านั้น");
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw httpError(503, "ยังไม่ได้ตั้ง GEMINI_API_KEY ในโปรเจกต์ Vercel");
  const b = req.body || {};
  const mime = ["image/jpeg", "image/png", "image/webp"].includes(b.mime) ? b.mime : "image/jpeg";
  const image = typeof b.image === "string" ? b.image : "";
  if (!image || image.length > 4_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image)) throw httpError(400, "รูปไม่ถูกต้องหรือใหญ่เกินไป");

  await ensure();
  if (!(await hit(db(), "scan:" + clientKey(req), 10, 86400))) throw httpError(429, "วันนี้คุณสแกนครบ 10 ครั้งแล้ว พรุ่งนี้สแกนได้ใหม่ ระหว่างนี้จดเมนูเองได้");
  const limit = Math.round(num(process.env.SCAN_DAILY_LIMIT, 1, 10000, 40));
  const day = bangkokDay();
  const [row] = await db()`insert into teekhao.scans (day, n) values (${day}, 1)
    on conflict (day) do update set n = teekhao.scans.n + 1 returning n`;
  if (row.n > limit) throw httpError(429, `วันนี้สแกนครบ ${limit} ครั้งแล้ว พรุ่งนี้สแกนได้ใหม่ ระหว่างนี้จดเมนูเองได้`);

  // Try models in order; a busy (503/500), rate-limited (429), missing (404) or hung model falls through to the next.
  const models = (process.env.GEMINI_MODEL || "gemini-flash-latest,gemini-flash-lite-latest,gemini-flash-latest")
    .split(",").map((m) => m.trim()).filter(Boolean);
  const started = Date.now(), budget = 52_000;
  let j = null, last = 0;
  for (let i = 0; i < models.length; i++) {
    const left = budget - (Date.now() - started);
    if (left < 6000) break;
    if (i > 0) await new Promise((r) => setTimeout(r, 800));
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(models[i])}:generateContent`, {
        method: "POST",
        signal: AbortSignal.timeout(Math.min(25_000, left - 1000)),
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: image } }, { text: PROMPT }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      });
      const body = await r.json().catch(() => null);
      if (r.ok) { j = body; break; }
      last = r.status;
      console.error("gemini", models[i], r.status, JSON.stringify(body).slice(0, 300));
      if (r.status === 400 || r.status === 401 || r.status === 403) break; // key problem: retrying won't help
    } catch (e) {
      last = "timeout";
      console.error("gemini", models[i], e.name || e.message);
    }
  }
  if (!j) {
    await db()`update teekhao.scans set n = greatest(n - 1, 0) where day = ${day}`.catch(() => {});
    if (last === 400 || last === 401 || last === 403) throw httpError(502, "Gemini ไม่ยอมรับ API key ตรวจ GEMINI_API_KEY ใน Vercel อีกครั้ง");
    if (last === 429) throw httpError(429, "โควตาฟรีของ Gemini เต็มชั่วคราว รอสักครู่แล้วลองใหม่ หรือจดเมนูเองไปก่อน");
    throw httpError(503, "ตอนนี้ Gemini มีคนใช้เยอะ ลองสแกนใหม่อีกสักครู่ หรือจดเมนูเองไปก่อน");
  }
  const text = (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  let out;
  try { out = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    try { out = m ? JSON.parse(m[0]) : null; } catch { out = null; }
  }
  if (!out || !Array.isArray(out.items)) throw httpError(422, "อ่านใบเสร็จนี้ไม่ออก ลองถ่ายใหม่ให้ตรงและสว่างขึ้น");
  const items = out.items.slice(0, 100).map((x) => ({
    name: str(x && x.name, 60), qty: Math.max(1, Math.round(num(x && x.qty, 1, 999, 1))),
    price: Math.round(num(x && (x.unit_price ?? x.price), 0, 1e6) * 100) / 100,
  })).filter((x) => x.name);
  const total = Number(out.total);
  res.status(200).json({
    items, service: !!out.service_charge, vat: !!out.vat_added, discount: num(out.discount, 0, 1e6),
    total: Number.isFinite(total) && total > 0 ? total : null,
  });
});
