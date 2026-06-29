// 붙여넣기 장미 — 국가(중국 vs 콜롬비아) 판정
// 운영 규칙: 미명시 → 콜롬비아 기본. 중국은 「中」「중국」「중」 등 명시 시에만.

export function isChinaRoseProduct(prod) {
  const cn = String(prod?.CounName || '').trim().toLowerCase();
  return /중국|china/.test(cn);
}

export function isColombiaRoseProduct(prod) {
  const cn = String(prod?.CounName || '').trim().toLowerCase();
  return /콜롬비아|colombia/.test(cn);
}

/** 입력에 중국 장미 의도가 있는지 — 없으면 콜롬비아 기본 */
export function wantsChinaRoseInput(text) {
  const s = String(text || '');
  if (/中国|중국|china/i.test(s)) return true;
  if (/中(?:국|장미)/.test(s)) return true;
  // 한자 中 단독 (中 프라우드, 프라우드 中)
  if (/^中[\s|,，:：|]/.test(s.trim()) || /(?:^|[\s|,，:：|])中(?:$|[\s|,，:：|])/.test(s)) return true;
  // 한글 「중」 단독/중국·중장미 (중앙 등 다른 단어 제외)
  if (/(?:^|[\s,，:：|])중(?:국|장미)?(?=$|[\s,，:：|])/.test(s)) return true;
  return false;
}

export function wantsColombiaRoseInput(text) {
  const s = String(text || '');
  return /(콜롬비아|colombia|콜장미)/i.test(s)
    || /(?:^|[\s])콜(?:\s|$|장미)/i.test(s);
}

/**
 * 장미 후보 목록에 국가 필터 적용 (점수 순 유지)
 * @returns {{ candidates, countryNote }}
 */
export function filterRoseCandidatesByCountry(input, scoredCandidates) {
  const list = [...(scoredCandidates || [])].sort((a, b) => b.score - a.score);
  if (!list.length) return { candidates: list, countryNote: null };

  if (wantsChinaRoseInput(input)) {
    const china = list.filter((x) => isChinaRoseProduct(x.prod));
    if (china.length) return { candidates: china, countryNote: 'china-explicit' };
    return { candidates: list, countryNote: 'china-requested-no-match' };
  }

  if (wantsColombiaRoseInput(input)) {
    const col = list.filter((x) => isColombiaRoseProduct(x.prod));
    if (col.length) return { candidates: col, countryNote: 'colombia-explicit' };
  }

  // 기본: 콜롬비아 장미
  const colDefault = list.filter((x) => isColombiaRoseProduct(x.prod));
  if (colDefault.length) return { candidates: colDefault, countryNote: 'colombia-default' };

  return { candidates: list, countryNote: 'no-colombia-fallback' };
}
