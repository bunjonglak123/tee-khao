// Fake parties for the demo site, Docker and screenshots. Every name and number here is made up.
const M = { mint: "a1a1a1a1a1a1", boss: "b2b2b2b2b2b2", fah: "c3c3c3c3c3c3", ton: "d4d4d4d4d4d4", ploy: "e5e5e5e5e5e5" };
const FAKE_PP = "0800000000";

const party = (id, days, hour, data, members, items) => ({ id, days, hour, data, members, items });
const mem = (id, name, paid = false) => ({ id, name, paid });
const item = (id, name, price, qty = 1, shares = [], extra = {}) => ({ id, name, price, qty, shares, ...extra });

export const DEMO_PARTIES = [
  party("demo0moo0kata01", -2, 19,
    { title: "หมูกระทะหลังเลิกงาน", place: "ร้านหมูกระทะตัวอย่าง บางนา", max: 6, note: "ใครมาสายเลี้ยงน้ำแข็ง", service: true, vat: true, round: true, promptpay: FAKE_PP },
    [mem(M.mint, "มิ้นท์"), mem(M.boss, "บอส"), mem(M.fah, "ฟ้า"), mem(M.ton, "ต้น")],
    [item("i0000000001", "ชุดหมูรวม", 299, 2), item("i0000000002", "เบียร์", 85, 4, [M.boss, M.ton]),
     item("i0000000003", "น้ำแข็งถัง", 30, 1), item("i0000000004", "ไอติมกะทิ", 39, 2, [M.mint, M.fah])]),
  party("demo0shabu0002", -1, 18,
    { title: "ชาบูวันเกิดฟ้า", place: "ชาบูตัวอย่าง สยาม", max: 5, note: "ฟ้าไม่ต้องจ่าย", service: true, vat: false, round: true, promptpay: FAKE_PP,
      discounts: [{ id: "d0000000001", label: "คูปองสมาชิก 15%", type: "pct", value: 15, items: [] }] },
    [mem(M.ploy, "พลอย"), mem(M.boss, "บอส"), mem(M.mint, "มิ้นท์"), mem(M.fah, "ฟ้า")],
    [item("i0000000011", "บุฟเฟต์ชาบู", 459, 3, [M.ploy, M.boss, M.mint]), item("i0000000012", "เค้กวันเกิด", 450, 1, [M.ploy, M.boss, M.mint]),
     item("i0000000013", "ชาไทย", 45, 2, [M.fah, M.mint], { disc: { type: "baht", value: 10 } })]),
  party("demo0somtam0003", -5, 12,
    { title: "ส้มตำมื้อเที่ยง", place: "ซอยตัวอย่าง 5", max: 0, note: "", service: false, vat: false, round: false, promptpay: "" },
    [mem(M.ton, "ต้น", true), mem(M.fah, "ฟ้า", true), mem(M.ploy, "พลอย", true)],
    [item("i0000000021", "ส้มตำไทย", 60, 2), item("i0000000022", "ไก่ย่าง", 120, 1), item("i0000000023", "ข้าวเหนียว", 10, 3)]),
  party("demo0cafe00004", 1, 15,
    { title: "คาเฟ่วันเสาร์", place: "คาเฟ่ตัวอย่าง อารีย์", max: 4, note: "ใครว่างตอบในไลน์", service: false, vat: false, round: true, promptpay: FAKE_PP },
    [mem(M.mint, "มิ้นท์"), mem(M.ploy, "พลอย")],
    []),
];

function bangkokLocal(days, hour) {
  const d = new Date(Date.now() + 7 * 3600e3 + days * 86400e3);
  return d.toISOString().slice(0, 10) + "T" + String(hour).padStart(2, "0") + ":00";
}

const BASE = { title: "", place: "", when: "", max: 0, note: "", payerId: "", promptpay: "", service: false, vat: false, round: true,
  discount: 0, bank: "", bankAcct: "", bankAcctName: "" };

export async function seedDemo(sql) {
  const now = Date.now();
  await sql.begin(async (t) => {
    await t`truncate teekhao.parties, teekhao.scans cascade`;
    for (const [pi, p] of DEMO_PARTIES.entries()) {
      const data = { ...BASE, ...p.data, when: bangkokLocal(p.days, p.hour), payerId: p.members[0]?.id || "", createdAt: now - pi * 1000 };
      await t`insert into teekhao.parties (id, data, created_at) values (${p.id}, ${t.json(data)}, ${new Date(now - pi * 1000)})`;
      for (const [k, m] of p.members.entries())
        await t`insert into teekhao.members (party_id, id, data) values (${p.id}, ${m.id}, ${t.json({ name: m.name, paid: m.paid, joinedAt: now + k })})`;
      for (const [k, it] of p.items.entries()) {
        const { id, ...rest } = it;
        await t`insert into teekhao.items (party_id, id, data) values (${p.id}, ${id}, ${t.json({ ...rest, createdAt: now + k })})`;
      }
    }
  });
  return DEMO_PARTIES.length;
}
