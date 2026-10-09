// Read-only deep links from the home feed: never create records or infer a year.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function homeKnowledgeTarget(query) {
  return typeof query?.itemId === 'string' && uuid.test(query.itemId) ? query.itemId.toLowerCase() : null;
}
export function homeFeedbackTarget(query) {
  if (typeof query?.caseKey !== 'string' || !uuid.test(query.caseKey) || typeof query.year !== 'string' || !/^\d{4}$/.test(query.year)) return null;
  const year = Number(query.year);
  return year >= 2000 && year <= 2100 ? { id: query.caseKey.toLowerCase(), year } : null;
}
