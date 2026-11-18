// __tests__/workManualsUpgrade.test.js — /work/manuals 업그레이드 검증:
//   원스톱 도구 매핑↔Layout MENU_ITEMS 일치, 통합 검색·부서 필터, /operations-knowledge 지침 연계,
//   관리자(nenovaSS3) 전용 브리핑 비노출 차단, 금지어(감시·추적·모니터링·역추적·절감시간) 부재,
//   색 토큰·h5 금지·데스크톱 메뉴 동기화 검증(MSSQL 불필요).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

const repo = process.cwd();

const moduleCache = new Map();

function resolveLocal(fromDir, id) {
  const candidates = [id, `${id}.js`, `${id}.cjs`, `${id}.mjs`];
  for (const c of candidates) {
    const abs = path.resolve(fromDir, c);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

function loadEsm(relPath, mocks = {}) {
  const filename = path.resolve(repo, relPath);
  const key = `${filename}::${Object.keys(mocks).sort().join(',')}`;
  if (moduleCache.has(key)) return moduleCache.get(key);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = transformSync(source, {
    filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022' },
    module: { type: 'commonjs' },
  }).code;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (id) => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    if (id.startsWith('.')) {
      const targetAbs = resolveLocal(path.dirname(filename), id);
      if (targetAbs) {
        const targetRel = path.relative(repo, targetAbs).replace(/\\/g, '/');
        if (Object.prototype.hasOwnProperty.call(mocks, targetRel)) return mocks[targetRel];
        if (targetAbs.endsWith('.js')) return loadEsm(targetRel, mocks);
        return require(targetAbs);
      }
    }
    return require(id);
  };
  mod._compile(compiled, filename);
  moduleCache.set(key, mod.exports);
  return mod.exports;
}

(async () => {
  const insights = loadEsm('lib/workManualsInsights.js');
  const layoutSource = fs.readFileSync(path.join(repo, 'components/Layout.js'), 'utf8');
  const menuRoutes = new Set([...layoutSource.matchAll(/href:\s*['"]([^'"]+)['"]/g)].map((m) => m[1].split('?')[0]));

  // 1) 원스톱/자동화 도구 카탈로그의 모든 경로가 Layout.js 메뉴에 실재해야 함
  for (const sc of insights.MANUAL_SHORTCUT_CATALOG) {
    assert.ok(menuRoutes.has(sc.href), `존재하지 않는 메뉴 경로: ${sc.href}`);
  }
  const desktopMenu = JSON.parse(fs.readFileSync(path.join(repo, 'desktop/menu.json'), 'utf8'));
  const desktopHrefs = new Set(desktopMenu.flatMap((g) => g.items || []).map((i) => i.href));
  assert.ok(desktopHrefs.has('/work/manuals') && desktopHrefs.has('/operations-knowledge'), '데스크톱 메뉴 연결 확인');

  // 2) 도구 바로가기 매핑 테스트
  const packingShortcuts = insights.resolveToolShortcuts({
    title: '패킹리스트 만들기(인보이스 → 입고용 엑셀)',
    screens: ['네노바웹 수입부 업무도구 › Packing List'],
  });
  assert.ok(packingShortcuts.some((s) => s.href === '/import/tools'), '패킹리스트는 /import/tools 바로가기 포함');

  const ecountShortcuts = insights.resolveToolShortcuts({
    title: '이카운트 입/출금계좌 미반영 대사',
    screens: ['이카운트 › 입금보고서', '기업뱅킹'],
  });
  assert.ok(ecountShortcuts.some((s) => s.href === '/ecount/reconcile') && ecountShortcuts.some((s) => s.href === '/finance/bank'));

  // 3) 주의·이슈 지침(/operations-knowledge) 요약 및 연계 테스트
  const knowledgeSummary = insights.summarizeKnowledgeItems({
    items: [
      { id: 'k1', title: '콜롬비아 장미 검역 주의', category: 'SEASON', status: 'CURRENT', priority: 'IMPORTANT', situation: '통관 지연', action: '선율 방 확인', caution: '품목 누락 주의', checklist: 'AWB 확인', contact: '수입부', reviewDate: null, tags: { countries: ['콜롬비아'], flowers: ['장미'], farms: [], stages: ['통관'] }, updatedAt: '2026-11-10T00:00:00Z' },
      { id: 'k2', title: '구버전 절차', category: 'CASE', status: 'RETIRED', priority: 'NORMAL', situation: '종료', action: '', caution: '', checklist: '', contact: '', reviewDate: null, tags: { countries: [], flowers: [], farms: [], stages: [] }, updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'k3', title: '세금계산서 발행 마감 확인', category: 'CHECKLIST', status: 'CHECK', priority: 'NORMAL', situation: '월말 발행', action: '스마트빌 확인', caution: '중복 발행 금지', checklist: '', contact: '경영지원', reviewDate: null, tags: { countries: [], flowers: [], farms: [], stages: ['정산'] }, updatedAt: '2026-11-15T00:00:00Z' },
    ],
  });
  assert.equal(knowledgeSummary.length, 2, 'RETIRED 지침은 제외해야 함');
  assert.equal(knowledgeSummary[0].id, 'k1', 'IMPORTANT 우선 정렬');

  const matchedK = insights.matchKnowledgeForContext({
    knowledgeItems: knowledgeSummary,
    deptId: 'import',
    manual: { title: '통관 서류 전달 · 도착 일정 공지', screens: ['메일', '선율 방'] },
  });
  assert.equal(matchedK[0].id, 'k1', '통관/수입부 매뉴얼과 지침이 연계되어야 함');

  // 4) 실제 4개 부서 데이터 통합 검색 테스트
  const ih = loadEsm('lib/importHandover.js');
  const handovers = ih.HANDOVER_DEPTS.map((d) => ({ id: d.id, name: d.name, ready: true, data: ih.handoverForView(d.id) }));
  const searchAll = insights.searchManualWorkspace({ handovers, knowledgeItems: knowledgeSummary, deptFilter: 'all', query: '패킹리스트' });
  assert.ok(searchAll.length > 0 && searchAll.some((r) => r.deptId === 'import'), '전체 검색에서 수입부 패킹리스트 검색');
  const searchMgmt = insights.searchManualWorkspace({ handovers, knowledgeItems: knowledgeSummary, deptFilter: 'management', query: '세금계산서' });
  assert.ok(searchMgmt.length > 0 && searchMgmt.every((r) => r.deptId === 'management' || r.deptId === 'knowledge'));

  // 5) 관리자 브리핑 커버리지 계산 및 권한 분리(API handler) 테스트
  const apiMod = loadEsm('pages/api/work/manuals.js', {
    '../../../lib/auth': { withAuth: (fn) => fn },
    'lib/auth.js': { withAuth: (fn) => fn },
    '../../../lib/operationsKnowledgeStore': {
      readKnowledge: async () => ({
        items: [
          { id: 'k1', title: '지침1', category: 'SITUATION', status: 'CHECK', priority: 'IMPORTANT', situation: 's', action: 'a', caution: 'c', checklist: '', contact: '', reviewDate: null, tags: { countries: [], flowers: [], farms: [], stages: [] }, updatedAt: '2026-11-18T00:00:00Z' },
        ],
      }),
    },
    'lib/operationsKnowledgeStore.js': {
      readKnowledge: async () => ({
        items: [
          { id: 'k1', title: '지침1', category: 'SITUATION', status: 'CHECK', priority: 'IMPORTANT', situation: 's', action: 'a', caution: 'c', checklist: '', contact: '', reviewDate: null, tags: { countries: [], flowers: [], farms: [], stages: [] }, updatedAt: '2026-11-18T00:00:00Z' },
        ],
      }),
    },
  });

  const staffPayload = await apiMod.buildWorkManualsPayload({ userId: 'sales01', userName: '박성수', deptName: '영업부' });
  assert.equal(staffPayload.isAdmin, false, '일반 직원은 비관리자');
  assert.equal(staffPayload.adminBriefing, undefined, '비관리자에게는 adminBriefing 을 내려주지 않아야 함');
  assert.ok(Array.isArray(staffPayload.knowledge) && staffPayload.knowledge.length === 1, '활성 지침 요약 포함');

  const adminPayload = await apiMod.buildWorkManualsPayload({ userId: 'nenovaSS3', userName: '관리자' });
  assert.equal(adminPayload.isAdmin, true, 'nenovaSS3 는 관리자');
  assert.ok(adminPayload.adminBriefing && adminPayload.adminBriefing.departments.length === 4, '관리자 브리핑 4개 부서 커버리지 포함');
  assert.ok(adminPayload.adminBriefing.totals.manualsTotal >= 30, '4개 부서 전체 매뉴얼 합계 계산');
  assert.ok(adminPayload.adminBriefing.gaps.some((g) => g.id === 'knowledge-check-pending'), 'CHECK 지침 확인 필요 브리핑 포함');

  // 6) 작업자 노출 화면/컴포넌트 금지어 및 UI 토큰 규칙 검사
  const banned = new RegExp([
    '\uac10\uc2dc',
    '\ucd94\uc801',
    '\ubaa8\ub2c8\ud130\ub9c1',
    '\uc5ed\ucd94\uc801',
    '\uc808\uac10\uc2dc\uac04',
  ].join('|'));

  for (const rel of [
    'pages/work/manuals.js',
    'pages/api/work/manuals.js',
    'lib/workManualsInsights.js',
    'components/manuals/ManualSearchBar.js',
    'components/manuals/ManualAdminBriefing.js',
    'components/manuals/ImportHandover.js',
  ]) {
    const src = fs.readFileSync(path.join(repo, rel), 'utf8');
    assert.ok(!banned.test(src), `${rel}: 금지어 포함 금지`);
  }

  for (const rel of ['components/manuals/ManualSearchBar.js', 'components/manuals/ManualAdminBriefing.js', 'components/manuals/ImportHandover.js']) {
    const src = fs.readFileSync(path.join(repo, rel), 'utf8');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/&#?\w+;/g, '')), `${rel}: hex 색 금지`);
    assert.ok(!/rgba?\(/.test(src), `${rel}: rgba() 금지`);
    assert.ok(!/<h5/.test(src), `${rel}: h5 단계 건너뛰기 금지`);
  }

  const pageSrc = fs.readFileSync(path.join(repo, 'pages/work/manuals.js'), 'utf8');
  assert.ok(pageSrc.includes('data.isAdmin && data.adminBriefing'), '관리자 브리핑은 isAdmin 조건으로만 렌더링');

  console.log('workManualsUpgrade tests passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
