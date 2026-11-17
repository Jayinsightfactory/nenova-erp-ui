// 인천공항 여객·화물 도착 운항 정보(공공데이터포털) 조회 — 서버 전용, 읽기만 한다.
// 키는 호출하는 쪽이 넘긴다(ICN_FLIGHT_API_KEY). 키를 로그·오류 문자열에 넣지 않는다.

const BASE = 'https://apis.data.go.kr/B551177/statusOfAllFltDeOdp/getFltArrivalsDeOdp';
const TIMEOUT_MS = 8000;
const CACHE_MS = 10 * 60 * 1000;
const CONCURRENCY = 4;
const MATCH_WINDOW_MS = 18 * 3600 * 1000;

const cache = new Map(); // 편명 원문 → { at, items }

const clean = (flight) => String(flight == null ? '' : flight).replace(/\s+/g, '').toUpperCase();

// 숫자 앞 0 을 뺀 표기(KE0926 → KE926)
export function normalizeFlightId(flight) {
  const f = clean(flight);
  const m = f.match(/^([A-Z0-9]{2})(\d+)$/);
  if (!m) return f;
  return `${m[1]}${m[2].replace(/^0+(?=\d)/, '')}`;
}

// 'YYYYMMDDHHmm'(한국 시간) → ISO +09:00
export function parseIcnDatetime(s) {
  const m = String(s == null ? '' : s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

// 공지 도착 시각과 예정 시각이 18시간 이내인 것 중 가장 가까운 항목
export function pickIcnRecord(items, arrivalIso) {
  const arr = Date.parse(arrivalIso);
  if (!Array.isArray(items) || !Number.isFinite(arr)) return null;
  const masters = items.filter((x) => x && x.codeshare === 'Master');
  let best = null;
  let bestDiff = Infinity;
  for (const it of items) {
    if (!it) continue;
    if (it.codeshare === 'Slave' && masters.some((m) => m.scheduleDatetime === it.scheduleDatetime)) continue;
    const sch = parseIcnDatetime(it.scheduleDatetime);
    if (!sch) continue;
    const diff = Math.abs(Date.parse(sch) - arr);
    if (diff <= MATCH_WINDOW_MS && diff < bestDiff) { best = it; bestDiff = diff; }
  }
  return best;
}

function extractItems(json) {
  const body = json && json.response && json.response.body;
  const items = body && body.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (Array.isArray(items.item)) return items.item;
  if (items.item && typeof items.item === 'object') return [items.item];
  return [];
}

async function fetchJson(url, fetchImpl) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!res || !res.ok) throw new Error('icn http');
    const json = await res.json();
    const code = json && json.response && json.response.header && json.response.header.resultCode;
    if (code !== '00') throw new Error('icn result');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function queryFlightId(key, flightId, fetchImpl) {
  const results = await Promise.allSettled(['P', 'C'].map((pc) => {
    const url = new URL(BASE);
    url.searchParams.set('serviceKey', key);
    url.searchParams.set('type', 'json');
    url.searchParams.set('numOfRows', '30');
    url.searchParams.set('flightId', flightId);
    url.searchParams.set('passengerOrCargo', pc);
    return fetchJson(url, fetchImpl).then(extractItems);
  }));
  if (results.every((r) => r.status === 'rejected')) throw new Error('icn failed');
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function loadItems(key, raw, fetchImpl, nowMs) {
  const hit = cache.get(raw);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.items;
  let items = await queryFlightId(key, raw, fetchImpl);
  if (!items.length) {
    const alt = normalizeFlightId(raw);
    if (alt !== raw) items = await queryFlightId(key, alt, fetchImpl);
  }
  cache.set(raw, { at: nowMs, items });
  return items;
}

export async function readIcnFlights(key, flights, { fetchImpl = fetch, now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const out = new Map();
  const jobs = [];
  const seen = new Set();
  for (const f of flights || []) {
    const raw = clean(f && f.flight);
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    jobs.push({ raw, orig: f.flight, arriveAt: f.arriveAt });
  }
  if (!key) { jobs.forEach((j) => out.set(j.orig, null)); return out; }
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const items = await loadItems(key, job.raw, fetchImpl, nowMs);
        const r = pickIcnRecord(items, job.arriveAt);
        out.set(job.orig, r ? {
          scheduledAt: parseIcnDatetime(r.scheduleDatetime),
          estimatedAt: parseIcnDatetime(r.estimatedDatetime),
          remark: r.remark || null,
          airportCode: r.airportCode || '',
          airportName: r.airport || '',
          cargo: r.passengerOrCargo === 'C',
          flightId: r.flightId || job.raw,
        } : null);
      } catch {
        out.set(job.orig, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return out;
}

export function _clearIcnCache() { cache.clear(); }
