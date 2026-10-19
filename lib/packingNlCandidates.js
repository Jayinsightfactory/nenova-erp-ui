// Recommendations only: a different invoice spelling still needs a saved mapping.
// Keep flower family and grades (2+/3+, 12/15st, 13/15cm) in the ranking.
const normalize = value => String(value || '').toUpperCase().replace(/^HIPPEASTRUM\b/, 'AMARYLLIS')
  .replace(/[^A-Z0-9+]+/g, ' ').trim();
export function packingNlCandidateNames(description, names) {
  const source = normalize(description);
  const family = source.split(' ')[0];
  const sourceTokens = new Set(source.split(' ').filter(t => t.length > 2 && !/^\d/.test(t)));
  const grade = source.match(/\b(\d+)\+/)?.[1];
  const pack = source.match(/\b(\d+)(?:X|ST)\b/)?.[1];
  return names.map(name => {
    const target = normalize(name);
    if (target.split(' ')[0] !== family) return null;
    const tokens = target.split(' ').filter(t => t.length > 2 && !/^\d/.test(t));
    const common = tokens.filter(t => sourceTokens.has(t)).length;
    if (common < 2) return null;
    const targetGrade = target.match(/\b(\d+)\+/)?.[1];
    const targetPack = target.match(/\b(\d+)(?:X|ST)\b/)?.[1];
    if (grade && targetGrade && grade !== targetGrade || pack && targetPack && pack !== targetPack) return null;
    return { name, score: common / Math.max(tokens.length, sourceTokens.size) + (grade && grade === targetGrade ? 1 : 0) + (pack && pack === targetPack ? 1 : 0) };
  }).filter(Boolean).sort((a,b) => b.score-a.score || a.name.localeCompare(b.name));
}
