// 관세청 유니패스 화물통관 진행정보 조회 — 서버 전용, 읽기만 한다.
// 키(UNIPASS_API_KEY)는 호출하는 쪽이 넘긴다. 키를 로그·오류 문자열에 넣지 않는다.

const BASE = 'https://unipass.customs.go.kr:38010/ext/rest/cargCsclPrgsInfoQry/retrieveCargCsclPrgsInfo';
const TIMEOUT_MS = 10000;
const CONCURRENCY = 3;
const CACHE_DONE_MS = 6 * 3600 * 1000;
const CACHE_OPEN_MS = 10 * 60 * 1000;

const cache = new Map(); // year|awb → { at, ttl, value }

const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? unesc(m[1]).trim() : '';
}
function dtm(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+09:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

export function parseCustomsXml(xml) {
  const text = String(xml == null ? '' : xml);
  const empty = { found: false, status: '', customsStatus: '', arrivalDate: '', warehouse: '', packages: null, steps: [] };
  const cnt = Number(tag(text, 'tCnt'));
  if (!Number.isFinite(cnt) || cnt <= 0) return empty;
  const sm = text.match(/<cargCsclPrgsInfoQryVo>([\s\S]*?)<\/cargCsclPrgsInfoQryVo>/);
  const sum = sm ? sm[1] : '';
  const steps = [];
  for (const m of text.matchAll(/<cargCsclPrgsInfoDtlQryVo>([\s\S]*?)<\/cargCsclPrgsInfoDtlQryVo>/g)) {
    const at = dtm(tag(m[1], 'prcsDttm'));
    const name = tag(m[1], 'cargTrcnRelaBsopTpcd');
    if (!at || !name) continue;
    steps.push({ at, name, detail: tag(m[1], 'rlbrCn') });
  }
  steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!sm && !steps.length) return empty;
  const d = tag(sum, 'etprDt');
  const pk = Number(tag(sum, 'pckGcnt'));
  return {
    found: true,
    status: tag(sum, 'prgsStts'),
    customsStatus: tag(sum, 'csclPrgsStts'),
    arrivalDate: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : '',
    warehouse: tag(sum, 'shedNm'),
    packages: tag(sum, 'pckGcnt') !== '' && Number.isFinite(pk) ? pk : null,
    steps,
  };
}

export function summarizeCustoms(parsed) {
  const steps = (parsed && parsed.steps) || [];
  const nm = (s) => s.name.replace(/\s+/g, '');
  const ms = (s) => Date.parse(s.at);
  const earliest = (list) => (list.length ? list.reduce((a, b) => (ms(b) < ms(a) ? b : a)).at : null);
  const latest = (list) => (list.length ? list.reduce((a, b) => (ms(b) > ms(a) ? b : a)).at : null);
  const exact = (n) => steps.filter((s) => nm(s) === n);
  const isInspSet = (s) => nm(s).startsWith('식물검사종류확정') || (nm(s).startsWith('검사/검역') && nm(s).includes('(검사제외)'));
  const insp = steps.filter(isInspSet);
  const arrivedList = exact('입항보고수리');
  const first = insp.length ? insp.reduce((a, b) => (ms(b) < ms(a) ? b : a)) : null;
  return {
    manifestAt: earliest(exact('입항적재화물목록제출')),
    arrivedAt: earliest(arrivedList.length ? arrivedList : exact('입항보고제출')),
    unloadedAt: earliest(exact('하기신고수리')),
    warehousedAt: earliest(exact('반입신고')),
    inspectionSetAt: earliest(insp),
    inspectionType: first ? (nm(first).includes('정밀') ? '정밀' : nm(first).includes('검사제외') ? '검사제외' : '') : '',
    quarantinePassedAt: latest(steps.filter((s) => nm(s).startsWith('검사/검역') && (nm(s).includes('(합격)') || nm(s).includes('(검사제외)')))),
    quarantineFailed: steps.some((s) => nm(s).includes('불합격')),
    declaredAt: earliest(exact('수입신고')),
    clearedAt: latest(exact('수입신고수리')),
    releasedAt: latest(exact('반출신고')),
  };
}

// Header summary uses confirmed shipment events and recent, explicit source status only.
export function compactCustomsProgress(record, now = Date.now()) {
  const checkedAt = record?.checkedAt;
  if (record?.found !== true || !Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt >= CACHE_OPEN_MS) return null;
  const progress = String(record.status || '').replace(/\s+/g, '');
  const customs = String(record.customsStatus || '').replace(/\s+/g, '');
  if (record.releasedAt || ['반출신고', '반출완료'].includes(progress)) return null;
  if (/취하|취소|반려/.test(progress + customs)) return null;
  const declaration = record.clearedAt || ['수입신고수리', '수입신고수리완료'].includes(customs)
    ? 'cleared'
    : record.declaredAt && progress && customs ? 'pending' : '';
  const release = ['미반출', '반출대기'].includes(progress) ? 'waiting' : 'unknown';
  return declaration || release === 'waiting' ? { declaration, release } : null;
}

async function fetchOne(key, awb, year, fetchImpl) {
  const url = `${BASE}?crkyCn=${encodeURIComponent(key)}&mblNo=${awb}&blYy=${year}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal });
    if (!res || !res.ok) throw new Error('customs http');
    const parsed = parseCustomsXml(await res.text());
    return { ...summarizeCustoms(parsed), found: parsed.found, status: parsed.status, customsStatus: parsed.customsStatus, arrivalDate: parsed.arrivalDate, warehouse: parsed.warehouse, packages: parsed.packages, steps: parsed.steps };
  } finally {
    clearTimeout(timer);
  }
}

export async function readCustoms(key, items, { fetchImpl = fetch, now, fresh = false } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const out = new Map();
  const jobs = [];
  const seen = new Set();
  for (const it of items || []) {
    const awb = String((it && it.awb) || '').replace(/\D/g, '');
    if (awb.length !== 11 || seen.has(awb)) continue;
    seen.add(awb);
    jobs.push({ awb, year: it.year });
  }
  if (!key) { jobs.forEach((j) => out.set(j.awb, null)); return out; }
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const cacheKey = `${j.year}|${j.awb}`;
      const hit = cache.get(cacheKey);
      // 「새로고침」: 진행 중인 건은 1분만 지나도 다시 묻는다(반출까지 끝난 건은 그대로 둔다).
      const ttl = fresh && hit && hit.ttl === CACHE_OPEN_MS ? 60 * 1000 : hit && hit.ttl;
      if (hit && nowMs - hit.at < ttl) { out.set(j.awb, hit.value); continue; }
      try {
        const value = { ...await fetchOne(key, j.awb, j.year, fetchImpl), checkedAt: nowMs, lookupYear: Number(j.year) };
        cache.set(cacheKey, { at: nowMs, ttl: value.releasedAt ? CACHE_DONE_MS : CACHE_OPEN_MS, value });
        out.set(j.awb, value);
      } catch {
        out.set(j.awb, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return out;
}

export function _clearCustomsCache() { cache.clear(); }
