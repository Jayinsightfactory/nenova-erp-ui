// lib/pmStages.js
// /pm 복도 = 회사 업무 파이프라인 9단계. 업무 이름·전산 화면·카톡 방/유형·현재 활동 문구를 "키워드 규칙"으로만 단계에 매핑한다.
// 이름 유사도·추정 금지 — 규칙에 안 걸리면 0(미확인). 순수 함수(파일·네트워크 없음).

export const STAGES = Object.freeze([
  { no: 1, key: 'order', label: '발주' },
  { no: 2, key: 'inbound', label: '입고' },
  { no: 3, key: 'distribute', label: '분배' },
  { no: 4, key: 'ship', label: '현장출고' },
  { no: 5, key: 'estimate', label: '견적' },
  { no: 6, key: 'deliver', label: '거래처전달' },
  { no: 7, key: 'payment', label: '입금' },
  { no: 8, key: 'remit', label: '해외송금' },
  { no: 9, key: 'profit', label: '이익' },
]);
export const UNKNOWN = 0;

// 위에서부터 먼저 걸리는 규칙이 이긴다(구체적인 것 먼저). 예: '출고 분배' → 분배, '선출고 견적서' → 견적, '입고 물량 배분' → 분배.
export const STAGE_RULES = Object.freeze([
  { stage: 9, re: /매출\s*이익|매출원가|손익|이익\s*보고|profit/i },
  { stage: 8, re: /해외\s*송금|송금|remit|wire/i },
  { stage: 7, re: /입금|채권|수금|미수|외상|receivable/i },
  { stage: 5, re: /견적|estimate|quotation/i },
  { stage: 3, re: /분배|배분|distribut/i },
  { stage: 6, re: /거래처\s*전달|명세서\s*(발송|전달)|발송|전달|deliver/i },
  { stage: 2, re: /입고|인보이스|invoice|도착원가|통관|패킹|packing|awb/i },
  { stage: 1, re: /발주|오더|주문|order/i },
  { stage: 4, re: /출고|현장|상차|피킹|picking|shipment/i },
]);

export function stageOf(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return UNKNOWN;
  for (const r of STAGE_RULES) if (r.re.test(s)) return r.stage;
  return UNKNOWN;
}

export const stageLabel = (no) => (STAGES.find((s) => s.no === no)?.label) || '미확인';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const arr = (x) => (Array.isArray(x) ? x : []);

// 한 사람 timesave 행 → 단계별 주간 시간. 근거는 업무(workflows.measuredHoursPerWeek)만 쓴다(전산·카톡 버킷과 겹쳐 이중계산되므로).
export function personStageHours(p) {
  const byStage = {}; let unknownH = 0; let totalH = 0;
  for (const w of arr(p?.workflows)) {
    const h = num(w?.measuredHoursPerWeek); if (h <= 0) continue;
    const st = stageOf(`${w.name || ''} ${w.feature?.menu || ''}`);
    totalH += h;
    if (st) byStage[st] = (byStage[st] || 0) + h; else unknownH += h;
  }
  for (const k of Object.keys(byStage)) byStage[k] = r1(byStage[k]);
  return { byStage, unknownH: r1(unknownH), totalH: r1(totalH) };
}

// 전 직원 → 복도 칸별 합계 + 담당자. people = timesave.people
export function buildCorridor(people) {
  const stages = STAGES.map((s) => ({ ...s, h: 0, people: [] }));
  const perPerson = {}; let unknownH = 0; let totalH = 0;
  for (const p of arr(people)) {
    if (!p?.name) continue;
    const ps = personStageHours(p);
    perPerson[p.name] = ps.byStage;
    unknownH += ps.unknownH; totalH += ps.totalH;
    for (const [k, h] of Object.entries(ps.byStage)) {
      const s = stages[Number(k) - 1]; s.h += h; s.people.push({ name: p.name, h });
    }
  }
  for (const s of stages) { s.h = r1(s.h); s.people.sort((a, b) => b.h - a.h); }
  return { stages, perPerson, unknownH: r1(unknownH), totalH: r1(totalH), unknownRatio: totalH > 0 ? Math.round((unknownH / totalH) * 1000) / 10 : null };
}

// 행동 → 점 방향. 명시 행동 정보만 본다(앱 이름으로 추정하지 않음).
// 'toDesk' = 읽기(단계→책상), 'toStage' = 입력·전송(책상→단계), 'none' = 정보 없음
export function flowDirection(action) {
  const s = String(action || '');
  if (!s) return 'none';
  if (/입력|전송|저장|등록|보내|send|input|type|save|write|submit/i.test(s)) return 'toStage';
  if (/열람|읽|조회|확인|read|view|open|browse/i.test(s)) return 'toDesk';
  return 'none';
}

// 직원 실시간 행 → 현재 단계 + 최근 1시간 단계(최대 3, 현재와 중복 제외). 데이터에 없으면 비움.
export function staffLinks(x, nowMs, opts = {}) {
  const maxRecent = opts.maxRecent ?? 3;
  const out = { current: null, recent: [] };
  if (!x || x.status === 'off') return out;
  const curText = x.screen || x.activity || x.workflow || '';
  const cur = stageOf(curText);
  if (cur) out.current = { stage: cur, text: curText, dir: flowDirection(x.action) };
  const seen = new Set(cur ? [cur] : []);
  const recent = arr(x.recent).slice().sort((a, b) => (Date.parse(b?.at || '') || 0) - (Date.parse(a?.at || '') || 0));
  for (const r of recent) {
    const t = Date.parse(r?.at || '');
    if (!Number.isFinite(t) || nowMs - t > 3600e3 || t > nowMs + 60e3) continue;
    const st = stageOf(r.screen || r.activity || r.text || '');
    if (!st || seen.has(st)) continue;
    seen.add(st); out.recent.push({ stage: st, text: r.screen || r.activity || r.text, dir: flowDirection(r.action), at: r.at });
    if (out.recent.length >= maxRecent) break;
  }
  return out;
}

// 선 굵기: 그 단계 시간 비례 1.5~6px (시간 정보 없으면 2)
export function lineWidth(h, maxH) {
  const v = num(h); const m = num(maxH);
  if (v <= 0 || m <= 0) return 2;
  return Math.round((1.5 + 4.5 * Math.min(1, v / m)) * 10) / 10;
}
