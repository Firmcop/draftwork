// ===== Lean documents: large file contents (imported STEP text, mesh files, images) and a drawing's stored views
// live in a payload store instead of being copied into every undo step and every browser save. The document in memory
// stays complete; undo copies and saves carry small references ({ $p: key }); downloads and library versions stay
// complete and self-contained. Payloads never change once written (a new import gets a new file id).
// (the boot code runs before this module's lines: the map is made on first use, and payloadsReady is set by the boot)
function payloadMap() { return payloadMap.m || (payloadMap.m = new Map()); }   // key -> value
var payloadsReady;
function heavyFields() { return ['text', 'data', 'url']; }   // functions: the boot code uses these before this module's lines run
function isPayloadRef(v) { return !!v && typeof v === 'object' && typeof v.$p === 'string' && Object.keys(v).length === 1; }
function payloadSave(key, value) {
  if (payloadMap().get(key) === value) return;
  payloadMap().set(key, value);
  libTx('payloads', 'readwrite', st => st ? st.put({ k: key, v: value }) : null).catch(() => { });
}
// a copy of the document whose heavy parts are references (shallow: only files and the drawing cache are rewritten)
function leanDoc(d) {
  if (!d) return d;
  let files = d.files;
  if (files) {
    files = {};
    for (const [id, f] of Object.entries(d.files)) {
      const o = { ...f };
      for (const k of heavyFields()) if (typeof f?.[k] === 'string' && f[k].length > 4096) { const key = 'f:' + id + ':' + k; payloadSave(key, f[k]); o[k] = { $p: key }; }
      files[id] = o;
    }
  }
  let drawing = d.drawing;
  if (drawing?.cache && !isPayloadRef(drawing.cache)) { const c = drawing.cache; c.id ||= uid(); payloadSave('dc:' + c.id, c); drawing = { ...drawing, cache: { $p: 'dc:' + c.id } }; }
  return { ...d, files, drawing };
}
function leanJSON(d) { return JSON.stringify(leanDoc(d)); }
// put payloads that are in memory back in place (others stay references until hydrateDoc loads them)
function reviveDoc(d) {
  if (!d) return d;
  for (const f of Object.values(d.files || {})) for (const k of heavyFields()) if (isPayloadRef(f?.[k]) && payloadMap().has(f[k].$p)) f[k] = payloadMap().get(f[k].$p);
  if (isPayloadRef(d.drawing?.cache) && payloadMap().has(d.drawing.cache.$p)) d.drawing.cache = payloadMap().get(d.drawing.cache.$p);
  return d;
}
// after loading a saved session: fetch the payloads it refers to from the browser database
async function hydrateDoc(d) {
  if (!d) return;
  const keys = [];
  for (const f of Object.values(d.files || {})) for (const k of heavyFields()) if (isPayloadRef(f?.[k]) && !payloadMap().has(f[k].$p)) keys.push(f[k].$p);
  if (isPayloadRef(d.drawing?.cache) && !payloadMap().has(d.drawing.cache.$p)) keys.push(d.drawing.cache.$p);
  for (const key of keys) { try { const rec = await libTx('payloads', 'readonly', st => st ? st.get(key) : null); if (rec) payloadMap().set(key, rec.v); } catch (e) { console.warn('payload', key, e); } }
  reviveDoc(d);
  if (isPayloadRef(d.drawing?.cache)) delete d.drawing.cache;                                   // views are made again
  for (const f of Object.values(d.files || {})) for (const k of heavyFields()) if (isPayloadRef(f?.[k])) { f.missing = true; delete f[k]; }
}
// drop stored payloads that no saved document refers to any more
async function prunePayloads(docs) {
  const used = new Set();
  for (const d of docs) { const s = leanJSON(d); for (const m of s.matchAll(/"\$p":"([^"]+)"/g)) used.add(m[1]); }
  // geometry caches (brep: imports, res: inserted designs) are kept: they serve any design that refers to the same file or version
  try { await libTx('payloads', 'readwrite', st => { if (!st) return null; const r = st.getAllKeys(); r.onsuccess = () => { for (const k of r.result) if (!used.has(k) && !/^(brep|res):/.test(k)) st.delete(k); }; return null; }); } catch (e) { }
}
