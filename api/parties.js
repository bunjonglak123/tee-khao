import { db, ensure, handle, httpError, newId, str, num } from "./_lib.js";

export default handle(async (req, res) => {
  await ensure();
  const s = db();
  if (req.method === "GET") {
    const rows = await s`select id, data->>'title' as title, data->>'place' as place, data->>'when' as "when"
      from teekhao.parties order by created_at desc limit 100`;
    return res.status(200).json({ parties: rows });
  }
  if (req.method !== "POST") throw httpError(405, "ใช้ GET หรือ POST เท่านั้น");
  const b = req.body || {};
  const title = str(b.title, 60), nick = str(b.nick, 30);
  if (!title || !nick) throw httpError(400, "ใส่ชื่อตี้และชื่อเล่นของคุณก่อน");
  const id = newId(), mid = newId();
  const data = {
    title, place: str(b.place, 80), when: str(b.when, 20), max: Math.round(num(b.max, 0, 50)), note: "",
    payerId: mid, promptpay: "", service: false, vat: false, round: true, discount: 0,
    bank: "", bankAcct: "", bankAcctName: "", createdAt: Date.now(),
  };
  await s.begin(async (t) => {
    await t`insert into teekhao.parties (id, data) values (${id}, ${t.json(data)})`;
    await t`insert into teekhao.members (party_id, id, data) values (${id}, ${mid}, ${t.json({ name: nick, joinedAt: Date.now(), paid: false })})`;
  });
  res.status(200).json({ id, memberId: mid });
});
