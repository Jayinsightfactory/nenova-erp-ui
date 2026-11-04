// Strict, bounded response metadata only. No raw payloads, SQL, errors or input values.
// These are reported counts/references, NOT an independent proof of DB commit.
function responseEvidence(body) {
  const out = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out;
  for (const key of ['auditBatchKey', 'committedCount', 'verifiedCount', 'savedCount', 'updatedCount', 'failedCount']) {
    if (Number.isSafeInteger(body[key]) && body[key] >= 0) out[key] = body[key];
  }
  for (const key of ['jobId', 'operationId']) {
    if (typeof body[key] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body[key])) out[key] = body[key];
  }
  return out;
}
module.exports = { responseEvidence };
