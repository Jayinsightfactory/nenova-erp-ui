function normalizeLineName(value) {
  return String(value || '').replace(/^[-+*\u2022\s]+/, '').replace(/\s+/g, ' ').trim();
}

export function parseStockNoteQuantities(text) {
  const rows = new Map();
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || /^[\s\-_=\u2500\u3161]{3,}$/.test(line)) return;
    const match = line.match(/^(.*?)\s+([+-]?\d+(?:\.\d+)?)\s*(?:\ubc15\uc2a4|\ub2e8|\uc1a1\uc774|\uac1c|\ub300|\uc2a4\ud15c)?\s*(?:\([^)]*\))?\s*$/i);
    if (!match) return;
    const name = normalizeLineName(match[1]);
    const qty = Number(match[2]);
    if (!name || !Number.isFinite(qty)) return;
    rows.set(name, (rows.get(name) || 0) + qty);
  });
  return rows;
}

function formatQty(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

export function buildStockNoteChangeEntry({ baseWeek, previousText, nextText, savedAt }) {
  const before = parseStockNoteQuantities(previousText);
  const after = parseStockNoteQuantities(nextText);
  const names = [...new Set([...before.keys(), ...after.keys()])];
  const changes = names.map((name) => {
    const previousQty = before.get(name) || 0;
    const nextQty = after.get(name) || 0;
    return { name, previousQty, nextQty, delta: nextQty - previousQty };
  }).filter((row) => Math.abs(row.delta) > 0.0001);
  if (!changes.length) return null;
  const shortWeek = String(baseWeek || '').replace(/^\d{4}-/, '').replace(/-0?(\d+)$/, '-$1').replace(/^0/, '');
  const lines = [`${shortWeek} \ubcc0\uacbd\uc0ac\ud56d \uc7ac\uace0 \ud604\ud669`];
  changes.forEach((row) => lines.push(`${row.name} ${row.delta > 0 ? '+' : ''}${formatQty(row.delta)}`));
  return { savedAt: savedAt || new Date().toISOString(), baseWeek, changes, copyText: lines.join('\n') };
}

export function resolveInitialStockBaseWeek(currentWeek) {
  return currentWeek || '';
}
