// 카탈로그 이미지 — 품목명/파일명 → ERP Product 매칭

import path from 'path';

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[[\]()（）]/g, ' ')
    .replace(/[_\-/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addAlias(map, key, prod) {
  const k = norm(key);
  if (k.length >= 2 && !map.has(k)) map.set(k, prod);
}

export function buildProductMatcher(products) {
  const byKey = new Map();
  const byCode = new Map();
  const byName = new Map();

  for (const p of products) {
    byKey.set(Number(p.ProdKey), p);
    addAlias(byCode, p.ProdCode, p);

    for (const raw of [p.DisplayName, p.ProdName]) {
      if (!raw) continue;
      addAlias(byName, raw, p);

      const bracket = raw.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (bracket) addAlias(byName, bracket[2], p);

      if (raw.includes('/')) {
        const parts = raw.split('/').map(s => s.trim()).filter(Boolean);
        addAlias(byName, parts[parts.length - 1], p);
        if (parts.length >= 2) addAlias(byName, `${parts[0]} ${parts[parts.length - 1]}`, p);
      }

      // 영문 품종명 단독 (Alhambra, Bizet 등)
      for (const part of raw.split(/[/|]/)) {
        const t = part.trim();
        if (/^[A-Za-z][A-Za-z0-9\s\-'.]{2,}$/.test(t)) addAlias(byName, t, p);
      }

      const tokens = norm(raw).split(' ').filter(Boolean);
      if (tokens.length >= 3) {
        addAlias(byName, tokens.slice(-3).join(' '), p);
        addAlias(byName, tokens.slice(-2).join(' '), p);
      }
    }
  }

  function matchLabel(label) {
    const base = norm(label);
    if (!base) return null;

    const pk = parseInt(base.replace(/\s.*/, ''), 10);
    if (pk > 0 && byKey.has(pk)) return byKey.get(pk);

    if (byCode.has(base.replace(/\s/g, ''))) return byCode.get(base.replace(/\s/g, ''));
    if (byName.has(base)) return byName.get(base);

    if (label.includes('/')) {
      const tail = norm(label.split('/').pop());
      if (byName.has(tail)) return byName.get(tail);
    }

    let best = null;
    let bestScore = 0;
    for (const [k, prod] of byName) {
      if (k.length < 4) continue;
      if (base === k) return prod;
      if (base.includes(k) || k.includes(base)) {
        const score = Math.min(base.length, k.length);
        if (score > bestScore) { bestScore = score; best = prod; }
      }
    }
    return best;
  }

  function matchFilename(filename) {
    return matchLabel(path.basename(filename));
  }

  function matchCatalogProduct({ name, eng_name, code, label }) {
    const tries = [
      label,
      code,
      eng_name && name ? `${eng_name} ${name}` : null,
      name && eng_name ? `${name} ${eng_name}` : null,
      eng_name,
      name,
    ].filter(Boolean);
    for (const t of tries) {
      const m = matchLabel(t);
      if (m) return m;
    }
    return null;
  }

  return { matchLabel, matchFilename, matchCatalogProduct };
}
