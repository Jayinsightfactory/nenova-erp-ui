'use strict';

const SOURCE_IDS = new Set(['erp', 'mindmap-viewer', 'nenovakakao']);
const SAFE_ROOTS = new Set(['pages', 'components', 'lib', 'scripts', 'docs', 'styles', 'src', 'app', 'config', '__tests__', 'test', 'tests', '.github', 'routes', 'services', 'daemon', 'tools', 'setup', 'adapters', 'sdk', 'moyi', 'nenova-erp-ui']);
const SAFE_ROOT_FILES = new Set(['README.md', 'PROGRESS.md', 'WORK_MEMORY.md', 'AGENTS.md', 'package.json', 'package-lock.json', 'next.config.js', 'next.config.mjs', '.gitignore']);

function sanitizeText(value) {
  let text = String(value ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  text = text.replace(/([A-Z]:[\\/]|\/(?:Users|home)\/)[^\s]+/gi, '[경로 숨김]');
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[이메일 숨김]');
  text = text.replace(/\b(?:\+?82[-. ]?)?0?1[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/g, '[전화번호 숨김]');
  text = text.replace(/\b(?:Bearer\s+\S+|[A-Za-z0-9_-]*(?:secret|password|passwd|token|api[_-]?key|database[_-]?url|db[_-]?url|sql[_-]?password)[A-Za-z0-9_-]*\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+))/gi, '[비밀값 숨김]');
  text = text.replace(/\b(?:gh[pousr]_|sk-|AKIA|AIza)[A-Za-z0-9_\-]{12,}\b/g, '[비밀값 숨김]');
  text = text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[비밀값 숨김]');
  text = text.replace(/https?:\/\/\S+/gi, '[URL 숨김]');
  return text.slice(0, 300);
}

function isSafePath(value) {
  if (typeof value !== 'string' || !value || value.length > 320) return false;
  const path = value.replace(/\\/g, '/');
  if (path.startsWith('/') || path.includes('..') || /[\x00-\x1f\x7f]/.test(path) || /[<>:"|?*]/.test(path)) return false;
  const parts = path.split('/');
  if (parts.some(part => !part || part.startsWith('.') && part !== '.github' || /(?:secret|credential|password|private|token|api.?key|customer|client|upload|screenshot|capture|raw|session)/i.test(part) || /(?:\.env|\.pem|\.key|\.p12|\.pfx|\.crt|\.cer|\.sqlite|\.db|\.bak|\.log|\.zip|\.pdf|\.xlsx?|\.csv)$/i.test(part))) return false;
  if (!/\.(?:js|jsx|ts|tsx|mjs|cjs|css|scss|json|md|txt|ya?ml|html|svg|ps1|sh|sql)$/i.test(path)) return false;
  if (!/^[\p{L}\p{N}_\-./ ()@+]+$/u.test(path)) return false;
  if (parts.length === 1) return SAFE_ROOT_FILES.has(path) || /^WORK-SUMMARY-[\w-]+\.(?:txt|md)$/.test(path);
  return SAFE_ROOTS.has(parts[0]) && parts[0] !== 'nenova-erp-ui' || (parts[0] === 'nenova-erp-ui' && SAFE_ROOTS.has(parts[1]));
}

function safeIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safePaths(paths) {
  return [...new Set((Array.isArray(paths) ? paths : []).filter(isSafePath).map(path => path.replace(/\\/g, '/')))].sort();
}

function normalizeRecord(record) {
  if (!record || !/^[a-f\d]{40}$/i.test(record.hash || '')) return null;
  const date = safeIso(record.date);
  if (!date || !Array.isArray(record.parents) || record.parents.some(hash => !/^[a-f\d]{40}$/i.test(hash)) || (record.committedAt != null && !safeIso(record.committedAt))) return null;
  return {
    hash: record.hash.toLowerCase(), date,
    committedAt: safeIso(record.committedAt) || date,
    subject: sanitizeText(record.subject) || '(제목 없음)',
    parents: record.parents.map(hash => hash.toLowerCase()),
    paths: safePaths(record.paths),
    changedFileCount: Number.isSafeInteger(record.changedFileCount) && record.changedFileCount >= 0 ? record.changedFileCount : (Array.isArray(record.paths) ? record.paths.length : 0),
    redactedPathCount: Number.isSafeInteger(record.redactedPathCount) && record.redactedPathCount >= 0 ? record.redactedPathCount : (Array.isArray(record.paths) ? record.paths.filter(path => !isSafePath(path)).length : 0),
  };
}

function parseGitLog(raw) {
  if (typeof raw !== 'string' || !raw.includes('\x1e')) throw new Error('Git log delimiter missing');
  return raw.split('\x1e').filter(Boolean).map(chunk => {
    const split = chunk.indexOf('\x1d');
    if (split < 0) throw new Error('Git log header boundary missing');
    const header = chunk.slice(0, split).replace(/^[\r\n\x00]+/, '').split('\x1f');
    if (header.length !== 5) throw new Error('Malformed Git log header');
    const [hash, date, committedAt, subject, parentText] = header;
    const paths = chunk.slice(split + 1).split('\x00').map(path => path.trim()).filter(Boolean);
    const normalized = normalizeRecord({ hash, date, committedAt, subject, parents: parentText.trim() ? parentText.trim().split(/\s+/) : [], paths });
    if (!normalized) throw new Error('Malformed Git log record');
    return normalized;
  });
}

function menuHrefsFor(paths, menus) {
  const matchPaths = paths.map(path => path.replace(/^nenova-erp-ui\//, '')).flatMap(path => {
    if (!/^(?:src\/)?app\//.test(path)) return [path];
    const routePath = path.replace(/^(?:src\/)?app\//, '').split('/').filter(segment => !/^\([^)]*\)$/.test(segment)).join('/');
    return [path, `app/${routePath}`];
  });
  const hrefs = [];
  for (const menu of Array.isArray(menus) ? menus : []) {
    const route = String(menu.route || menu.href || '').split('?')[0].replace(/^\/+|\/+$/g, '');
    if (!route) continue;
    const routeFiles = new Set(['js', 'jsx', 'ts', 'tsx'].flatMap(ext => [`pages/${route}.${ext}`, `app/${route}/page.${ext}`]));
    if (matchPaths.some(path => routeFiles.has(path) || path.startsWith(`pages/${route}/`))) hrefs.push(menu.href);
  }
  return [...new Set(hrefs)];
}

function projectsFor(record, sourceId) {
  if (sourceId === 'erp') return ['nenova-erp'];
  if (sourceId === 'nenovakakao') return ['nenova-kakao'];
  const projects = ['mindmap-orbit'];
  if (record.paths.some(path => path.startsWith('nenova-erp-ui/'))) projects.push('nenova-erp');
  return projects;
}

function classify(record) {
  if (record.parents.length === 0) return { workType: 'initial', typeEvidence: 'verified-root' };
  const subject = record.subject.toLowerCase();
  for (const [type, pattern] of [
    ['research', /^(research|investigate|audit|probe):/], ['plan', /^(plan|prd):/],
    ['fix', /^(fix|hotfix|revert):/], ['feature', /^(feat|add|implement):/],
    ['test-guard', /^(test):/], ['ops-refactor', /^(refactor|build|ci|chore):/],
  ]) if (pattern.test(subject)) return { workType: type, typeEvidence: 'subject-prefix' };
  return { workType: 'other', typeEvidence: 'unclassified' };
}

function buildSnapshot({ current, currentSummaries = [], external, menus = [], headHash = null, ref = 'HEAD', generatedAt = new Date().toISOString() }) {
  const externalSources = Array.isArray(external?.sources) ? external.sources : [];
  const sourcesInput = [
    { id: 'erp', label: 'Nenova ERP', repo: 'nenova-erp-ui', ref, headHash, collectedAt: generatedAt, records: current, summaries: currentSummaries },
    ...externalSources,
  ];
  const sources = [];
  const byHash = new Map();
  const summaries = [];
  for (const input of sourcesInput) {
    if (!SOURCE_IDS.has(input.id) || sources.some(source => source.id === input.id)) throw new Error('Unexpected or duplicate history source');
    if (!Array.isArray(input.records)) throw new Error(`History records missing: ${input.id}`);
    const records = input.records.map(normalizeRecord);
    if (records.some(record => !record)) throw new Error(`Invalid history record: ${input.id}`);
    const unique = new Map(records.map(record => [record.hash, record]));
    const sourceSummaries = (Array.isArray(input.summaries) ? input.summaries : []).filter(summary => summary && safeIso(summary.date) && (isSafePath(summary.path) || summary.path === 'docs/work-sessions')).map(summary => ({
      id: `${input.id}:${sanitizeText(summary.id || summary.path)}`, sourceId: input.id,
      date: safeIso(summary.date), title: sanitizeText(summary.title) || sanitizeText(summary.path), titleKnown: summary.titleKnown !== false, path: summary.path.replace(/\\/g, '/'), projectIds: projectsFor({ paths: [] }, input.id),
      kind: 'summary',
    }));
    summaries.push(...sourceSummaries);
    const values = [...unique.values()];
    sources.push({ id: input.id, label: sanitizeText(input.label), repo: sanitizeText(input.repo), ref: sanitizeText(input.ref), headHash: /^[a-f\d]{40}$/i.test(input.headHash || '') ? input.headHash.toLowerCase() : null, sourceStatus: input.id === 'erp' ? 'build-git' : 'tracked-manifest', stage: input.id === 'erp' ? 'build-head' : 'verified-main', stale: input.id === 'erp' ? false : null, rootHashes: values.filter(record => record.parents.length === 0).map(record => record.hash),
      collectedAt: safeIso(input.collectedAt), totalCommits: values.length, nonMergeCount: values.filter(record => record.parents.length <= 1).length, mergeCount: values.filter(record => record.parents.length > 1).length, summaryCount: sourceSummaries.length, knownSummaryTitles: sourceSummaries.filter(summary => summary.titleKnown).length, unknownSummaryTitles: sourceSummaries.filter(summary => !summary.titleKnown).length,
      firstDate: values.reduce((min, record) => !min || record.date < min ? record.date : min, null), lastDate: values.reduce((max, record) => !max || record.date > max ? record.date : max, null),
    });
    for (const record of values) {
      const prior = byHash.get(record.hash);
      if (prior) {
        prior.sourceIds.push(input.id);
        prior.paths = [...new Set([...prior.paths, ...record.paths])].sort();
        prior.projectIds = [...new Set([...prior.projectIds, ...projectsFor(record, input.id)])];
        prior.menuHrefs = menuHrefsFor(prior.paths, menus);
      } else byHash.set(record.hash, { ...record, id: record.hash, kind: 'commit', sourceIds: [input.id], projectIds: projectsFor(record, input.id), menuHrefs: menuHrefsFor(record.paths, menus), ...classify(record) });
    }
  }
  const records = [...byHash.values()].sort((a, b) => b.committedAt.localeCompare(a.committedAt) || a.hash.localeCompare(b.hash));
  summaries.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { schemaVersion: 2, generatedAt: safeIso(generatedAt), coverage: { stage: 'verified-refs', definition: 'External source main refs and ERP build HEAD; a non-master ERP build HEAD may include its branch commits.', excluded: ['other-unmerged-refs', 'working-tree', 'private-conversation-body'] }, sources, projects: [
    { id: 'mindmap-orbit', label: 'MindMap · Orbit' }, { id: 'nenova-kakao', label: 'Nenova Kakao' }, { id: 'nenova-erp', label: 'Nenova ERP' },
    { id: 'nenovaweb', label: 'Nenovaweb', status: 'Git 원장 미확인', count: null },
  ], records, summaries,
    counts: { uniqueCommits: records.length, nonMerge: records.filter(record => record.parents.length <= 1).length, merge: records.filter(record => record.parents.length > 1).length, summaries: summaries.length, knownSummaryTitles: summaries.filter(summary => summary.titleKnown).length, unknownSummaryTitles: summaries.filter(summary => !summary.titleKnown).length },
    coverageNote: '외부 저장소는 기록된 main, ERP는 이 빌드의 HEAD에서 도달 가능한 커밋을 수집했습니다. ERP 빌드 HEAD가 기본 브랜치가 아니면 해당 브랜치 커밋이 포함될 수 있습니다. 병합 커밋과 업무 요약은 따로 집계하며 개인별 작업 횟수를 뜻하지 않습니다.',
  };
}

function positiveInt(value, fallback, max) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

const KST_DAY_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

function kstDay(value) {
  const parts = KST_DAY_FORMAT.formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type)?.value || '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function querySnapshot(snapshot, query = {}) {
  const q = String(query.q || '').trim().slice(0, 500).toLocaleLowerCase();
  const source = SOURCE_IDS.has(query.source) ? query.source : 'all';
  const project = ['mindmap-orbit', 'nenova-kakao', 'nenova-erp'].includes(query.project) ? query.project : 'all';
  const type = ['nonmerge', 'merge', 'summary'].includes(query.type) ? query.type : 'all';
  const workType = ['initial', 'research', 'plan', 'fix', 'feature', 'test-guard', 'ops-refactor', 'other'].includes(query.workType) ? query.workType : 'all';
  const order = query.order === 'oldest' ? 'oldest' : 'newest';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : null;
  const requestedPage = positiveInt(query.page, 1, 1000000);
  const limit = positiveInt(query.limit, 50, 100);
  const dateMatches = record => (!from || kstDay(record.committedAt || record.date) >= from) && (!to || kstDay(record.committedAt || record.date) <= to);
  const commits = snapshot.records.filter(record => (source === 'all' || record.sourceIds.includes(source)) && (project === 'all' || record.projectIds.includes(project)) && (workType === 'all' || record.workType === workType) && (!query.menu || record.menuHrefs.includes(query.menu)) && dateMatches(record) && (type === 'all' || type === 'nonmerge' && record.parents.length <= 1 || type === 'merge' && record.parents.length > 1) && (!q || `${record.subject} ${record.date} ${record.paths.join(' ')} ${record.hash}`.toLocaleLowerCase().includes(q)));
  const summaries = (type === 'all' || type === 'summary') && workType === 'all' ? snapshot.summaries.filter(summary => (source === 'all' || summary.sourceId === source) && (project === 'all' || summary.projectIds.includes(project)) && !query.menu && dateMatches(summary) && (!q || `${summary.title} ${summary.date} ${summary.path}`.toLocaleLowerCase().includes(q))) : [];
  const timeline = [...commits, ...summaries].sort((a, b) => (order === 'oldest' ? 1 : -1) * (a.committedAt || a.date).localeCompare(b.committedAt || b.date) || a.id.localeCompare(b.id));
  const totalPages = Math.max(1, Math.ceil(timeline.length / limit));
  const page = Math.min(requestedPage, totalPages);
  return { success: true, schemaVersion: snapshot.schemaVersion, generatedAt: snapshot.generatedAt, coverage: snapshot.coverage, sources: snapshot.sources, projects: snapshot.projects, counts: snapshot.counts, coverageNote: snapshot.coverageNote,
    source, project, type, workType, order, page, limit, totalEvents: timeline.length, filteredCounts: { commits: commits.length, nonMerge: commits.filter(record => record.parents.length <= 1).length, merge: commits.filter(record => record.parents.length > 1).length, summaries: summaries.length }, totalPages, timeline: timeline.slice((page - 1) * limit, page * limit) };
}

function validateSourceGraph(source) {
  if (!Array.isArray(source.records) || !source.records.length) throw new Error('Empty source graph');
  const byHash = new Map(source.records.map(record => [record.hash, record]));
  if (byHash.size !== source.records.length || byHash.size !== source.reachableCount || !byHash.has(source.headHash)) throw new Error('Source graph count/head mismatch');
  for (const record of source.records) {
    if (!Array.isArray(record.parents) || record.parents.some(parent => !byHash.has(parent))) throw new Error('Source graph parent missing');
  }
  const visited = new Set();
  const pending = [source.headHash];
  while (pending.length) {
    const hash = pending.pop();
    if (visited.has(hash)) continue;
    visited.add(hash);
    pending.push(...byHash.get(hash).parents);
  }
  if (visited.size !== source.records.length) throw new Error('Source graph contains unreachable records');
  return true;
}

module.exports = { sanitizeText, isSafePath, normalizeRecord, parseGitLog, buildSnapshot, querySnapshot, menuHrefsFor, validateSourceGraph };
