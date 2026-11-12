import { describe, it, expect } from "vitest";
import { computeBill, discountsOf, itemDiscOff, ppPayload, crc16 } from "../lib/bill.js";

const m = (id) => ({ id, name: id });
const party = (over = {}) => ({ service: false, vat: false, round: false, discount: 0, ...over });
const dueOf = (bill, id) => bill.rows.find((r) => r.m.id === id).due;

describe("computeBill", () => {
  it("splits a shared item evenly", () => {
    const b = computeBill(party(), [m("a"), m("b"), m("c")], [{ id: "i1", price: 300, qty: 1, shares: [] }]);
    expect(b.rows.map((r) => r.due)).toEqual([100, 100, 100]);
    expect(b.grand).toBe(300);
  });

  it("adds service 10% then VAT 7%, with and without rounding", () => {
    const its = [{ id: "i1", price: 100, qty: 1, shares: [] }];
    const exact = computeBill(party({ service: true, vat: true }), [m("a")], its);
    expect(exact.rows[0].exact).toBeCloseTo(117.7, 6);
    expect(exact.rows[0].due).toBe(117.7);
    const rounded = computeBill(party({ service: true, vat: true, round: true }), [m("a")], its);
    expect(rounded.rows[0].due).toBe(118);
  });

  it("charges an item only to the people who share it", () => {
    const b = computeBill(party(), [m("a"), m("b")], [
      { id: "i1", price: 200, qty: 1, shares: ["a"] },
      { id: "i2", price: 100, qty: 1, shares: [] },
    ]);
    expect(dueOf(b, "a")).toBe(250);
    expect(dueOf(b, "b")).toBe(50);
  });

  it("applies a percent party discount and caps a baht discount at its base", () => {
    const its = [{ id: "i1", price: 1000, qty: 1, shares: [] }];
    const pct = computeBill(party({ discounts: [{ id: "d1", type: "pct", value: 10, items: [] }] }), [m("a")], its);
    expect(pct.grand).toBe(900);
    const big = computeBill(party({ discounts: [{ id: "d1", type: "baht", value: 5000, items: [] }] }), [m("a")], its);
    expect(big.grand).toBe(0);
  });

  it("applies a per-item discount", () => {
    const b = computeBill(party(), [m("a")], [{ id: "i1", price: 100, qty: 1, shares: [], disc: { type: "baht", value: 30 } }]);
    expect(b.itemOff).toBe(30);
    expect(b.grand).toBe(70);
  });
});

describe("discountsOf / itemDiscOff", () => {
  it("turns a legacy single discount into one baht entry", () => {
    expect(discountsOf({ discount: 50 })).toEqual([{ id: "legacy", label: "ส่วนลดรวม", type: "baht", value: 50, items: [] }]);
  });
  it("caps percent at 100", () => {
    expect(itemDiscOff({ disc: { type: "pct", value: 150 } }, 80)).toBe(80);
  });
});

describe("ppPayload", () => {
  it("builds a static PromptPay payload for a phone number", () => {
    const p = ppPayload("0812345678", 0);
    expect(p).toContain("0066812345678");
    expect(p).toContain("010211");
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });
  it("adds the amount for a dynamic payload", () => {
    const p = ppPayload("081-234-5678", 150);
    expect(p).toContain("010212");
    expect(p).toContain("5406150.00");
  });
  it("rejects ids that are not phone, citizen or e-wallet", () => {
    expect(ppPayload("123", 1)).toBeNull();
  });
});
