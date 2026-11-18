// lib/workManualsInsights.js
// 업무 매뉴얼 검색, 부서별 커버리지 집계, 원스톱/자동화 도구 바로가기 매핑,
// /operations-knowledge 주의·이슈 지침 연계, 관리자(nenovaSS3) 전용 브리핑 생성(MSSQL 무관).

import fs from 'node:fs';
import path from 'node:path';
import { featureFilePath } from './workFeatureData.js';

export const MANUAL_SHORTCUT_CATALOG = Object.freeze([
  {
    href: '/import/tools',
    label: '수입부 업무도구 · Packing List',
    kind: 'auto',
    keywords: ['packing list', '패킹리스트', '인보이스', '발주서', '수입부 업무도구', '홀렉스'],
  },
  {
    href: '/master/products',
    label: '네노바웹 품목관리',
    kind: 'one-stop',
    keywords: ['신규 품목', '품목관리', '품목코드', '/master/products', '제품 등록', '제품 수정'],
  },
  {
    href: '/incoming',
    label: '입고관리',
    kind: 'one-stop',
    keywords: ['입고 등록', '입고 관리', '입고관리', '패킹리스트 엑셀 올리기'],
  },
  {
    href: '/arrival-cost',
    label: '도착원가 원스톱',
    kind: 'auto',
    keywords: ['원가자료', '도착원가', '원가자료 생성', '도착원가 시트'],
  },
  {
    href: '/import/freight-calc',
    label: 'AWB 운임 계산기',
    kind: 'auto',
    keywords: ['awb', '운임', '운송기준원가'],
  },
  {
    href: '/import',
    label: '수입부 통합',
    kind: 'one-stop',
    keywords: ['수입부 통합', '콜롬비아 주간 발주', '네덜란드(holex) 발주', '통관 서류'],
  },
  {
    href: '/stats/china-order-download',
    label: '중국 발주 현황 다운로드',
    kind: 'auto',
    keywords: ['중국 발주', '중국 발주 현황 다운로드', '해상 · 항공'],
  },
  {
    href: '/stats/china-volume-board',
    label: '자동 중국물량표',
    kind: 'auto',
    keywords: ['중국 물류표', '중국물량표', '중국 물량표'],
  },
  {
    href: '/stats/dutch-volume-board',
    label: '네덜란드 물량표',
    kind: 'one-stop',
    keywords: ['네덜란드 물량표', 'holex 웹샵'],
  },
  {
    href: '/stats/volume-board',
    label: '물량표',
    kind: 'one-stop',
    keywords: ['물량표'],
  },
  {
    href: '/sales/defect-deductions',
    label: '영업수입불량차감',
    kind: 'one-stop',
    keywords: ['불량차감', '검역차감', '불량 클레임', '영업수입불량차감', '불량/검역'],
  },
  {
    href: '/sales/farm-quality',
    label: '농장 불량·피드백',
    kind: 'one-stop',
    keywords: ['불량 클레임', '크레딧 요청', '농장 불량'],
  },
  {
    href: '/orders/paste',
    label: '붙여넣기 주문등록',
    kind: 'auto',
    keywords: ['붙여넣기 주문등록', '카톡 주문', '주문 입력'],
  },
  {
    href: '/orders/my-customers',
    label: '내 업체 주문등록',
    kind: 'one-stop',
    keywords: ['내 업체 주문등록', '신규 주문 등록', '발주 추가'],
  },
  {
    href: '/orders/sales-paste',
    label: '영업부 붙여서 주문등록',
    kind: 'auto',
    keywords: ['영업부 붙여서 주문등록', '거래처 카톡 주문'],
  },
  {
    href: '/shipment/distribute',
    label: '출고분배',
    kind: 'one-stop',
    keywords: ['출고 분배', '출고분배'],
  },
  {
    href: '/shipment/distribute-import',
    label: '출고분배 엑셀업로드',
    kind: 'auto',
    keywords: ['출고분배 엑셀업로드'],
  },
  {
    href: '/shipment/fix-status',
    label: '차수 확정 현황',
    kind: 'one-stop',
    keywords: ['차수 확정', '확정 현황'],
  },
  {
    href: '/estimate',
    label: '견적서 관리',
    kind: 'one-stop',
    keywords: ['견적서 관리', '견적서 확인', '단가 수정'],
  },
  {
    href: '/estimate/weekday',
    label: '주광 견적서',
    kind: 'one-stop',
    keywords: ['주광농원', '주광 견적서'],
  },
  {
    href: '/sales/profit-report',
    label: '주차별 매출이익 보고서',
    kind: 'one-stop',
    keywords: ['매출이익', '통관비', '정산서 zip', '선율'],
  },
  {
    href: '/sales/registration-history',
    label: '판매등록 히스토리',
    kind: 'one-stop',
    keywords: ['판매등록', '판매현황'],
  },
  {
    href: '/ecount/reconcile',
    label: 'ECOUNT 자동대사',
    kind: 'auto',
    keywords: ['이카운트', 'ecount', '입금보고서', '미반영'],
  },
  {
    href: '/ecount/workbench',
    label: 'ECOUNT ERP 조회',
    kind: 'one-stop',
    keywords: ['이카운트', 'ecount', '거래처등록', '거래처관리대장', '세금계산서'],
  },
  {
    href: '/finance/bank',
    label: '입/출금 계좌 조회',
    kind: 'one-stop',
    keywords: ['입/출금계좌', '계좌 조회', '기업뱅킹', '송금'],
  },
  {
    href: '/stock',
    label: '재고 관리',
    kind: 'one-stop',
    keywords: ['재고 조정', '재고관리', '잔량'],
  },
  {
    href: '/shipment/statement',
    label: '출고내역서',
    kind: 'one-stop',
    keywords: ['출고내역서'],
  },
  {
    href: '/raum/pnl',
    label: '라움 초이문 손익계산서',
    kind: 'one-stop',
    keywords: ['라움', '신라호텔', '신라 입고'],
  },
  {
    href: '/stats/pivot',
    label: 'Pivot 통계',
    kind: 'one-stop',
    keywords: ['pivot', '피벗'],
  },
]);

const STATUS_KO = Object.freeze({ CHECK: '확인 필요', CURRENT: '현재 적용', RETIRED: '적용 종료' });
const CATEGORY_KO = Object.freeze({
  SITUATION: '상황별 처리',
  CASE: '과거 사례',
  SEASON: '시즌 주의',
  HANDOFF: '인수인계',
  CHECKLIST: '체크리스트',
});

const normText = (value) => String(value || '').toLowerCase().trim();

function collectTargetText(target) {
  if (!target) return '';
  if (typeof target === 'string') return normText(target);
  const parts = [
    target.title,
    target.oneLine,
    target.summary,
    target.why,
    target.when,
    target.next,
    ...(Array.isArray(target.screens) ? target.screens : []),
    ...(Array.isArray(target.tools) ? target.tools : []),
    ...(Array.isArray(target.steps) ? target.steps.flatMap((s) => [s?.title, s?.screen, s?.app]) : []),
  ];
  return normText(parts.filter(Boolean).join(' '));
}

export function resolveToolShortcuts(target, { limit = 5 } = {}) {
  const hay = collectTargetText(target);
  if (!hay) return [];
  const hits = [];
  const seen = new Set();
  for (const entry of MANUAL_SHORTCUT_CATALOG) {
    if (seen.has(entry.href)) continue;
    const score = entry.keywords.reduce((acc, kw) => (hay.includes(kw.toLowerCase()) ? acc + 1 : acc), 0);
    if (score > 0) {
      seen.add(entry.href);
      hits.push({ href: entry.href, label: entry.label, kind: entry.kind, score });
    }
  }
  hits.sort((a, b) => b.score - a.score || (a.kind === 'auto' ? -1 : 1));
  return hits.slice(0, limit).map(({ href, label, kind }) => ({ href, label, kind }));
}

export function summarizeKnowledgeItems(rawSnapshot, { limit = 60 } = {}) {
  const items = Array.isArray(rawSnapshot?.items) ? rawSnapshot.items : Array.isArray(rawSnapshot) ? rawSnapshot : [];
  return items
    .filter((item) => item && item.status !== 'RETIRED')
    .sort((a, b) => Number(b.priority === 'IMPORTANT') - Number(a.priority === 'IMPORTANT')
      || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: String(item.title || '').trim(),
      category: item.category || 'SITUATION',
      categoryLabel: CATEGORY_KO[item.category] || item.category || '지침',
      status: item.status || 'CHECK',
      statusLabel: STATUS_KO[item.status] || item.status || '확인 필요',
      priority: item.priority || 'NORMAL',
      situation: String(item.situation || '').slice(0, 220),
      action: String(item.action || '').slice(0, 220),
      caution: String(item.caution || '').slice(0, 220),
      checklist: String(item.checklist || '').slice(0, 180),
      contact: String(item.contact || '').slice(0, 100),
      reviewDate: item.reviewDate || null,
      tags: {
        countries: Array.isArray(item.tags?.countries) ? item.tags.countries : [],
        flowers: Array.isArray(item.tags?.flowers) ? item.tags.flowers : [],
        farms: Array.isArray(item.tags?.farms) ? item.tags.farms : [],
        stages: Array.isArray(item.tags?.stages) ? item.tags.stages : [],
      },
      updatedAt: item.updatedAt || null,
    }));
}

const DEPT_KEYWORDS = Object.freeze({
  import: ['수입', '인보이스', '패킹', '통관', '검역', '입고', '콜롬비아', '네덜란드', '중국', '에콰도르', '태국', '원가'],
  'sales-support': ['영업지원', '분배', '물량표', '견적', '확정', '주문', '불량', '차감'],
  sales: ['영업', '거래처', '출고', '주문', '대체', '재고'],
  management: ['경영지원', '이카운트', '세금계산서', '채권', '입금', '송금', '정산'],
});

export function matchKnowledgeForContext({ knowledgeItems = [], deptId = 'all', manual = null, query = '', limit = 4 } = {}) {
  if (!Array.isArray(knowledgeItems) || !knowledgeItems.length) return [];
  const q = normText(query);
  const deptKws = DEPT_KEYWORDS[deptId] || [];
  const manualText = manual ? collectTargetText(manual) : '';
  const scored = knowledgeItems.map((item) => {
    const tagList = [
      ...(item.tags?.countries || []),
      ...(item.tags?.flowers || []),
      ...(item.tags?.farms || []),
      ...(item.tags?.stages || []),
    ];
    const hay = normText([item.title, item.situation, item.action, item.caution, item.checklist, ...tagList].join(' '));
    let score = item.priority === 'IMPORTANT' ? 2 : 0;
    if (q && hay.includes(q)) score += 6;
    for (const kw of deptKws) if (hay.includes(kw)) score += 2;
    if (manualText) {
      for (const t of tagList) if (t && manualText.includes(normText(t))) score += 4;
      for (const word of String(manual?.title || '').split(/[\s·(),/]+/).filter((w) => w.length >= 2)) {
        if (hay.includes(normText(word))) score += 3;
      }
    }
    return { item, score };
  });
  return scored
    .filter((row) => (!q && !manual) ? row.score >= 2 || scored.length <= limit : row.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.item.priority === 'IMPORTANT') - Number(a.item.priority === 'IMPORTANT'))
    .slice(0, limit)
    .map((row) => row.item);
}

export function extractManualCautions(manual) {
  if (!manual) return [];
  const out = [];
  for (const p of manual.pitfalls || []) {
    if (p?.mistake || p?.fix) out.push({ kind: '실수 주의', title: p.mistake || '', detail: p.fix || '' });
  }
  for (const q of manual.openQuestions || []) {
    if (q) out.push({ kind: '확인 필요', title: String(q), detail: '담당자·관리자 확인이 남아 있는 항목입니다.' });
  }
  return out;
}

export function searchManualWorkspace({ handovers = [], knowledgeItems = [], drafts = [], deptFilter = 'all', query = '', limit = 24 } = {}) {
  const q = normText(query);
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const results = [];

  const matches = (...fields) => {
    if (!terms.length) return true;
    const hay = normText(fields.flat().filter(Boolean).join(' '));
    return terms.every((t) => hay.includes(t));
  };

  for (const h of handovers) {
    if (deptFilter !== 'all' && h.id !== deptFilter) continue;
    const d = h.data;
    if (!d) continue;

    for (const m of d.manuals || []) {
      const stepText = (m.steps || []).flatMap((s) => [s.title, s.look, s.input, s.why, s.screen]);
      const pitText = (m.pitfalls || []).flatMap((p) => [p.mistake, p.fix]);
      if (!matches(m.title, m.oneLine, m.why, m.when, m.screens, stepText, pitText)) continue;
      results.push({
        kind: 'manual',
        deptId: h.id,
        deptName: h.name,
        id: m.id,
        title: m.title,
        snippet: m.oneLine || m.why || '',
        status: m.status || 'estimated',
        hasVideo: !!(m.video || m.lecture),
        stepCount: (m.steps || []).length,
        pitfallCount: (m.pitfalls || []).length,
        shortcuts: resolveToolShortcuts(m, { limit: 3 }),
      });
    }

    if (terms.length) {
      for (const kindKey of ['daily', 'weekly', 'monthly']) {
        for (const row of d.schedule?.[kindKey] || []) {
          if (!matches(row.title, row.detail, row.trigger, row.screens, row.handoff)) continue;
          results.push({
            kind: 'schedule',
            deptId: h.id,
            deptName: h.name,
            id: row.manualId || row.id,
            manualId: row.manualId || null,
            title: `${row.when ? `[${row.when}] ` : ''}${row.title}`,
            snippet: row.detail || row.handoff || '',
            status: row.status || 'estimated',
            hasVideo: !!row.hasVideo,
            shortcuts: resolveToolShortcuts(row, { limit: 2 }),
          });
        }
      }

      for (const t of d.troubles || []) {
        if (!matches(t.symptom, t.first, t.tell)) continue;
        results.push({
          kind: 'trouble',
          deptId: h.id,
          deptName: h.name,
          id: t.manualId || t.symptom,
          manualId: t.manualId || null,
          title: t.symptom,
          snippet: Array.isArray(t.first) ? t.first[0] || '' : String(t.first || ''),
          status: t.status || 'estimated',
          hasVideo: false,
          shortcuts: resolveToolShortcuts({ title: t.symptom, steps: [{ title: t.tell }] }, { limit: 2 }),
        });
      }
    }
  }

  if (terms.length) {
    for (const k of knowledgeItems) {
      if (!matches(k.title, k.situation, k.action, k.caution, k.checklist, k.tags?.countries, k.tags?.flowers, k.tags?.farms, k.tags?.stages)) continue;
      results.push({
        kind: 'knowledge',
        deptId: 'knowledge',
        deptName: '업무 지침',
        id: k.id,
        title: k.title,
        snippet: k.caution || k.action || k.situation,
        status: k.status,
        priority: k.priority,
        href: `/operations-knowledge?itemId=${encodeURIComponent(k.id)}`,
        shortcuts: [],
      });
    }

    for (const dr of drafts) {
      if (deptFilter !== 'all') {
        const deptName = handovers.find((h) => h.id === deptFilter)?.name;
        if (deptName && dr.dept !== deptName) continue;
      }
      const stepTitles = (dr.steps || []).map((s) => `${s.title || ''} ${s.detail || ''} ${s.app || ''}`);
      if (!matches(dr.title, dr.summary, dr.owner, dr.tools, stepTitles)) continue;
      results.push({
        kind: 'draft',
        deptId: dr.dept,
        deptName: `${dr.dept} · ${dr.owner}`,
        id: dr.id,
        title: dr.title,
        snippet: dr.summary || '',
        status: dr.status || 'ai_draft',
        shortcuts: resolveToolShortcuts(dr, { limit: 2 }),
      });
    }
  }

  const order = { manual: 0, knowledge: 1, trouble: 2, schedule: 3, draft: 4 };
  return results
    .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9)
      || Number(b.status === 'confirmed') - Number(a.status === 'confirmed'))
    .slice(0, limit);
}

function safeReadFeatureJson(name) {
  try {
    const p = featureFilePath(name);
    if (!p || !fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function buildAdminBriefing({
  handovers = [],
  allManuals = [],
  routines = null,
  livePipelines = null,
  knowledgeItems = [],
  runtime = null,
} = {}) {
  const deptCoverage = handovers.map((h) => {
    const d = h.data;
    const manuals = d?.manuals || [];
    const confirmed = manuals.filter((m) => m.status === 'confirmed').length;
    const withVideo = manuals.filter((m) => m.video || m.lecture).length;
    const rows = [
      ...(d?.schedule?.daily || []),
      ...(d?.schedule?.weekly || []),
      ...(d?.schedule?.monthly || []),
    ];
    const linkedRows = rows.filter((r) => !!r.manualId).length;
    const ownerFollowUps = d?.ownerFollowUps?.length || 0;
    const questions = d?.questions?.length || 0;
    const weakEvidence = d?.weakEvidence?.length || 0;
    const notYet = d?.notYet?.length || 0;
    return {
      id: h.id,
      name: h.name,
      ready: !!h.ready,
      updatedAt: d?.updatedAt || null,
      manualsTotal: manuals.length,
      manualsConfirmed: confirmed,
      manualsEstimated: Math.max(0, manuals.length - confirmed),
      manualsWithVideo: withVideo,
      scheduleRows: rows.length,
      linkedRows,
      coveragePct: rows.length ? Math.round((linkedRows / rows.length) * 100) : 0,
      ownerFollowUps,
      questions,
      weakEvidence,
      notYet,
    };
  });

  const totals = deptCoverage.reduce((acc, row) => {
    acc.manualsTotal += row.manualsTotal;
    acc.manualsConfirmed += row.manualsConfirmed;
    acc.manualsWithVideo += row.manualsWithVideo;
    acc.scheduleRows += row.scheduleRows;
    acc.linkedRows += row.linkedRows;
    acc.ownerFollowUps += row.ownerFollowUps;
    acc.questions += row.questions;
    acc.weakEvidence += row.weakEvidence;
    acc.notYet += row.notYet;
    return acc;
  }, {
    manualsTotal: 0,
    manualsConfirmed: 0,
    manualsWithVideo: 0,
    scheduleRows: 0,
    linkedRows: 0,
    ownerFollowUps: 0,
    questions: 0,
    weakEvidence: 0,
    notYet: 0,
  });

  const draftStats = {
    total: allManuals.length,
    confirmed: allManuals.filter((m) => m.status === 'confirmed').length,
    edited: allManuals.filter((m) => m.status === 'edited').length,
    aiDraft: allManuals.filter((m) => !m.status || m.status === 'ai_draft').length,
  };

  let routineConfirmedCount = 0;
  let routineWrongCount = 0;
  for (const dp of routines?.departments || []) {
    for (const p of dp.people || []) {
      for (const k of ['daily', 'weekly', 'monthly', 'mail']) {
        for (const it of p[k] || []) {
          if (it.confirm?.status === 'confirmed') routineConfirmedCount++;
          else if (it.confirm?.status === 'wrong') routineWrongCount++;
        }
      }
    }
  }

  const pipelineTasks = livePipelines?.tasks || [];
  const checkKnowledge = knowledgeItems.filter((k) => k.status === 'CHECK');

  const rt = runtime || {
    selfTune: safeReadFeatureJson('self-tune-report'),
    adoption: safeReadFeatureJson('adoption-ledger'),
    pmOffice: safeReadFeatureJson('pm-office'),
  };

  const latestTune = Array.isArray(rt.selfTune?.days) && rt.selfTune.days.length
    ? rt.selfTune.days[rt.selfTune.days.length - 1]
    : null;
  const matchingWaitingCount = Array.isArray(latestTune?.matchingSuggestions) ? latestTune.matchingSuggestions.length : null;

  const gaps = [];
  for (const row of deptCoverage) {
    if (row.ownerFollowUps > 0) {
      gaps.push({
        id: `owner-followup-${row.id}`,
        priority: 'high',
        category: '사장님 재확인 대기',
        title: `${row.name} 매뉴얼 결정 질문 ${row.ownerFollowUps}건`,
        detail: `${row.name} 인수인계 업무표에서 답변이 불분명해 보류된 질문이 남아 있습니다.`,
        href: `/work/manuals?dept=${encodeURIComponent(row.id)}`,
      });
    }
    if (row.notYet > 0 || row.weakEvidence > 0) {
      gaps.push({
        id: `manual-gap-${row.id}`,
        priority: row.notYet >= 5 ? 'medium' : 'normal',
        category: '매뉴얼 보완',
        title: `${row.name} 미작성 ${row.notYet}건 · 근거 보강 ${row.weakEvidence}건`,
        detail: `전체 업무표 ${row.scheduleRows}건 중 ${row.linkedRows}건(${row.coveragePct}%)만 매뉴얼에 연결되어 있습니다.`,
        href: `/work/manuals?dept=${encodeURIComponent(row.id)}`,
      });
    }
  }

  if (checkKnowledge.length > 0) {
    gaps.push({
      id: 'knowledge-check-pending',
      priority: 'medium',
      category: '운영 지침 확인',
      title: `확인 필요(CHECK) 상태 업무 지침 ${checkKnowledge.length}건`,
      detail: '현업 확정 후 「현재 적용」으로 전환하면 전 직원 안내에 바로 반영됩니다.',
      href: '/operations-knowledge',
    });
  }

  gaps.push(
    {
      id: 'agent-report-truncation',
      priority: 'high',
      category: '일일 보고 사각지대',
      title: '일일 카톡 보고 1,800자 절단 및 상위 5건 제한으로 인한 미보고분 점검',
      detail: 'PM 대장 미결 안건·보조 저장소(mindmap-viewer) 머지 완료 건의 상태 동기화·위시리스트 채택 건을 함께 확인해야 합니다.',
      href: '/pm',
    },
    {
      id: 'agent-owner-decisions',
      priority: 'high',
      category: '에이전트 결정 대기',
      title: '화면 판독 병렬 복구 · 파일 수집 폴더 범위 · PDF/물량표 자동 검산 접근 승인',
      detail: matchingWaitingCount != null
        ? `거래처 별칭·주문매칭 제안 ${matchingWaitingCount}건과 함께 관리자 판단이 필요합니다.`
        : '거래처 별칭·주문매칭 제안(customer-mappings) 및 읽기 전용 검증 수단 승인이 필요합니다.',
      href: '/my-work?tab=radar',
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      ...totals,
      coveragePct: totals.scheduleRows ? Math.round((totals.linkedRows / totals.scheduleRows) * 100) : 0,
      drafts: draftStats,
      routines: { confirmed: routineConfirmedCount, wrong: routineWrongCount },
      livePipelines: {
        total: pipelineTasks.length,
        withCaptures: pipelineTasks.filter((t) => (t.captures || 0) > 0).length,
      },
      knowledgeActive: knowledgeItems.length,
      knowledgeCheck: checkKnowledge.length,
      matchingWaitingCount,
      selfTuneDate: latestTune?.date || null,
    },
    departments: deptCoverage,
    gaps,
  };
}
