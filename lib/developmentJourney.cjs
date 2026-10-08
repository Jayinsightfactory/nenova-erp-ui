'use strict';

const { selectSnapshot } = require('./fullDevelopmentHistory.cjs');
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

function kstDate(value) {
  const parts = dayFormat.formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function bucket(key, value) {
  return { [key]: value, totalEvents: 0, commits: 0, nonMerge: 0, merge: 0, summaries: 0 };
}

function countEvent(target, event) {
  target.totalEvents += 1;
  if (event.kind === 'summary') target.summaries += 1;
  else {
    target.commits += 1;
    target[event.parents.length > 1 ? 'merge' : 'nonMerge'] += 1;
  }
}

// Reuse the full-history selector so overview and day details cannot drift.
// Only safe static metadata is grouped; no record bodies are returned here.
function queryJourney(snapshot, query = {}) {
  const selected = selectSnapshot(snapshot, { ...query, order: 'oldest' });
  const monthMap = new Map();
  for (const event of selected.timeline) {
    const date = kstDate(event.committedAt || event.date);
    const month = date.slice(0, 7);
    if (!monthMap.has(month)) monthMap.set(month, { ...bucket('month', month), dayMap: new Map() });
    const chapter = monthMap.get(month);
    if (!chapter.dayMap.has(date)) chapter.dayMap.set(date, bucket('date', date));
    countEvent(chapter, event);
    countEvent(chapter.dayMap.get(date), event);
  }
  const months = [...monthMap.values()].map(({ dayMap, ...chapter }) => ({ ...chapter, days: [...dayMap.values()] }));
  return {
    success: true, generatedAt: selected.generatedAt, coverage: selected.coverage,
    coverageNote: selected.coverageNote, counts: selected.counts,
    totalEvents: selected.totalEvents, filteredCounts: selected.filteredCounts,
    sources: selected.sources, projects: selected.projects,
    source: selected.source, project: selected.project, type: selected.type, workType: selected.workType,
    months,
  };
}

module.exports = { queryJourney, kstDate };
