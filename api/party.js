import { db, ensure, handle, httpError, isId, newId, readState, str, num } from "./_lib.js";
import { cleanPatch, cleanItem } from "./_validate.js";

export default handle(async (req, res) => {
  await ensure();
  const s = db();
  if (req.method === "GET") {
    const id = req.query.id;
    if (!isId(id)) throw httpError(400, "ลิงก์ตี้ไม่ถูกต้อง");
    const rev = Number(req.query.rev);
    if (rev) {
      const [r] = await s`select rev from teekhao.parties where id = ${id}`;
      if (!r) throw httpError(404, "ไม่พบตี้นี้ อาจถูกลบไปแล้ว");
      if (Number(r.rev) === rev) return res.status(200).json({ rev, same: true });
    }
    const st = await readState(s, id);
    if (!st) throw httpError(404, "ไม่พบตี้นี้ อาจถูกลบไปแล้ว");
    return res.status(200).json(st);
  }
  if (req.method !== "POST") throw httpError(405, "ใช้ GET หรือ POST เท่านั้น");

  const b = req.body || {};
  const id = b.id;
  if (!isId(id)) throw httpError(400, "ลิงก์ตี้ไม่ถูกต้อง");

  if (b.op === "deleteParty") {
    await s`delete from teekhao.parties where id = ${id}`;
    return res.status(200).json({ deleted: true });
  }

  await s.begin(async (t) => {
    const [p] = await t`select data from teekhao.parties where id = ${id} for update`;
    if (!p) throw httpError(404, "ไม่พบตี้นี้ อาจถูกลบไปแล้ว");
    let data = p.data;
    const memberIds = async () => (await t`select id from teekhao.members where party_id = ${id}`).map((r) => r.id);

    switch (b.op) {
      case "patch": {
        data = { ...data, ...cleanPatch(b.fields) };
        break;
      }
      case "addMember": {
        const name = str(b.name, 30);
        if (!name) throw httpError(400, "ใส่ชื่อก่อน");
        const ids = await memberIds();
        if (data.max && ids.length >= data.max) throw httpError(409, "ตี้เต็มแล้ว");
        const mid = isId(b.mid) && !ids.includes(b.mid) ? b.mid : newId();
        await t`insert into teekhao.members (party_id, id, data) values (${id}, ${mid}, ${t.json({ name, joinedAt: Date.now(), paid: false })})`;
        break;
      }
      case "removeMember": {
        if (!isId(b.mid)) throw httpError(400, "ไม่พบคนนี้");
        await t`delete from teekhao.members where party_id = ${id} and id = ${b.mid}`;
        const its = await t`select id, data from teekhao.items where party_id = ${id}`;
        for (const it of its) {
          const sh = it.data.shares || [];
          if (sh.includes(b.mid)) {
            await t`update teekhao.items set data = ${t.json({ ...it.data, shares: sh.filter((x) => x !== b.mid) })} where party_id = ${id} and id = ${it.id}`;
          }
        }
        if (data.payerId === b.mid) data = { ...data, payerId: "" };
        break;
      }
      case "renameMember": {
        const name = str(b.name, 30);
        if (!isId(b.mid) || !name) throw httpError(400, "ใส่ชื่อก่อน");
        await t`update teekhao.members set data = data || ${t.json({ name })} where party_id = ${id} and id = ${b.mid}`;
        break;
      }
      case "setPaid": {
        if (!isId(b.mid)) throw httpError(400, "ไม่พบคนนี้");
        await t`update teekhao.members set data = data || ${t.json({ paid: !!b.paid })} where party_id = ${id} and id = ${b.mid}`;
        break;
      }
      case "addItems": {
        const list = (Array.isArray(b.items) ? b.items : []).slice(0, 100).map(cleanItem).filter(Boolean);
        if (!list.length) throw httpError(400, "ไม่มีเมนูให้เพิ่ม");
        for (const it of list) await t`insert into teekhao.items (party_id, id, data) values (${id}, ${newId()}, ${t.json(it)})`;
        if (b.fields) data = { ...data, ...cleanPatch(b.fields) };
        break;
      }
      case "toggleShare": {
        if (!isId(b.iid) || !isId(b.mid)) throw httpError(400, "ข้อมูลไม่ถูกต้อง");
        const [it] = await t`select data from teekhao.items where party_id = ${id} and id = ${b.iid}`;
        if (!it) throw httpError(404, "ไม่พบเมนูนี้");
        const ids = await memberIds();
        const base = (it.data.shares || []).filter((x) => ids.includes(x));
        // Nobody picked yet (= split by everyone): first tap means "only this person".
        const next = !base.length ? [b.mid] : base.includes(b.mid) ? base.filter((x) => x !== b.mid) : [...base, b.mid];
        await t`update teekhao.items set data = ${t.json({ ...it.data, shares: next })} where party_id = ${id} and id = ${b.iid}`;
        break;
      }
      case "updateItem": {
        if (!isId(b.iid)) throw httpError(400, "ไม่พบเมนูนี้");
        const [it] = await t`select data from teekhao.items where party_id = ${id} and id = ${b.iid}`;
        if (!it) throw httpError(404, "ไม่พบเมนูนี้");
        const f = b.fields || {}, next = { ...it.data };
        if ("name" in f) { const n = str(f.name, 60); if (n) next.name = n; }
        if ("price" in f) next.price = Math.round(num(f.price, 0, 1e6) * 100) / 100;
        if ("qty" in f) next.qty = Math.round(num(f.qty, 1, 999, 1));
        if ("disc" in f) {
          const d = f.disc, pct = d && d.type === "pct";
          const v = d ? num(d.value, 0, pct ? 100 : 1e6) : 0;
          next.disc = v > 0 ? { type: pct ? "pct" : "baht", value: v } : null;
        }
        await t`update teekhao.items set data = ${t.json(next)} where party_id = ${id} and id = ${b.iid}`;
        break;
      }
      case "removeItem": {
        if (!isId(b.iid)) throw httpError(400, "ไม่พบเมนูนี้");
        await t`delete from teekhao.items where party_id = ${id} and id = ${b.iid}`;
        break;
      }
      default:
        throw httpError(400, "คำสั่งไม่ถูกต้อง");
    }
    await t`update teekhao.parties set data = ${t.json(data)}, rev = rev + 1 where id = ${id}`;
  });
  res.status(200).json(await readState(s, id));
});
