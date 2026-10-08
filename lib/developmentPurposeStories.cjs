'use strict';

const { sanitizeText } = require('./fullDevelopmentHistory.cjs');
const { kstDate } = require('./developmentJourney.cjs');

const CONFIDENCE = new Set(['verified', 'supported', 'partial']);
const EVIDENCE_KINDS = new Set(['document', 'commit']);
const GENERIC_TERMS = new Set([
  'add', 'added', 'build', 'change', 'changed', 'chore', 'feat', 'feature', 'fix', 'fixed',
  'improve', 'improved', 'refactor', 'test', 'update', 'updated',
  '개선', '기능', '변경', '보완', '수정', '작업', '추가',
]);
const BROAD_PREFIXES = new Set([
  '.github/', '__tests__/', 'adapters/', 'app/', 'components/', 'config/', 'daemon/', 'docs/',
  'lib/', 'moyi/', 'nenova-erp-ui/', 'pages/', 'routes/', 'scripts/', 'services/', 'setup/',
  'src/', 'styles/', 'test/', 'tests/', 'tools/',
]);
const HASH_PATTERN = /^[a-f\d]{40}$/i;
const STORY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const time = record => record.committedAt || record.date;
const compare = (a, b) => Date.parse(time(a)) - Date.parse(time(b)) || recordKey(a).localeCompare(recordKey(b));

function recordKey(record) {
  return record.kind === 'summary' ? `summary:${record.id}` : `commit:${record.hash || record.id}`;
}

function unique(values) {
  return [...new Set(values)];
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid story ${label}`);
  const safe = sanitizeText(value);
  if (!safe) throw new Error(`Invalid story ${label}`);
  return safe;
}

function stringList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Invalid story ${label}`);
  }
  return unique(value.map(item => item.trim()));
}

function safeEvidenceRef(value) {
  if (typeof value !== 'string' || !value || value.length > 320 || value.includes('\\')) return false;
  if (value.startsWith('/') || value.includes('..') || /[\x00-\x1f\x7f<>:"|?*]/.test(value)) return false;
  if (!/^[\p{L}\p{N}_\-./ ()@+]+$/u.test(value)) return false;
  if (/(?:^|\/)(?:\.env[^/]*|[^/]*(?:secret|credential|password|private[_-]?key|api[_-]?key)[^/]*)$/i.test(value)) return false;
  return /\.(?:c?js|mjs|jsx|json|md|ts|tsx|css|scss|ya?ml|ps1|sh|sql)$/i.test(value);
}

function normalizePrefix(value) {
  const prefix = value.replace(/^\.\//, '').replace(/^nenova-erp-ui\//, '');
  if (!prefix || prefix.includes('..') || prefix.includes('\\') || prefix.startsWith('/') || /[\x00-\x1f\x7f<>:"|?*]/.test(prefix)) {
    return null;
  }
  return prefix;
}

function evidenceHashes(story) {
  return unique([
    ...(story.changes || []).flatMap(change => change.evidenceHashes || []),
    ...(story.purposeEvidence || []).filter(item => item.kind === 'commit').map(item => item.ref),
  ].map(hash => String(hash).toLowerCase()));
}

function summaryKey(item) {
  return JSON.stringify([item.sourceId, Date.parse(item.date), item.title]);
}

function summaryEvidence(story) {
  return [...(story.summaryEvidence || []), ...(story.changes || []).flatMap(change => change.evidenceSummaries || [])];
}

function validateAndNormalizeCatalog(snapshot, catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.stories)) {
    throw new Error('Unsupported development purpose story schema');
  }
  if (!['string', 'number'].includes(typeof catalog.catalogVersion) || !String(catalog.catalogVersion).trim()) {
    throw new Error('Invalid development purpose catalog version');
  }

  const allowedSources = new Set((snapshot.sources || []).map(source => source.id));
  const commitByHash = new Map((snapshot.records || []).map(record => [record.hash, record]));
  const seenStoryIds = new Set();
  const exactOwners = new Map();
  const summaryOwners = new Map();
  const knownSummaries = new Map();
  for (const item of snapshot.summaries || []) {
    if (item.titleKnown === false) continue;
    const key = summaryKey(item);
    knownSummaries.set(key, [...(knownSummaries.get(key) || []), item]);
  }
  function normalizeSummaries(items, storyId) {
    if (items == null) return [];
    if (!Array.isArray(items)) throw new Error(`Invalid summary evidence: ${storyId}`);
    const seen = new Set();
    return items.map(item => {
      if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['sourceId', 'date', 'title'].includes(key)) || !allowedSources.has(item.sourceId) || typeof item.date !== 'string' || !Number.isFinite(Date.parse(item.date)) || typeof item.title !== 'string' || !item.title.trim()) throw new Error(`Invalid summary evidence: ${storyId}`);
      const key = summaryKey(item);
      if (knownSummaries.get(key)?.length !== 1) throw new Error(`Summary evidence missing or ambiguous: ${storyId}`);
      if (seen.has(key)) throw new Error(`Duplicate summary evidence: ${storyId}`);
      seen.add(key);
      return { sourceId: item.sourceId, date: item.date, title: item.title };
    });
  }

  const stories = catalog.stories.map(rawStory => {
    if (!rawStory || !STORY_ID_PATTERN.test(rawStory.id || '') || rawStory.id === 'review-pending' || seenStoryIds.has(rawStory.id)) {
      throw new Error('Invalid story identity');
    }
    seenStoryIds.add(rawStory.id);
    if (!CONFIDENCE.has(rawStory.confidence)) throw new Error(`Invalid story confidence: ${rawStory.id}`);

    if (!Array.isArray(rawStory.purposeEvidence) || rawStory.purposeEvidence.length === 0) {
      throw new Error(`Story purpose evidence missing: ${rawStory.id}`);
    }
    const purposeEvidence = rawStory.purposeEvidence.map(item => {
      if (!item || !EVIDENCE_KINDS.has(item.kind)) throw new Error(`Invalid purpose evidence kind: ${rawStory.id}`);
      const summary = text(item.summary, `purpose evidence summary: ${rawStory.id}`);
      if (item.kind === 'commit') {
        const ref = String(item.ref || '').toLowerCase();
        if (!HASH_PATTERN.test(ref) || !commitByHash.has(ref)) throw new Error(`Story evidence missing: ${rawStory.id}`);
        return { kind: item.kind, ref, summary };
      }
      if (!safeEvidenceRef(item.ref)) throw new Error(`Unsafe story evidence ref: ${rawStory.id}`);
      return { kind: item.kind, ref: item.ref, summary };
    });

    if (!Array.isArray(rawStory.changes) || rawStory.changes.length === 0) {
      throw new Error(`Story changes missing: ${rawStory.id}`);
    }
    const changes = rawStory.changes.map(change => {
      if (!change) throw new Error(`Invalid story change: ${rawStory.id}`);
      const hashes = stringList(change.evidenceHashes, `change evidence hashes: ${rawStory.id}`).map(hash => hash.toLowerCase());
      const evidenceRefs = stringList(change.evidenceRefs, `change evidence refs: ${rawStory.id}`);
      const evidenceSummaries = normalizeSummaries(change.evidenceSummaries, rawStory.id);
      if (!hashes.length && !evidenceRefs.length && !evidenceSummaries.length) throw new Error(`Story change evidence missing: ${rawStory.id}`);
      if (hashes.some(hash => !HASH_PATTERN.test(hash) || !commitByHash.has(hash))) throw new Error(`Story evidence missing: ${rawStory.id}`);
      if (evidenceRefs.some(ref => !safeEvidenceRef(ref))) throw new Error(`Unsafe story evidence ref: ${rawStory.id}`);
      return {
        title: text(change.title, `change title: ${rawStory.id}`),
        description: text(change.description, `change description: ${rawStory.id}`),
        ...(change.problem == null ? {} : { problem: text(change.problem, `change problem: ${rawStory.id}`) }),
        ...(change.result == null ? {} : { result: text(change.result, `change result: ${rawStory.id}`) }),
        evidenceHashes: unique(hashes), evidenceRefs: unique(evidenceRefs), evidenceSummaries,
      };
    });

    const rawRules = rawStory.rules == null ? {} : rawStory.rules;
    if (!rawRules || Array.isArray(rawRules) || typeof rawRules !== 'object') throw new Error(`Invalid story rules: ${rawStory.id}`);
    const sourceIds = stringList(rawRules.sourceIds, `source ids: ${rawStory.id}`);
    if (sourceIds.some(id => !SOURCE_ID_PATTERN.test(id) || !allowedSources.has(id))) throw new Error(`Invalid story source: ${rawStory.id}`);
    const pathPrefixes = stringList(rawRules.pathPrefixes, `path prefixes: ${rawStory.id}`).map(normalizePrefix);
    if (pathPrefixes.some(prefix => !prefix)) throw new Error(`Invalid story path prefix: ${rawStory.id}`);
    const subjectTerms = stringList(rawRules.subjectTerms, `subject terms: ${rawStory.id}`);
    if (subjectTerms.some(term => term.length < 2 || GENERIC_TERMS.has(term.toLocaleLowerCase()))) {
      throw new Error(`Story subject term is too generic: ${rawStory.id}`);
    }
    if (!subjectTerms.length && pathPrefixes.some(prefix => BROAD_PREFIXES.has(prefix) || BROAD_PREFIXES.has(`${prefix}/`))) {
      throw new Error(`Story path prefix is too broad: ${rawStory.id}`);
    }
    const excludeTerms = stringList(rawRules.excludeTerms, `exclude terms: ${rawStory.id}`);
    const priority = rawRules.priority == null ? 0 : Number(rawRules.priority);
    if (!Number.isSafeInteger(priority) || priority < 0 || priority > 999) throw new Error(`Invalid story priority: ${rawStory.id}`);

    const story = {
      id: rawStory.id,
      title: text(rawStory.title, `title: ${rawStory.id}`),
      purpose: text(rawStory.purpose, `purpose: ${rawStory.id}`),
      userValue: text(rawStory.userValue, `user value: ${rawStory.id}`),
      scopeNote: text(rawStory.scopeNote, `scope note: ${rawStory.id}`),
      confidence: rawStory.confidence,
      purposeEvidence, changes, summaryEvidence: normalizeSummaries(rawStory.summaryEvidence, rawStory.id),
      rules: { pathPrefixes, subjectTerms, sourceIds, excludeTerms, priority },
    };

    const exact = evidenceHashes(story);
    if (!pathPrefixes.length && !subjectTerms.length && sourceIds.length && !exact.length && !summaryEvidence(story).length) {
      throw new Error(`Story source-only rule is not evidence: ${story.id}`);
    }
    for (const hash of exact) {
      const owner = exactOwners.get(hash);
      if (owner && owner !== story.id) throw new Error(`Story exact evidence conflict: ${owner}, ${story.id}`);
      exactOwners.set(hash, story.id);
    }
    for (const item of summaryEvidence(story)) {
      const key = summaryKey(item);
      const owner = summaryOwners.get(key);
      if (owner && owner !== story.id) throw new Error(`Story summary evidence conflict: ${owner}, ${story.id}`);
      summaryOwners.set(key, story.id);
    }
    return story;
  });

  // 메모 목록 순번은 재수집 시 바뀐다. 지속 사유는 안정된 커밋 키만 허용한다.
  const knownRecordKeys = new Set((snapshot.records || []).map(recordKey));
  if (catalog.reviewNotes != null && !Array.isArray(catalog.reviewNotes)) throw new Error('Invalid development review notes');
  const reviewed = new Set();
  const reviewNotes = (catalog.reviewNotes || []).map(item => {
    if (!item || !knownRecordKeys.has(item.canonicalId) || reviewed.has(item.canonicalId) || typeof item.reason !== 'string' || item.reason.length > 1000) throw new Error('Invalid development review note');
    reviewed.add(item.canonicalId);
    return { canonicalId: item.canonicalId, reason: text(item.reason, 'review reason') };
  });
  return { schemaVersion: 1, catalogVersion: String(catalog.catalogVersion), stories, reviewNotes };
}

function recordSources(record) {
  return unique(record.kind === 'summary' ? [record.sourceId] : (record.sourceIds || []));
}

function matchRecord(record, story, preparedEvidence) {
  if (record.kind === 'summary' && record.titleKnown !== false && (preparedEvidence ? preparedEvidence.summaries.has(summaryKey(record)) : summaryEvidence(story).some(item => summaryKey(item) === summaryKey(record)))) {
    return { score: 9_000_000_000_000, matchKind: 'exact-summary-evidence' };
  }
  if (preparedEvidence ? preparedEvidence.hashes.has((record.hash || '').toLowerCase()) : evidenceHashes(story).includes((record.hash || '').toLowerCase())) {
    return { score: 9_000_000_000_000, matchKind: 'exact-evidence' };
  }

  const rawRule = story.rules || {};
  const rule = {
    sourceIds: rawRule.sourceIds || [],
    excludeTerms: rawRule.excludeTerms || [],
    pathPrefixes: rawRule.pathPrefixes || [],
    subjectTerms: rawRule.subjectTerms || [],
    priority: Number(rawRule.priority) || 0,
  };
  const sources = recordSources(record);
  if (rule.sourceIds.length && !rule.sourceIds.some(id => sources.includes(id))) return null;

  const subject = String(record.subject || record.title || '').toLocaleLowerCase();
  if (rule.excludeTerms.some(term => subject.includes(term.toLocaleLowerCase()))) return null;

  const paths = (record.paths || []).map(path => path.replace(/^nenova-erp-ui\//, ''));
  const matchedPrefixes = rule.pathPrefixes.filter(prefix => paths.some(path => path.startsWith(prefix)));
  const matchedTerms = rule.subjectTerms.filter(term => subject.includes(term.toLocaleLowerCase()));

  // Non-empty dimensions are strict AND. A source id is only a scope gate.
  if (rule.pathPrefixes.length && matchedPrefixes.length === 0) return null;
  if (rule.subjectTerms.length && matchedTerms.length === 0) return null;
  if (!rule.pathPrefixes.length && !rule.subjectTerms.length) return null;

  const tier = rule.pathPrefixes.length && rule.subjectTerms.length ? 3 : rule.pathPrefixes.length ? 2 : 1;
  const longestPrefix = matchedPrefixes.reduce((max, prefix) => Math.max(max, prefix.length), 0);
  const specificity = Math.min(499, longestPrefix) + Math.min(499, matchedTerms.length * 10);
  return {
    score: tier * 1_000_000_000 + rule.priority * 1_000_000 + specificity,
    matchKind: tier === 3 ? 'path-and-subject' : tier === 2 ? 'path' : 'subject',
  };
}

function scoreRecord(record, story) {
  return matchRecord(record, story)?.score || 0;
}

function recordCounts(records) {
  const commits = records.filter(record => record.kind === 'commit');
  return {
    commits: commits.length,
    nonMerge: commits.filter(record => record.parents.length <= 1).length,
    merge: commits.filter(record => record.parents.length > 1).length,
    summaries: records.length - commits.length,
  };
}

function dateRange(records) {
  return {
    firstDate: records.length ? kstDate(time(records[0])) : null,
    lastDate: records.length ? kstDate(time(records[records.length - 1])) : null,
  };
}

function buildPurposeIndex(snapshot, rawCatalog) {
  if (!snapshot || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.summaries)) {
    throw new Error('Invalid development history snapshot');
  }
  const catalog = validateAndNormalizeCatalog(snapshot, rawCatalog);
  const preparedEvidence = new Map(catalog.stories.map(story => [story.id, {
    hashes: new Set(evidenceHashes(story)), summaries: new Set(summaryEvidence(story).map(summaryKey)),
  }]));
  const reviewNotes = new Map(catalog.reviewNotes.map(item => [item.canonicalId, item.reason]));
  const records = [...snapshot.records, ...snapshot.summaries].sort(compare);
  const keys = records.map(recordKey);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate development record');
  const commitByHash = new Map(snapshot.records.map(record => [record.hash, record]));
  const buckets = new Map([...catalog.stories.map(story => [story.id, []]), ['review-pending', []]]);
  const assignments = {};
  const reviewQueue = [];
  let ambiguous = 0;
  let unmatched = 0;

  for (const record of records) {
    const candidates = catalog.stories
      .map(story => ({ storyId: story.id, ...matchRecord(record, story, preparedEvidence.get(story.id)) }))
      .filter(candidate => Number.isFinite(candidate.score))
      .sort((a, b) => b.score - a.score || a.storyId.localeCompare(b.storyId));
    const key = recordKey(record);
    if (!candidates.length || candidates[1]?.score === candidates[0].score) {
      const reason = candidates.length ? 'ambiguous' : 'unmatched';
      if (reason === 'ambiguous') ambiguous += 1; else unmatched += 1;
      buckets.get('review-pending').push(record);
      assignments[key] = { primaryStoryId: 'review-pending', matchKind: reason, ...(reviewNotes.has(key) ? { reviewReason: reviewNotes.get(key) } : {}) };
      reviewQueue.push({ recordId: key, reason, candidateStoryIds: candidates.filter(candidate => candidate.score === candidates[0]?.score).map(candidate => candidate.storyId) });
    } else {
      const chosen = candidates[0];
      buckets.get(chosen.storyId).push(record);
      assignments[key] = { primaryStoryId: chosen.storyId, matchKind: chosen.matchKind };
    }
  }

  const stories = catalog.stories.map(story => {
    const linked = buckets.get(story.id);
    const storySources = unique(linked.flatMap(recordSources)).sort();
    const changes = story.changes.map((change, index) => {
      const evidence = [...change.evidenceHashes.map(hash => commitByHash.get(hash)), ...change.evidenceSummaries.map(item => snapshot.summaries.find(record => summaryKey(record) === summaryKey(item)))].filter(Boolean).sort(compare);
      return {
        title: change.title,
        description: change.description,
        ...(change.problem ? { problem: change.problem } : {}),
        ...(change.result ? { result: change.result } : {}),
        evidenceCount: change.evidenceHashes.length + change.evidenceRefs.length + change.evidenceSummaries.length,
        evidenceKinds: [...(change.evidenceHashes.length ? ['commit'] : []), ...(change.evidenceRefs.length ? ['document'] : []), ...(change.evidenceSummaries.length ? ['summary'] : [])],
        firstDate: evidence.length ? kstDate(time(evidence[0])) : null,
        lastDate: evidence.length ? kstDate(time(evidence[evidence.length - 1])) : null,
        _index: index,
      };
    }).sort((a, b) => (a.firstDate || '9999-99-99').localeCompare(b.firstDate || '9999-99-99') || a._index - b._index)
      .map(({ _index, ...change }) => change);
    return {
      id: story.id,
      title: story.title,
      purpose: story.purpose,
      userValue: story.userValue,
      scopeNote: story.scopeNote,
      confidence: story.confidence,
      purposeEvidence: story.purposeEvidence.map(item => ({ kind: item.kind, summary: item.summary })),
      changes,
      sourceIds: storySources,
      recordCount: linked.length,
      counts: recordCounts(linked),
      ...dateRange(linked),
    };
  }).sort((a, b) => {
    const firstA = buckets.get(a.id)[0];
    const firstB = buckets.get(b.id)[0];
    // 같은 날 시작한 작업도 실제 기록 시각대로 배치한다. 목적 이름의 알파벳순으로
    // 최초 개발보다 후속 보완이 먼저 표시되는 것을 방지한다.
    return (firstA ? Date.parse(time(firstA)) : Infinity) - (firstB ? Date.parse(time(firstB)) : Infinity) || a.id.localeCompare(b.id);
  });

  const reviewRecords = buckets.get('review-pending');
  const coverage = {
    totalRecords: records.length,
    assignedRecords: records.length - reviewRecords.length,
    reviewPending: reviewRecords.length,
    ambiguous,
    unmatched,
  };
  if (coverage.assignedRecords + coverage.reviewPending !== coverage.totalRecords || Object.keys(assignments).length !== records.length) {
    throw new Error('Development purpose coverage mismatch');
  }

  return {
    snapshot,
    catalogVersion: catalog.catalogVersion,
    buckets,
    assignments,
    reviewQueue,
    stories,
    reviewPending: {
      id: 'review-pending',
      title: '아직 목적을 확인 중인 기록',
      sourceIds: unique(reviewRecords.flatMap(recordSources)).sort(),
      recordCount: reviewRecords.length,
      counts: recordCounts(reviewRecords),
      ...dateRange(reviewRecords),
    },
    coverage,
  };
}

function publicRecord(record, assignment) {
  const sources = recordSources(record);
  if (record.kind === 'summary') {
    return {
      id: record.id, canonicalId: recordKey(record), kind: 'summary', date: record.date, title: record.title,
      titleKnown: record.titleKnown !== false, sourceIds: sources,
      assignment: { ...assignment },
    };
  }
  return {
    id: record.id, canonicalId: recordKey(record), kind: 'commit', date: record.committedAt || record.date,
    subject: record.subject, shortHash: record.hash.slice(0, 10), sourceIds: sources,
    isMerge: record.parents.length > 1, workType: record.workType, typeEvidence: record.typeEvidence,
    assignment: { ...assignment },
  };
}

function positiveInt(value, fallback, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, max) : fallback;
}

function queryPurposeStories(index, query = {}) {
  const mode = query.mode == null || query.mode === '' ? 'overview' : String(query.mode);
  if (!['overview', 'records'].includes(mode)) {
    return { success: false, error: '지원하지 않는 개발 이야기 조회 방식입니다.' };
  }
  if (mode === 'overview') {
    return {
      success: true,
      generatedAt: index.snapshot.generatedAt,
      catalogVersion: index.catalogVersion,
      coverage: index.coverage,
      sources: (index.snapshot.sources || []).map(source => ({ id: source.id, label: source.label })),
      stories: index.stories,
      reviewPending: index.reviewPending,
    };
  }

  const storyId = String(query.storyId || '');
  if (!index.buckets.has(storyId)) return { success: false, error: '확인할 업무 흐름을 선택해 주세요.' };
  const ordered = query.order === 'newest' ? [...index.buckets.get(storyId)].reverse() : index.buckets.get(storyId);
  const limit = positiveInt(query.limit, 50, 50);
  const totalPages = Math.max(1, Math.ceil(ordered.length / limit));
  const page = Math.min(positiveInt(query.page, 1, 1_000_000), totalPages);
  const pageRecords = ordered.slice((page - 1) * limit, page * limit);
  return {
    success: true, storyId, order: query.order === 'newest' ? 'newest' : 'oldest',
    page, limit, totalPages, totalEvents: ordered.length,
    timeline: pageRecords.map(record => publicRecord(record, index.assignments[recordKey(record)])),
  };
}

module.exports = {
  buildPurposeIndex,
  queryPurposeStories,
  scoreRecord,
  recordKey,
  validateAndNormalizeCatalog,
};
