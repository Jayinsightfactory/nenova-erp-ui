import { canonicalDigest } from './canonical.mjs';

export const PROVENANCE_SCHEMA_VERSION = 1;

export function createProvenance({
  resolverId,
  resolverVersion,
  sourceRefs,
  inputPayload,
  outputValue,
  evidenceStatus = 'VERIFIED',
  evaluatedAt = null,
}) {
  const inputDigest = canonicalDigest(inputPayload ?? null);
  const outputDigest = canonicalDigest(outputValue ?? null);
  const provenance = {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    resolverId,
    resolverVersion,
    sourceRefs: [...(sourceRefs || [])].sort(),
    inputDigest,
    outputDigest,
    evidenceStatus,
    evaluatedAt,
  };
  return { ...provenance, provenanceDigest: canonicalDigest(provenance) };
}

export function provenanceDigestForCell({ workbookHash, sheet, address, mappingId, semanticFieldId, role, formulaFingerprint, valueDigest, source }) {
  return canonicalDigest({ workbookHash, sheet, address, mappingId, semanticFieldId, role, formulaFingerprint, valueDigest, source });
}
