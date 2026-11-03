// lib/pmWorkLog.js
// /pm 작업 로그(workLog) + 부서간 넘김 사슬(사장님 정의). 순수 함수(파일·네트워크 없음).
// workLog 행: { at, name, dept, label, stage, country, screen } — 피드가 사람별 라벨이 바뀔 때만 한 줄 쌓음(최신순).
// 넘김은 "추정"이다: 같은 국가 + 앞 부서 작업 뒤 N시간 안에 다음 부서 작업이 나온 것만 묶는다(확정 아님).

export const DEFAULT_WINDOW_H = 6;

// 사슬 노드: dept + stages(피드 stage 문자열) 로 workLog 행을 노드에 매칭. external = PC 데이터 없는 외부 노드.
// stageNo = 복도 9단계 번호(lib/pmStages STAGES) — 화면에서 복도 칸과 같은 색·번호로 대응.
export const HANDOFF_CHAINS = Object.freeze([
  {
    key: 'order', label: '발주 사슬',
    nodes: [
      { key: 'sales-order', stageNo: 1, dept: '영업부', title: '영업부', desc: '업체 주문품목', stages: ['발주'] },
      { key: 'import-order', stageNo: 1, dept: '수입부', title: '수입부', desc: '영업 요청 주문 발주', stages: ['발주'] },
      { key: 'inbound', stageNo: 2, dept: '수입부', title: '입고', desc: '입고 처리', stages: ['입고'] },
    ],
  },
  {
    key: 'ship', label: '출고 사슬',
    nodes: [
      { key: 'sales-ship', stageNo: 4, dept: '영업부', title: '영업부', desc: '출고 수정', stages: ['현장출고', '출고'] },
      { key: 'support', stageNo: 3, dept: '영업지원', title: '영업지원', desc: '재고관리 + 분배관리(견적서 수정)', stages: ['분배', '견적서', '견적', '재고'] },
      { key: 'field-send', stageNo: 6, dept: '영업지원', title: '현장팀 전송', desc: '현장팀으로 넘김', stages: ['거래처전달', '전달', '현장전송'] },
      { key: 'field', stageNo: 4, dept: '현장팀', title: '현장팀', desc: '분류·배송', stages: [], external: true },
    ],
  },
]);

const arr = (x) => (Array.isArray(x) ? x : []);
const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };

export function kstHM(iso) {
  const t = ms(iso); if (t == null) return '--:--';
  return new Date(t + 9 * 3600e3).toISOString().slice(11, 16);
}
export function kstDay(iso) {
  const t = ms(iso); if (t == null) return '';
  return new Date(t + 9 * 3600e3).toISOString().slice(5, 10);
}

// 국가는 피드 원문 그대로 비교(정규화로 다른 국가를 같게 만들지 않음). 공백만 정리.
export const normCountry = (c) => String(c == null ? '' : c).trim();

// 시간순(오래된 것 먼저) 정렬 + 잘못된 행 제거
export function sortLog(workLog) {
  return arr(workLog).filter((r) => r && r.name && ms(r.at) != null).slice().sort((a, b) => ms(a.at) - ms(b.at));
}

export function logFacets(workLog) {
  const f = { dept: new Set(), country: new Set(), stage: new Set() };
  for (const r of arr(workLog)) { if (r?.dept) f.dept.add(r.dept); const c = normCountry(r?.country); if (c) f.country.add(c); if (r?.stage) f.stage.add(r.stage); }
  return { dept: [...f.dept], country: [...f.country].sort(), stage: [...f.stage] };
}

// filters: { dept, country, stage, name } — 빈 값은 무시
export function filterLog(workLog, filters = {}) {
  return arr(workLog).filter((r) => r
    && (!filters.dept || r.dept === filters.dept)
    && (!filters.country || normCountry(r.country) === filters.country)
    && (!filters.stage || r.stage === filters.stage)
    && (!filters.name || r.name === filters.name));
}

export function nodeMatches(node, row) {
  if (!node || node.external || !row) return false;
  return row.dept === node.dept && node.stages.includes(String(row.stage || '').trim());
}

// 넘김 추정. 다음 노드 행 b 마다, 같은 국가의 앞 노드 행 a 중 b 이전 windowH 시간 안에서 가장 가까운 것 1개.
// 같은 사람은 넘김 아님. 국가 없는 행은 묶지 않음(근거 부족).
export function buildHandoffs(workLog, opts = {}) {
  const windowMs = (Number.isFinite(opts.windowH) ? opts.windowH : DEFAULT_WINDOW_H) * 3600e3;
  const chains = opts.chains || HANDOFF_CHAINS;
  const rows = sortLog(workLog);
  const out = [];
  for (const ch of chains) {
    for (let i = 0; i + 1 < ch.nodes.length; i++) {
      const A = ch.nodes[i]; const B = ch.nodes[i + 1];
      if (B.external) continue;
      const as = rows.filter((r) => nodeMatches(A, r) && normCountry(r.country));
      for (const b of rows) {
        if (!nodeMatches(B, b)) continue;
        const c = normCountry(b.country); if (!c) continue;
        const tb = ms(b.at);
        let best = null;
        for (const a of as) {
          if (a.name === b.name || normCountry(a.country) !== c) continue;
          const ta = ms(a.at); const gap = tb - ta;
          if (gap <= 0 || gap > windowMs) continue;
          if (!best || ta > ms(best.at)) best = a;
        }
        if (!best) continue;
        const gapMin = Math.round((tb - ms(best.at)) / 60000);
        const sameStage = String(best.stage) === String(b.stage);
        out.push({
          chain: ch.key, from: A.key, to: B.key, country: c, gapMin, sameStage,
          a: { at: best.at, name: best.name, dept: best.dept, stage: best.stage, label: best.label },
          b: { at: b.at, name: b.name, dept: b.dept, stage: b.stage, label: b.label },
          basis: `추정 · 같은 국가(${c}) · 시간차 ${fmtGap(gapMin)}${sameStage ? ` · 같은 단계(${b.stage})` : ''} · 기준 ${windowMs / 3600e3}시간 이내 · 확정 아님`,
        });
      }
    }
  }
  return out.sort((x, y) => ms(y.b.at) - ms(x.b.at));
}

export function fmtGap(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60); const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// 사슬별 노드 활동 수 + 링크별 넘김 묶음 (화면용)
export function chainView(workLog, handoffs) {
  const rows = arr(workLog);
  return HANDOFF_CHAINS.map((ch) => ({
    ...ch,
    nodes: ch.nodes.map((n) => ({ ...n, count: n.external ? null : rows.filter((r) => nodeMatches(n, r)).length })),
    links: ch.nodes.slice(0, -1).map((n, i) => {
      const to = ch.nodes[i + 1];
      return { from: n.key, to: to.key, external: !!to.external, items: arr(handoffs).filter((h) => h.chain === ch.key && h.from === n.key && h.to === to.key) };
    }),
  }));
}
