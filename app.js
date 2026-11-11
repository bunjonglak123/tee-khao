(() => {
  const $ = (s) => document.querySelector(s);
  const PROPS = new Set(["value", "checked", "disabled", "selected"]);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

  // Styles for tap-to-rename (kept with the feature).
  document.head.append(h("style", { text: ".mname{background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer}.mname::after{content:' \\270E';color:var(--muted);font-size:.8em}.member.editing{padding:4px 6px}.rename{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.rename input{width:9em;min-width:0;border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:4px 8px}.item-acts{grid-column:1/-1;display:flex;gap:14px;flex-wrap:wrap;font-size:.82rem}.disc-tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;font-size:.72rem;background:var(--chili-soft);color:var(--chili);vertical-align:1px}.amt s{display:block;color:var(--muted);font-size:.78rem;text-align:right}.item.editing{display:block}.item-edit{display:grid;gap:8px;padding:6px 0}.ie-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}.disc-note{font-size:.78rem;color:var(--muted)}" }));

  // ---------- state ----------
  let parties = [], loaded = false;
  let pid = null, cur = null; // cur = {rev, party, members, items}
  const newShares = new Set();
  const confirming = { key: null };
  const members = () => (cur ? cur.members : []);
  const items = () => (cur ? cur.items : []);
  const party = () => (cur ? cur.party : null);

  // ---------- network ----------
  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800); }
  async function api(path, body) {
    const r = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(new Error((j && j.error) || "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง"), { status: r.status });
    $("#net").hidden = true;
    return j;
  }
  function setState(st) {
    if (!st || st.same) return;
    if (cur && cur.party.id === st.party.id && cur.rev !== st.rev) bump();
    st.members.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    st.items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    cur = st;
    const i = parties.findIndex((p) => p.id === st.party.id);
    const row = { id: st.party.id, title: st.party.title, place: st.party.place, when: st.party.when };
    if (i >= 0) parties[i] = row; else parties.unshift(row);
    renderList(); renderDetail();
  }
  // Ops update the screen first (optimistic), then the server's answer replaces it.
  // Only the answer to the last in-flight op is applied, so rapid taps don't flicker.
  let pending = 0;
  async function op(name, payload) {
    if (!pid) return;
    pending++; bump();
    try {
      const st = await api("/api/party", { id: pid, op: name, ...payload });
      if (pending === 1) setState(st);
    } catch (e) {
      toast(e.message);
      if (e.status === 404) { location.hash = ""; loadParties(); }
      else if (cur) cur.rev = -1; // force a full reload to undo the optimistic change
    } finally {
      pending--;
      if (!pending && cur && cur.rev === -1) poll();
    }
  }
  const patchParty = (fields) => {
    if (cur) { Object.assign(cur.party, fields); renderDetail(); }
    return op("patch", { fields });
  };

  async function loadParties() {
    try { parties = (await api("/api/parties")).parties || []; loaded = true; renderList(); }
    catch (e) { loaded = true; renderList(e.message); }
  }
  let polling = false;
  async function poll() {
    if (polling || !pid || pending || document.hidden) return;
    polling = true;
    const id = pid;
    try {
      const st = await api(`/api/party?id=${encodeURIComponent(id)}${cur && cur.party.id === id ? "&rev=" + cur.rev : ""}`);
      if (id === pid && !pending) setState(st);
    } catch (e) {
      if (e.status === 404) { toast(e.message); location.hash = ""; loadParties(); }
      else $("#net").hidden = false;
    } finally { polling = false; }
  }
  // Poll fast (~1s) while people are active; ease off to 5s after 3 quiet minutes.
  let lastActivity = Date.now();
  function bump() { lastActivity = Date.now(); }
  (async function loop() {
    await poll();
    setTimeout(loop, Date.now() - lastActivity > 180000 ? 5000 : 1200);
  })();
  ["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, bump, { passive: true }));
  setInterval(() => { if (!document.hidden) loadParties(); }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { bump(); poll(); loadParties(); } });

  // ---------- formatting ----------
  const baht = (n) => { const v = Math.round(n * 100) / 100 || 0; return "฿" + v.toLocaleString("th-TH", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }); };
  const whenText = (s) => {
    if (!s) return "ยังไม่กำหนดเวลา";
    const d = new Date(s); if (isNaN(d)) return s;
    return d.toLocaleString("th-TH", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " น.";
  };
  const isPast = (s) => { const d = new Date(s); return !isNaN(d) && d.getTime() < Date.now() - 3 * 3600e3; };
  const myMemberId = () => { const local = store.get("tk-me-" + pid); return members().some((m) => m.id === local) ? local : null; };

  // ---------- bill math ----------
  // Discounts: each one is % or baht, applied to the ticked menus (none ticked = every menu).
  // Older parties stored a single baht "discount" for the whole bill; treat it as one such entry.
  function discountsOf(p) {
    const ds = Array.isArray(p.discounts) ? p.discounts.slice() : [];
    if (!ds.length && Number(p.discount) > 0) ds.push({ id: "legacy", label: "ส่วนลดรวม", type: "baht", value: Number(p.discount), items: [] });
    return ds;
  }
  // Per-menu discount stored on the item itself: { type: "pct" | "baht", value }.
  function itemDiscOff(it, a) {
    const d = it.disc, v = Number(d && d.value) || 0;
    if (!d || v <= 0) return 0;
    return d.type === "pct" ? a * Math.min(v, 100) / 100 : Math.min(v, a);
  }
  const discLabel = (d) => d.label || (d.type === "pct" ? `ลด ${Number(d.value) || 0}%` : "ส่วนลด");
  function computeBill(p, ms, its) {
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

  // ---------- payment: banks & PromptPay QR ----------
  const BANKS = { kbank: "กสิกรไทย", ktb: "กรุงไทย", scb: "ไทยพาณิชย์", bbl: "กรุงเทพ", bay: "กรุงศรี", ttb: "ทหารไทยธนชาต", gsb: "ออมสิน" };
  let qrWho = null;
  function fmtAcct(a) { const d = a.replace(/\D/g, ""); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 4)}-${d.slice(4, 9)}-${d.slice(9)}` : a; }
  function crc16(s) {
    let c = 0xffff;
    for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
    return c.toString(16).toUpperCase().padStart(4, "0");
  }
  const tlv = (t, v) => t + String(v.length).padStart(2, "0") + v;
  function ppPayload(id, amount) {
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
  async function saveQr(pp, row, payer, p, btn) {
    btn.disabled = true;
    try {
      const q = window.qrcode(0, "M"); q.addData(ppPayload(pp, row.due)); q.make();
      const n = q.getModuleCount(), cell = 10, quiet = 4, qrPx = (n + quiet * 2) * cell;
      const W = qrPx + 80, H = qrPx + 210;
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const x = c.getContext("2d");
      try { await document.fonts.ready; } catch {}
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H);
      x.textAlign = "center"; x.fillStyle = "#16201a";
      x.font = '600 30px "IBM Plex Sans Thai", system-ui, sans-serif';
      x.fillText(`${row.m.name} โอนให้ ${payer.name}`, W / 2, 54, W - 40);
      const ox = 40, oy = 76;
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect(ox + (k + quiet) * cell, oy + (r + quiet) * cell, cell, cell);
      x.font = '600 46px "IBM Plex Mono", ui-monospace, monospace';
      x.fillText(baht(row.due), W / 2, oy + qrPx + 58, W - 40);
      x.fillStyle = "#5d6b62"; x.font = '400 22px "IBM Plex Sans Thai", system-ui, sans-serif';
      x.fillText(`${p.title || "ตี้ข้าว"} · สแกนด้วยแอปธนาคาร`, W / 2, oy + qrPx + 100, W - 40);
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
      const safe = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) || "QR";
      const name = `QR-${safe(row.m.name)}-${Math.round(row.due)}baht.png`;
      const file = new File([blob], name, { type: "image/png" });
      const mobile = matchMedia("(pointer: coarse)").matches;
      if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e && e.name !== "AbortError") throw e; }
      } else {
        const url = URL.createObjectURL(blob);
        const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast("บันทึกรูป QR แล้ว");
      }
    } catch { toast("บันทึกไม่ได้ กดค้างที่รูป QR แล้วเลือกบันทึกรูปแทน"); }
    finally { btn.disabled = false; }
  }

  // ---------- list ----------
  function renderList(err) {
    const ul = $("#partyList"); ul.replaceChildren();
    const sorted = [...parties].sort((a, b) => {
      const pa = isPast(a.when), pb = isPast(b.when);
      if (pa !== pb) return pa ? 1 : -1;
      return pa ? String(b.when).localeCompare(String(a.when)) : String(a.when).localeCompare(String(b.when));
    });
    for (const p of sorted) {
      ul.append(h("li", { class: isPast(p.when) ? "past" : null },
        h("a", { href: "#p-" + p.id, "aria-current": p.id === pid ? "true" : "false" },
          h("span", { class: "t", text: p.title || "ตี้ไม่มีชื่อ" }),
          h("span", { class: "m", text: whenText(p.when) + (p.place ? " · " + p.place : "") }))));
    }
    const empty = $("#listEmpty");
    empty.hidden = loaded && parties.length > 0 && !err;
    empty.textContent = err ? err : !loaded ? "กำลังโหลด…" : "ยังไม่มีตี้ กด “ตั้งตี้ใหม่” เพื่อเริ่ม";
  }

  // ---------- detail ----------
  function setVal(el, v) { if (document.activeElement !== el) { if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? ""; } }

  function renderDetail() {
    document.body.classList.toggle("has-party", !!pid);
    const p = cur && cur.party.id === pid ? party() : null;
    $("#welcome").hidden = !!p;
    $("#detail").hidden = !p;
    if (!p) return;
    const ms = members(), its = items();

    const max = Number(p.max) || 0, full = max && ms.length >= max, past = isPast(p.when);
    const chip = $("#statusChip");
    chip.className = "chip" + (past ? " past" : full ? " full" : "");
    chip.textContent = past ? "กินไปแล้ว" : full ? "ตี้เต็มแล้ว" : "เปิดรับอยู่";
    $("#pTitle").textContent = p.title || "ตี้ไม่มีชื่อ";
    $("#pMeta").replaceChildren(
      h("span", null, "เมื่อ ", h("b", { text: whenText(p.when) })),
      p.place ? h("span", null, "ที่ ", h("b", { text: p.place })) : "");
    $("#pNote").hidden = !p.note; $("#pNote").textContent = p.note || "";
    setVal($("#eTitle"), p.title); setVal($("#ePlace"), p.place); setVal($("#eWhen"), p.when);
    setVal($("#eMax"), p.max || ""); setVal($("#eNote"), p.note);

    // members
    const mine = myMemberId();
    $("#countLbl").textContent = ms.length + (max ? " / " + max + " คน" : " คน");
    const ml = $("#memberList");
    // Don't rebuild while someone is typing a new name (polling would wipe the input).
    if (!(ml.contains(document.activeElement) && document.activeElement.tagName === "INPUT")) {
    ml.replaceChildren();
    if (!ms.length) ml.append(h("li", { class: "list-empty", text: "ยังไม่มีใครเข้าร่วม" }));
    for (const m of ms) {
      const key = "m-" + m.id;
      if (confirming.key === "rn-" + m.id) {
        const done = (save) => {
          const v = $("#rn-" + m.id).value.trim();
          confirming.key = null;
          document.activeElement.blur(); // let the list redraw
          if (save && v && v !== m.name) { m.name = v; renderDetail(); op("renameMember", { mid: m.id, name: v }); }
          else renderDetail();
        };
        ml.append(h("li", { class: "member editing" },
          h("form", { class: "rename", onsubmit: (e) => { e.preventDefault(); done(true); } },
            h("input", { id: "rn-" + m.id, value: m.name || "", maxlength: "30", "aria-label": "ชื่อใหม่ของ " + m.name, onkeydown: (e) => { if (e.key === "Escape") done(false); } }),
            h("button", { class: "btn small primary", type: "submit", text: "บันทึก" }),
            h("button", { class: "btn small", type: "button", text: "ยกเลิก", onclick: () => done(false) }))));
        continue;
      }
      const li = h("li", { class: "member" + (m.id === mine ? " me" : "") },
        h("button", { class: "mname", type: "button", title: "แตะเพื่อแก้ชื่อ", text: m.name || "ไม่มีชื่อ", onclick: () => { confirming.key = "rn-" + m.id; renderDetail(); const el = $("#rn-" + m.id); if (el) { el.focus(); el.select(); } } }),
        m.id === mine ? h("span", { class: "tag", text: "คุณ" }) : null,
        m.id === p.payerId ? h("span", { class: "tag", text: "คนจ่าย" }) : null);
      if (confirming.key === key) li.append(h("span", { class: "confirm" },
        h("button", { class: "btn small danger", type: "button", text: "เอาออก", onclick: () => { confirming.key = null; op("removeMember", { mid: m.id }); } }),
        h("button", { class: "btn small", type: "button", text: "ไม่", onclick: () => { confirming.key = null; renderDetail(); } })));
      else li.append(h("button", { class: "x", type: "button", "aria-label": "เอา " + m.name + " ออก", text: "×", onclick: () => { confirming.key = key; renderDetail(); } }));
      ml.append(li);
    }
    }
    const meM = ms.find((m) => m.id === mine);
    $("#whoBox").hidden = !!mine;
    $("#meLine").hidden = !mine;
    if (meM) $("#meLine").replaceChildren("คุณคือ ", h("b", { text: meM.name }), " · ",
      h("button", { class: "linkbtn", type: "button", text: "ไม่ใช่ฉัน", onclick: () => { store.set("tk-me-" + pid, ""); renderDetail(); } }));
    else {
      $("#whoPicks").hidden = !ms.length;
      $("#whoHint").textContent = ms.length ? "แตะชื่อตัวเอง เว็บจะจำไว้ในเครื่องนี้ ถ้ายังไม่มีชื่อ พิมพ์ชื่อแล้วกดเข้าร่วม" : "พิมพ์ชื่อเล่นแล้วกดเข้าร่วม";
      $("#whoPicks").replaceChildren(...ms.map((m) => h("button", { class: "pick", type: "button", text: m.name,
        onclick: () => { store.set("tk-me-" + pid, m.id); store.set("tk-nick", m.name); toast("จำแล้วว่าคุณคือ " + m.name); renderDetail(); } })));
    }
    $("#joinBtn").disabled = !!full; $("#addBtn").disabled = !!full;
    $("#joinBtn").textContent = full ? "ตี้เต็มแล้ว" : "เข้าร่วมตี้";
    if (!$("#joinName").value && document.activeElement !== $("#joinName")) $("#joinName").value = store.get("tk-nick") || "";

    // items
    const il = $("#itemList");
    // Don't rebuild while someone is editing a menu (polling would wipe the form).
    const editingItem = il.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
    if (!editingItem) {
    il.replaceChildren();
    if (!its.length) il.append(h("li", { class: "items-empty", text: "ยังไม่ได้จดเมนู สแกนใบเสร็จหรือเพิ่มจานแรกด้านล่าง" }));
    for (const it of its) {
      if (confirming.key === "ie-" + it.id) { il.append(itemEditRow(it)); continue; }
      const sh = new Set((it.shares || []).filter((i) => ms.some((m) => m.id === i)));
      const qty = Number(it.qty) || 1, amt = (Number(it.price) || 0) * qty, off = itemDiscOff(it, amt);
      const key = "i-" + it.id;
      const del = confirming.key === key
        ? h("span", { class: "confirm" },
            h("button", { class: "btn small danger", type: "button", text: "ลบ", onclick: () => { confirming.key = null; op("removeItem", { iid: it.id }); } }),
            h("button", { class: "btn small", type: "button", text: "ไม่", onclick: () => { confirming.key = null; renderDetail(); } }))
        : h("button", { class: "x", type: "button", "aria-label": "ลบ " + it.name, text: "×", onclick: () => { confirming.key = key; renderDetail(); } });
      il.append(h("li", { class: "item" },
        h("div", null,
          h("div", { class: "name" }, it.name, off > 0 ? h("span", { class: "disc-tag", text: it.disc.type === "pct" ? `ลด ${it.disc.value}%` : `ลด ${baht(off)}` }) : null),
          qty > 1 ? h("div", { class: "qty num", text: qty + " × " + baht(Number(it.price) || 0) }) : null),
        h("div", { class: "amt num" }, off > 0 ? h("s", { text: baht(amt) }) : null, baht(amt - off)),
        del,
        h("div", { class: "item-acts" },
          h("button", { class: "linkbtn", type: "button", text: "✎ แก้เมนู/ราคา", onclick: () => openItemEdit(it, "ien-") }),
          h("button", { class: "linkbtn", type: "button", text: off > 0 ? "แก้ส่วนลด" : "ลดราคา", onclick: () => openItemEdit(it, "ied-") })),
        h("div", { class: "shares" },
          h("span", { class: "lbl", text: sh.size ? "หาร " + sh.size + " คน:" : "หารทุกคน · แตะชื่อคนที่กิน:" }),
          ms.map((m) => h("button", {
            class: "pick" + (m.id === mine ? " mine" : ""), type: "button", "aria-pressed": sh.has(m.id) ? "true" : "false", text: m.name,
            onclick: () => { toggleLocal(it, m.id); renderDetail(); op("toggleShare", { iid: it.id, mid: m.id }); },
          })))));
    }
    }
    [...newShares].forEach((i) => { if (!ms.some((m) => m.id === i)) newShares.delete(i); });
    $("#newShares").replaceChildren(
      h("span", { class: "lbl", text: newShares.size ? "ใครกินจานนี้:" : "ใครกินจานนี้ (ไม่เลือก = ทุกคน):" }),
      ...ms.map((m) => h("button", { class: "pick", type: "button", "aria-pressed": newShares.has(m.id) ? "true" : "false", text: m.name,
        onclick: () => { newShares.has(m.id) ? newShares.delete(m.id) : newShares.add(m.id); renderDetail(); } })));

    // bill settings
    setVal($("#bSvc"), p.service); setVal($("#bVat"), p.vat); setVal($("#bRound"), p.round);
    renderDiscounts(p);
    setVal($("#bPP"), p.promptpay);
    setVal($("#bBank"), p.bank || ""); setVal($("#bAcct"), p.bankAcct); setVal($("#bAcctName"), p.bankAcctName);
    const sel = $("#bPayer");
    if (document.activeElement !== sel) {
      sel.replaceChildren(h("option", { value: "", text: "— ยังไม่ระบุ —" }), ...ms.map((m) => h("option", { value: m.id, text: m.name })));
      sel.value = ms.some((m) => m.id === p.payerId) ? p.payerId : "";
    }

    renderSlip(p);

    const dz = $("#dangerZone");
    dz.replaceChildren(confirming.key === "party"
      ? h("span", { class: "confirm" }, "ลบตี้นี้พร้อมเมนูทั้งหมด?",
          h("button", { class: "btn small danger", type: "button", text: "ลบเลย", onclick: deleteParty }),
          h("button", { class: "btn small", type: "button", text: "ไม่ลบ", onclick: () => { confirming.key = null; renderDetail(); } }))
      : h("button", { class: "btn small danger", type: "button", text: "ลบตี้นี้", onclick: () => { confirming.key = "party"; renderDetail(); } }));
  }

  // Same rule as the server's toggleShare, applied locally so the tap shows instantly.
  // An item nobody has picked yet is split by everyone; the first tap means "only me", later taps add/remove.
  function toggleLocal(it, mid) {
    const ids = members().map((m) => m.id);
    const base = (it.shares || []).filter((x) => ids.includes(x));
    it.shares = !base.length ? [mid] : base.includes(mid) ? base.filter((x) => x !== mid) : [...base, mid];
  }

  function openItemEdit(it, focusPrefix) {
    confirming.key = "ie-" + it.id;
    renderDetail();
    const el = $("#" + focusPrefix + it.id);
    if (el) { el.focus(); if (el.select) el.select(); }
  }
  function itemEditRow(it) {
    const id = it.id;
    const close = (save) => {
      const name = $("#ien-" + id).value.trim();
      const price = Math.max(0, Number($("#iep-" + id).value) || 0);
      const qty = Math.max(1, Math.round(Number($("#ieq-" + id).value) || 1));
      const dv = Math.max(0, Number($("#ied-" + id).value) || 0), dt = $("#iedt-" + id).value;
      confirming.key = null;
      if (document.activeElement) document.activeElement.blur(); // let the list redraw
      if (!save || !name) { renderDetail(); return; }
      const disc = dv > 0 ? { type: dt === "pct" ? "pct" : "baht", value: dt === "pct" ? Math.min(dv, 100) : dv } : null;
      Object.assign(it, { name, price, qty, disc });
      renderDetail();
      op("updateItem", { iid: id, fields: { name, price, qty, disc } });
    };
    const d = it.disc || {};
    const F = (label, input) => h("label", { class: "field" }, h("span", { text: label }), input);
    return h("li", { class: "item editing" },
      h("form", { class: "item-edit", onsubmit: (e) => { e.preventDefault(); close(true); }, onkeydown: (e) => { if (e.key === "Escape") close(false); } },
        F("ชื่อเมนู", h("input", { id: "ien-" + id, value: it.name, maxlength: "60", required: true })),
        h("div", { class: "ie-grid" },
          F("ราคาต่อหน่วย (บาท)", h("input", { id: "iep-" + id, type: "number", min: "0", step: "0.01", inputmode: "decimal", value: it.price ?? "" })),
          F("จำนวน", h("input", { id: "ieq-" + id, type: "number", min: "1", step: "1", value: it.qty || 1 }))),
        h("div", { class: "ie-grid" },
          F("ลดราคาเมนูนี้", h("input", { id: "ied-" + id, type: "number", min: "0", step: "0.01", inputmode: "decimal", placeholder: "0 = ไม่ลด", value: d.value || "" })),
          F("หน่วย", h("select", { id: "iedt-" + id },
            h("option", { value: "pct", text: "%", selected: d.type !== "baht" }), h("option", { value: "baht", text: "บาท", selected: d.type === "baht" })))),
        h("div", { class: "actions" },
          h("button", { class: "btn small", type: "button", text: "ยกเลิก", onclick: () => close(false) }),
          h("button", { class: "btn small primary", type: "submit", text: "บันทึก" }))));
  }

  function saveDiscounts(list) { patchParty({ discounts: list, discount: 0 }); }
  function renderDiscounts(p) {
    const box = $("#discList");
    if (box.contains(document.activeElement) && document.activeElement.tagName !== "BUTTON") return; // don't clobber typing
    const ds = discountsOf(p), its = items();
    if (!ds.length) { box.replaceChildren(h("p", { class: "sub", text: "ส่วนลดทั้งบิล เช่น คูปองร้าน กด “+ เพิ่มส่วนลด” · ส่วนลดเฉพาะเมนู กดปุ่ม “ลดราคา” ที่เมนูนั้น" })); return; }
    box.replaceChildren(...ds.map((d) => {
      const upd = (patch) => saveDiscounts(ds.map((x) => (x.id === d.id ? { ...x, ...patch } : x)));
      const tg = new Set((d.items || []).filter((i) => its.some((it) => it.id === i)));
      return h("div", { class: "disc-row" },
        h("div", { class: "disc-top" },
          h("input", { type: "text", id: "dl-" + d.id, value: d.label || "", maxlength: "40", placeholder: "เช่น คูปองร้าน, สมาชิก", "aria-label": "ชื่อส่วนลด", onchange: (e) => upd({ label: e.target.value.trim() }) }),
          h("input", { type: "number", id: "dv-" + d.id, value: d.value || "", min: "0", step: "0.01", inputmode: "decimal", class: "num", placeholder: "0", "aria-label": "มูลค่าส่วนลด", onchange: (e) => upd({ value: Math.max(0, Number(e.target.value) || 0) }) }),
          h("select", { id: "dt-" + d.id, "aria-label": "หน่วยส่วนลด", onchange: (e) => upd({ type: e.target.value }) },
            h("option", { value: "pct", text: "%", selected: d.type === "pct" }), h("option", { value: "baht", text: "บาท", selected: d.type !== "pct" })),
          h("button", { class: "x", type: "button", "aria-label": "ลบส่วนลดนี้", text: "×", onclick: () => saveDiscounts(ds.filter((x) => x.id !== d.id)) })),
        h("span", { class: "disc-note", text: tg.size ? `ใช้กับ ${tg.size} เมนูที่เลือกไว้ก่อนหน้า` : "ลดจากยอดทั้งบิล" }));
    }));
  }

  function renderSlip(p) {
    const slip = $("#slip");
    const ms = members(), its = items();
    const bill = computeBill(p, ms, its);
    const payer = ms.find((m) => m.id === p.payerId);
    const kids = [h("h3", { text: p.title || "ตี้ไม่มีชื่อ" }), h("div", { class: "sub", text: whenText(p.when) + (p.place ? " · " + p.place : "") })];
    if (!its.length || !ms.length) {
      kids.push(h("hr", { class: "dash" }), h("p", { class: "list-empty", style: "text-align:center", text: !ms.length ? "ยังไม่มีคนในตี้" : "จดเมนูแล้วยอดของแต่ละคนจะขึ้นตรงนี้" }));
      slip.replaceChildren(...kids); return;
    }
    const L = (label, val, cls) => h("div", { class: "line " + (cls || "") }, h("span", { text: label }), h("span", { class: "num", text: val }));
    kids.push(h("hr", { class: "dash" }), h("div", { class: "lines" },
      L("ค่าอาหาร " + its.length + " รายการ", baht(bill.sub)),
      bill.itemOff > 0.004 ? L("ส่วนลดรายเมนู", "−" + baht(bill.itemOff)) : null,
      bill.offs.filter((o) => o.off > 0.004).map((o) => L(discLabel(o.d), "−" + baht(o.off))),
      p.service ? L("เซอร์วิสชาร์จ 10%", baht(bill.S)) : null,
      p.vat ? L("VAT 7%", baht(bill.V)) : null,
      L("รวมทั้งบิล", baht(bill.grand), "grand"),
      p.round && bill.collected - bill.grand > 0.005 ? L("ปัดเศษแล้วเก็บเกิน", baht(bill.collected - bill.grand), "muted") : null));
    kids.push(h("hr", { class: "dash" }));
    const ul = h("ul", { class: "people" });
    const mine = myMemberId();
    let paidCount = 0, others = 0, outstanding = 0;
    for (const r of bill.rows) {
      const isPayer = payer && r.m.id === payer.id;
      if (!isPayer) { others++; if (r.m.paid) paidCount++; else outstanding += r.due; }
      const state = isPayer ? "" : r.m.paid ? " paid" : payer ? " owes" : "";
      ul.append(h("li", { class: "person" + state + (r.m.id === mine ? " me" : "") },
        isPayer ? h("span", { "aria-hidden": "true", style: "width:18px" })
          : h("input", { type: "checkbox", checked: !!r.m.paid, "aria-label": r.m.name + " โอนแล้ว", onchange: (e) => { r.m.paid = e.target.checked; renderDetail(); op("setPaid", { mid: r.m.id, paid: r.m.paid }); } }),
        h("span", { class: "who" }, r.m.name, h("small", { text: isPayer ? "ออกเงินให้ร้านไปแล้ว" : r.m.paid ? "โอนแล้ว" : payer ? "ต้องโอนให้ " + payer.name : "ส่วนของคนนี้" })),
        h("span", { class: "due num", text: baht(r.due) })));
    }
    kids.push(ul);
    if (payer) {
      const pp = (p.promptpay || "").trim();
      const acct = (p.bankAcct || "").trim();
      kids.push(h("div", { class: "pay-to" },
        h("span", null, "โอนให้ ", h("b", { text: payer.name })),
        pp ? h("div", { class: "pp" }, h("span", { text: "พร้อมเพย์" }), h("span", { class: "num", text: pp }),
          h("button", { class: "btn small", type: "button", text: "คัดลอกเลข", onclick: (e) => copy(pp.replace(/\D/g, ""), e.target) })) : null,
        acct ? h("div", { class: "pp" }, h("span", { text: BANKS[p.bank] || "บัญชี" }), h("span", { class: "num", text: fmtAcct(acct) }),
          h("button", { class: "btn small", type: "button", text: "คัดลอกเลขบัญชี", onclick: (e) => copy(acct.replace(/\D/g, ""), e.target) })) : null,
        acct && p.bankAcctName ? h("span", { class: "acct-name", text: "ชื่อบัญชี " + p.bankAcctName }) : null,
        !pp && !acct ? h("span", { class: "acct-name", text: "ยังไม่ได้ใส่พร้อมเพย์หรือเลขบัญชี ใส่ได้ในกล่องด้านซ้าย" }) : null));
      const owing = bill.rows.filter((r) => r.m.id !== payer.id && r.due > 0);
      if (ppPayload(pp, 1) && window.qrcode && owing.length) {
        if (!owing.some((r) => r.m.id === qrWho)) {
          const pick = owing.find((r) => r.m.id === mine) || owing.find((r) => !r.m.paid) || owing[0];
          qrWho = pick.m.id;
        }
        const row = owing.find((r) => r.m.id === qrWho);
        let src = null;
        try { const q = window.qrcode(0, "M"); q.addData(ppPayload(pp, row.due)); q.make(); src = q.createDataURL(5, 2); } catch {}
        if (src) kids.push(h("div", { class: "qr-box" },
          h("label", { class: "field", style: "width:100%" }, h("span", { text: "QR พร้อมเพย์ของ" }),
            h("select", { id: "qrWho", onchange: (e) => { qrWho = e.target.value; renderDetail(); } },
              ...owing.map((r) => h("option", { value: r.m.id, text: r.m.name + (r.m.paid ? " (โอนแล้ว)" : ""), selected: r.m.id === qrWho })))),
          h("img", { src, alt: "QR พร้อมเพย์ " + baht(row.due) + " ให้ " + payer.name, width: "200", height: "200" }),
          h("span", { class: "amt num", text: baht(row.due) }),
          h("button", { class: "btn primary small", type: "button", text: "บันทึกรูป QR", onclick: (e) => saveQr(pp, row, payer, p, e.target) }),
          h("small", { text: "สแกนด้วยแอปธนาคารไหนก็ได้ ยอดจะขึ้นให้อัตโนมัติ ถ้าใช้มือถือเครื่องเดียว ให้บันทึกรูปแล้วเลือก “สแกนจากรูป” ในแอป" })));
      }
      kids.push(h("div", { class: "progress num", text: others ? `โอนแล้ว ${paidCount}/${others} คน` + (outstanding > 0.005 ? ` · ค้างอีก ${baht(outstanding)}` : " · ครบแล้ว") : "" }));
    } else {
      kids.push(h("div", { class: "progress", text: "เลือกคนออกเงินจ่ายร้าน เพื่อดูว่าใครต้องโอนให้ใคร" }));
    }
    kids.push(h("div", { class: "actions", style: "margin-top:12px;justify-content:center" },
      h("button", { class: "btn small", type: "button", text: "คัดลอกสรุปไปส่งในแชท", onclick: (e) => copy(summaryText(p, bill, payer), e.target) })));
    slip.replaceChildren(...kids);
  }

  function summaryText(p, bill, payer) {
    const lines = [p.title || "ตี้ข้าว", whenText(p.when) + (p.place ? " @ " + p.place : ""), "----------"];
    for (const r of bill.rows) {
      const isPayer = payer && r.m.id === payer.id;
      lines.push(`${r.m.name}  ${baht(r.due)}${isPayer ? " (คนจ่าย)" : r.m.paid ? " ✓ โอนแล้ว" : ""}`);
    }
    if (bill.D > 0.004) lines.push("----------", "ส่วนลดรวม −" + baht(bill.D));
    lines.push("----------", "รวม " + baht(bill.grand) + [p.service ? "รวมเซอร์วิส" : "", p.vat ? "รวม VAT" : ""].filter(Boolean).map((s) => " " + s).join(""));
    if (payer) {
      lines.push("โอนให้ " + payer.name);
      if (p.promptpay) lines.push("พร้อมเพย์ " + p.promptpay);
      if (p.bankAcct) lines.push((BANKS[p.bank] || "บัญชี") + " " + fmtAcct(p.bankAcct) + (p.bankAcctName ? " (" + p.bankAcctName + ")" : ""));
    }
    lines.push("", "ติ๊กเมนู/ดูยอด: " + location.href);
    return lines.join("\n");
  }

  function copy(text, btn) {
    const done = () => { const o = btn.textContent; btn.textContent = "คัดลอกแล้ว"; setTimeout(() => (btn.textContent = o), 1500); };
    try { navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); } catch { fallbackCopy(text, done); }
  }
  function fallbackCopy(text, done) {
    const ta = h("textarea", { style: "position:fixed;opacity:0;left:0;top:0" }); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch {}
    ta.remove(); ok ? done() : toast("คัดลอกไม่ได้ ลองเลือกข้อความเอง");
  }

  // ---------- receipt scan ----------
  let scan = null, scanBusy = false;
  function scanStatus(msg, spinning) {
    const el = $("#scanStatus");
    el.hidden = !msg; el.replaceChildren(spinning ? h("span", { class: "spin", "aria-hidden": "true" }) : "", msg || "");
  }
  function scanTotals() {
    const on = scan.items.filter((i) => i.on);
    const sub = on.reduce((a, i) => a + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
    const n = Math.max(0, sub - (Number(scan.discount) || 0)), s = scan.service ? n * 0.1 : 0, v = scan.vat ? (n + s) * 0.07 : 0;
    return { count: on.length, grand: n + s + v };
  }
  function updateScanCheck() {
    const el = $("#scanCheck"), btn = $("#scanAdd"); if (!el) return;
    const t = scanTotals(), T = scan.total;
    const diff = T != null ? t.grand - T : 0, ok = T == null || Math.abs(diff) < 1;
    el.className = "scan-check" + (ok ? "" : " bad");
    el.replaceChildren(
      h("span", null, "ยอดจากรายการที่เลือก ", h("b", { class: "num", text: baht(t.grand) })),
      T != null ? h("span", null, "ใบเสร็จเขียนไว้ ", h("b", { class: "num", text: baht(T) }), ok ? " · ตรงกัน" : " · ต่างกัน " + baht(Math.abs(diff)) + " ลองตรวจราคา จำนวน หรือเซอร์วิสชาร์จ") : h("span", { text: "อ่านยอดรวมในใบเสร็จไม่ได้ ลองเทียบกับใบจริงอีกที" }));
    btn.textContent = "เพิ่ม " + t.count + " รายการ"; btn.disabled = !t.count;
  }
  function renderScan() {
    const box = $("#scanReview");
    if (!scan) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    const rows = scan.items.map((it, i) => {
      const row = h("div", { class: "scan-item" + (it.on ? "" : " off") });
      row.append(
        h("input", { type: "checkbox", id: "scan-on-" + i, checked: it.on, "aria-label": "ใช้รายการนี้", onchange: (e) => { it.on = e.target.checked; row.classList.toggle("off", !it.on); updateScanCheck(); } }),
        h("input", { type: "text", id: "scan-n-" + i, value: it.name, maxlength: "60", "aria-label": "ชื่อเมนู", oninput: (e) => (it.name = e.target.value) }),
        h("input", { type: "number", id: "scan-q-" + i, value: it.qty, min: "1", step: "1", "aria-label": "จำนวน", class: "num", oninput: (e) => { it.qty = Math.max(1, Math.round(Number(e.target.value) || 1)); updateScanCheck(); } }),
        h("input", { type: "number", id: "scan-p-" + i, value: it.price, min: "0", step: "0.01", "aria-label": "ราคาต่อหน่วย", class: "num", oninput: (e) => { it.price = Math.max(0, Number(e.target.value) || 0); updateScanCheck(); } }));
      return row;
    });
    box.replaceChildren(h("div", { class: "fields" },
      h("div", { class: "scan-items" },
        h("div", { class: "scan-item head" }, h("span"), h("span", { text: "เมนู" }), h("span", { text: "จำนวน" }), h("span", { text: "ราคา/หน่วย" })),
        rows),
      h("div", { class: "toggles" },
        h("label", { class: "toggle" }, h("input", { type: "checkbox", id: "scanSvc", checked: scan.service, onchange: (e) => { scan.service = e.target.checked; updateScanCheck(); } }), h("span", { text: "ร้านคิดเซอร์วิสชาร์จ 10%" })),
        h("label", { class: "toggle" }, h("input", { type: "checkbox", id: "scanVat", checked: scan.vat, onchange: (e) => { scan.vat = e.target.checked; updateScanCheck(); } }), h("span", { text: "ร้านบวก VAT 7% เพิ่มจากราคาอาหาร" }))),
      h("label", { class: "field" }, h("span", { text: "ส่วนลดในใบเสร็จ (บาท)" }),
        h("input", { type: "number", id: "scanDisc", min: "0", step: "0.01", value: scan.discount || "", placeholder: "0", oninput: (e) => { scan.discount = Math.max(0, Number(e.target.value) || 0); updateScanCheck(); } })),
      h("div", { id: "scanCheck" }),
      h("p", { class: "sub", style: "margin:0", text: "เมนูที่เพิ่มจะหารทุกคนก่อน แตะชื่อใต้เมนูทีหลังเพื่อเลือกคนหาร ค่าเซอร์วิส VAT และส่วนลดจะถูกตั้งในบิลของตี้ตามนี้" }),
      h("div", { class: "actions" },
        h("button", { class: "btn", type: "button", text: "ยกเลิก", onclick: () => { scan = null; renderScan(); scanStatus(""); } }),
        h("button", { class: "btn primary", type: "button", id: "scanAdd", onclick: addScanned }))));
    updateScanCheck();
  }
  async function addScanned() {
    if (!scan || !pid) return;
    const on = scan.items.filter((i) => i.on && i.name.trim()).map((i) => ({ name: i.name.trim(), price: i.price, qty: i.qty, shares: [] }));
    const fields = { service: !!scan.service, vat: !!scan.vat };
    const disc = Number(scan.discount) || 0;
    if (disc > 0 && party()) {
      fields.discounts = [...discountsOf(party()), { id: newId(), label: "ส่วนลดจากใบเสร็จ", type: "baht", value: disc, items: [] }];
      fields.discount = 0;
    }
    scan = null; renderScan(); scanStatus("");
    await op("addItems", { items: on, fields });
    toast("เพิ่ม " + on.length + " รายการแล้ว แตะชื่อใต้เมนูเพื่อเลือกคนหาร");
  }
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(bin);
    } finally { URL.revokeObjectURL(url); }
  }
  async function runScan(file) {
    if (scanBusy) return;
    scanBusy = true; $("#scanBox").classList.add("busy"); $("#scanFile").disabled = true;
    scan = null; renderScan();
    scanStatus("กำลังอ่านใบเสร็จ… ปกติใช้เวลา 5–30 วินาที", true);
    try {
      let image;
      try { image = await shrink(file); } catch { scanStatus("เปิดรูปนี้ไม่ได้ ลองใช้รูป JPG หรือ PNG"); return; }
      const r = await api("/api/scan", { image, mime: "image/jpeg" });
      const list = (r.items || []).map((x) => ({ ...x, on: true }));
      if (!list.length) { scanStatus("ไม่เจอรายการอาหารในรูปนี้ ลองถ่ายให้เห็นทั้งใบและชัดขึ้น"); return; }
      scan = { items: list, service: !!r.service, vat: !!r.vat, discount: r.discount || 0, total: r.total ?? null };
      scanStatus("อ่านได้ " + list.length + " รายการ ตรวจชื่อ จำนวน และราคาก่อนกดเพิ่ม");
      renderScan();
    } catch (e) {
      scanStatus(e.message || "เชื่อมต่อไม่สำเร็จ กดเลือกรูปเพื่อลองใหม่");
    } finally {
      scanBusy = false; $("#scanBox").classList.remove("busy"); $("#scanFile").disabled = false;
    }
  }
  $("#scanFile").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) runScan(f); });
  $("#scanBox").hidden = false;

  // ---------- actions ----------
  async function createParty(e) {
    e.preventDefault();
    const title = $("#cTitle").value.trim(), nick = $("#cNick").value.trim();
    if (!title || !nick) return;
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      const r = await api("/api/parties", { title, nick, place: $("#cPlace").value.trim(), when: $("#cWhen").value, max: Number($("#cMax").value) || 0 });
      store.set("tk-nick", nick); store.set("tk-me-" + r.id, r.memberId);
      $("#createForm").reset(); $("#createForm").hidden = true;
      location.hash = "p-" + r.id;
      toast("ตั้งตี้แล้ว ส่งลิงก์หน้านี้ให้เพื่อนได้เลย");
      loadParties();
    } catch (err) { toast(err.message); }
    finally { if (btn) btn.disabled = false; }
  }
  function addMember(name, mine) {
    if (!name || !party()) return;
    const max = Number(party().max) || 0;
    if (max && members().length >= max) { toast("ตี้เต็มแล้ว"); return; }
    const mid = newId();
    if (mine) { store.set("tk-nick", name); store.set("tk-me-" + pid, mid); }
    op("addMember", { name, mid });
  }
  async function deleteParty() {
    const id = pid; confirming.key = null;
    try { await api("/api/party", { id, op: "deleteParty" }); toast("ลบตี้แล้ว"); } catch (e) { toast(e.message); }
    location.hash = ""; loadParties();
  }

  // ---------- routing ----------
  function route() {
    const m = /^#p-([A-Za-z0-9]+)$/.exec(location.hash);
    const next = m ? m[1] : null;
    if (next !== pid) {
      pid = next; cur = null; newShares.clear(); confirming.key = null; qrWho = null;
      if (!scanBusy) { scan = null; renderScan(); scanStatus(""); }
      $("#joinName").value = "";
      window.scrollTo(0, 0);
      if (pid) poll();
    }
    renderList(); renderDetail();
  }

  // ---------- wiring ----------
  $("#newBtn").onclick = () => {
    const f = $("#createForm"); f.hidden = !f.hidden;
    if (!f.hidden) {
      $("#cNick").value = $("#cNick").value || store.get("tk-nick") || "";
      if (!$("#cWhen").value) {
        const d = new Date(); d.setDate(d.getDate() + 1);
        const pad = (n) => String(n).padStart(2, "0");
        $("#cWhen").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T19:00`;
      }
      $("#cTitle").focus();
    }
  };
  $("#cCancel").onclick = () => ($("#createForm").hidden = true);
  $("#createForm").addEventListener("submit", createParty);
  $("#backBtn").onclick = () => (location.hash = "");
  $("#joinForm").addEventListener("submit", (e) => { e.preventDefault(); addMember($("#joinName").value.trim(), true); });
  $("#addMemberForm").addEventListener("submit", (e) => { e.preventDefault(); const n = $("#addName").value.trim(); addMember(n, false); $("#addName").value = ""; });
  $("#itemForm").addEventListener("submit", (e) => {
    e.preventDefault(); if (!pid) return;
    const name = $("#iName").value.trim(), price = Number($("#iPrice").value), qty = Math.max(1, Math.round(Number($("#iQty").value) || 1));
    if (!name || !(price >= 0)) return;
    const shares = newShares.size === members().length ? [] : [...newShares];
    op("addItems", { items: [{ name, price, qty, shares }] });
    $("#iName").value = ""; $("#iPrice").value = ""; $("#iQty").value = "1"; newShares.clear(); $("#iName").focus();
  });
  const onChange = (id, fn) => $("#" + id).addEventListener("change", (e) => fn(e.target));
  onChange("eTitle", (el) => el.value.trim() && patchParty({ title: el.value.trim() }));
  onChange("ePlace", (el) => patchParty({ place: el.value.trim() }));
  onChange("eWhen", (el) => patchParty({ when: el.value }));
  onChange("eMax", (el) => patchParty({ max: Number(el.value) || 0 }));
  onChange("eNote", (el) => patchParty({ note: el.value.trim() }));
  onChange("bSvc", (el) => patchParty({ service: el.checked }));
  onChange("bVat", (el) => patchParty({ vat: el.checked }));
  onChange("bRound", (el) => patchParty({ round: el.checked }));
  $("#addDisc").onclick = () => { const p = party(); if (p) saveDiscounts([...discountsOf(p), { id: newId(), label: "", type: "pct", value: 0, items: [] }]); };
  onChange("bPayer", (el) => patchParty({ payerId: el.value }));
  onChange("bPP", (el) => patchParty({ promptpay: el.value.trim() }));
  onChange("bBank", (el) => patchParty({ bank: el.value }));
  onChange("bAcct", (el) => patchParty({ bankAcct: el.value.trim() }));
  onChange("bAcctName", (el) => patchParty({ bankAcctName: el.value.trim() }));
  window.addEventListener("hashchange", route);

  // ---------- boot ----------
  renderList();
  loadParties();
  route();
})();
