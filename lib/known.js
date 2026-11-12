// Parties this browser has created, joined or opened by link.
// The server never lists other people's parties, so this is the home list.
const KEY = "tk-parties";
const ID = /^[A-Za-z0-9]{6,32}$/;

function read(storage) {
  try {
    const v = JSON.parse(storage.getItem(KEY));
    return Array.isArray(v) ? v.filter((x) => ID.test(x)) : null;
  } catch { return null; }
}
function write(storage, ids) {
  try { storage.setItem(KEY, JSON.stringify([...new Set(ids)].slice(0, 50))); } catch {}
}

export function knownIds(storage) {
  const ids = read(storage);
  if (ids) return ids;
  // Browsers from before this list existed: recover from "tk-me-<partyId>" keys.
  const out = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith("tk-me-") && ID.test(k.slice(6))) out.push(k.slice(6));
    }
  } catch {}
  return out;
}
export function addKnown(storage, id) {
  if (!ID.test(id)) return;
  const ids = knownIds(storage);
  if (!ids.includes(id)) write(storage, [id, ...ids]);
  else if (!read(storage)) write(storage, ids);
}
export function pruneKnown(storage, keepIds) {
  const keep = new Set(keepIds);
  write(storage, knownIds(storage).filter((id) => keep.has(id)));
}
