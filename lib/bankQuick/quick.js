// 하나은행 빠른조회서비스 순수 함수(브라우저·DB 의존 없음). 값(계좌·비밀번호)은 어떤 함수도 로그하지 않는다.
export const QUICK_URL = 'https://www.kebhana.com/flex/quick/quickService.do?subMenu=1';
export const MAX_MONTHS = 24;

// alias → env 키 이름 (영숫자·_ 외 문자는 _ 로)
export function quickEnvKeys(alias) {
  const a = String(alias || '').replace(/[^A-Za-z0-9_]/g, '_');
  return { acct: `HANA_QUICK_ACCT_${a}`, pw: `HANA_QUICK_PW_${a}`, biz: 'HANA_BIZ_NO5' };
}

// 값 검증 후 반환. 에러 메시지에는 키 이름과 길이만.
export function readQuickCreds(env, alias) {
  const k = quickEnvKeys(alias);
  const acct = String(env[k.acct] ?? '').replace(/\D/g, '');
  const pw = String(env[k.pw] ?? '').trim();
  const biz = String(env[k.biz] ?? '').replace(/\D/g, '');
  if (acct.length !== 14) throw new Error(`${k.acct}: 14자리 숫자 필요(현재 길이 ${acct.length})`);
  if (!/^\d{4}$/.test(pw)) throw new Error(`${k.pw}: 4자리 숫자 필요(현재 길이 ${pw.length})`);
  if (biz.length !== 5) throw new Error(`${k.biz}: 5자리 숫자 필요(현재 길이 ${biz.length})`);
  return { acct, pw, biz };
}

// 조회 가능 하한: today 기준 24개월 전 같은 달 1일 이후(월 단위 보수적 판정)
export function earliestAllowed(today) {
  const t = String(today);
  let y = Number(t.slice(0, 4));
  let m = Number(t.slice(5, 7)) - MAX_MONTHS;
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}-${t.slice(8, 10)}`;
}

// 월 구간을 허용 범위로 분류. 구간 전체가 하한보다 이전이면 skipped, 걸치면 시작일을 하한으로 당김.
export function splitByLimit(chunks, today) {
  const lo = earliestAllowed(today);
  const ok = [];
  const skipped = [];
  for (const [s, e] of chunks) {
    if (e < lo) skipped.push([s, e]);
    else ok.push([s < lo ? lo : s, e]);
  }
  return { ok, skipped, earliest: lo };
}

export const toYmd = (d) => String(d).replace(/-/g, '');

// 결과 표(HTML) → { headers, rows }. 가장 행이 많은 table 을 거래표로 보고 th/첫행을 헤더로.
export function parseResultHtml(html) {
  const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const tables = [...String(html).matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);
  let best = { headers: [], rows: [] };
  for (const t of tables) {
    const trs = [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    let headers = [];
    const rows = [];
    for (const tr of trs) {
      const ths = [...tr.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => strip(m[1]));
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1]));
      if (ths.length && !tds.length) { if (!headers.length) headers = ths; } else if (tds.length && /\d{4}[-./]?\d{2}[-./]?\d{2}/.test(tds.join(' '))) rows.push(tds);
    }
    if (rows.length > best.rows.length) best = { headers, rows };
  }
  return best;
}
