# Farm feedback inbox design — 2026-09-15

## Decision and evidence

Architect: GPT-6 Codex, P0_LOCAL. Only this design document is written. Main prepared checkout/dependencies and owns implementation, DB work and deployment. Inspected local AGENTS, canonical sibling orchestration, farmQuality helpers/store, migration, contract and golden. No external or DB access, implementation, or tests performed in this design task.

Main-provided PR614 probe 34923042310: 412 active analyzed sources, 162 overlapping signals, 324 distinct detected sources, 13 review signals, 80 missing-farm sources. These are supplied baseline counts, not independently verified here. Inbox count must not be assumed to equal 162 or 324.

Use a virtual read-only automatic inbox; first explicit event persists it. Every detected candidate is feedback-needed, including unconfirmed and missing-farm evidence. Previous canCreate=false is superseded ONLY for inbox feedback. qualityGroups and qualityAnalytics retain trusted eligibility. REQUEST records an internal request history; it sends no external message.

A migration is needed. Case.SourceKey INT NOT NULL is a legacy representative, not a source-set identity. Encoding membership/exclusion in Title, Body, RequestKey, or a changing signal key cannot safely support growth, overlap, concurrency and restore.

## Stable identity and deduplication

1. Generate signals over the selected YEAR, weeks 1..53, all units. Apply visual week/search/unit filters AFTER identity construction. Retain existing signal eligibility/pattern algorithms.
2. Build connected components of overlapping signal source sets (an edge requires an actual shared same-year DeductionKey). Disjoint signals remain separate even if names match. This consolidates pattern overlap, not causal attribution. Keep all contributing patterns in details and quantities partitioned by unit. Never aggregate all blank farms by name.
3. Durable InboxSource ownership and legacy Case.SourceKey associations are additional edges. A persisted inbox does not split when a signal disappears, source is corrected/deleted, or a screen filter changes. Its history remains accessible.
4. An unpersisted component has virtual key `v1:<year>:<minimum sourceKey>` and a revision hash over canonical sorted membership, patterns and relevant source values. The key is a locator, not a durable identifier. On first mutation resolve again from an anchor source and compare revision. A changed component returns 409 INBOX_STALE with refreshed projection; never silently redirect a draft.
5. Persisted keys are UUIDs independent of labels, status, pattern names and source growth. Sources are the linkage authority. If a new source bridges two persisted inboxes, GET returns one composite card with both inbox IDs and every existing case history. Do not silently choose one case or combine case statuses. Explicit event target selection is required when multiple histories exist; no transfer button is needed.
6. Do not auto-reparent or delete legacy cases/events/evidence. Legacy cases with the same SourceKey or multiple anchors in one component remain separately labeled histories in one card. Cases with no current matching signal remain visible as historical feedback.

## Minimal durable schema

New WebFarmQualityInbox:

- InboxKey uniqueidentifier PK; OrderYear int NOT NULL; Version int NOT NULL default 1.
- Excluded bit NOT NULL default 0; ExclusionReason nvarchar(1000) NULL; ExcludedAt datetime2 NULL; ExcludedBy nvarchar(100) NULL.
- CreatedAt/UpdatedAt datetime2; CreatedBy nvarchar(100).
- UNIQUE(InboxKey,OrderYear) for composite FK.

New WebFarmQualityInboxSource:

- OrderYear int, SourceKey int, InboxKey uniqueidentifier, LinkedAt datetime2, LinkedEventKey bigint; all required.
- PK(OrderYear,SourceKey): one durable owner per source. FK(InboxKey,OrderYear) to Inbox; FK LinkedEventKey to Event. Index InboxKey.
- Source links are never removed merely because source is deleted, disqualified or reassigned to a farm. No FK cascade into ERP/source tables.

Add nullable InboxKey to WebFarmQualityCase, with year-consistent FK to Inbox. Many legacy cases can belong to one inbox. Preserve every existing column and key. No automatic migration backfill that picks a winner among duplicate legacy cases.

Case.SourceKey remains a genuine same-year source anchor (minimum validated member for a newly materialized case). Case.ProdKey/ProductName represent that anchor only; composite titles/details derive from all sources, never claim the entire card is that product. Unknown farm stores FarmName='' and FarmKey=NULL; UI labels it 농장 미지정. Never invent a farm key. Existing case snapshots are not overwritten by source enrichment.

## Exact module contracts

New pure lib/farmQualityInbox.js:

```js
export function buildQualityInbox({scope, sources, signals, inboxes, links, cases})
// scope validated by qualityScope; signals are YEAR-wide.
// returns {items, counts}; deterministic and does not mutate inputs.

export function resolveQualityInboxTarget({scope, sources, signals, inboxes, links, cases, target})
// returns {component, targetCase, newSourceKeys, expectedRevision}
// or throws INBOX_STALE / INBOX_TARGET_REQUIRED / INBOX_NOT_FOUND.

export function qualityInboxMutationPolicy({action, user, item, reason, kind})
// returns allowed normalized operation or throws; shared preview/server policy.
```

Public item whitelist:

```js
{
  key, revision, orderYear, inboxKeys, caseKeys,
  virtual, needsFeedback, excluded, exclusionReason,
  sourceKeys, newSourceKeys, sourceCount, patternKinds,
  firstWeek, lastWeek, quantitiesByUnit,
  sourceReviewRequired, sourceReviewReasons,
  suspectedRecurrence, conflict: null | 'MULTIPLE_HISTORIES',
  cases: [{caseKey, title, status, version, eventCount, recentEvents}],
  sources: [/* existing safe coverage projection + new/historical flags */],
  capabilities: {canComment, canManage, canExclude, canRestore}
}
```

No CustKey/customerIdentity in public keys, revision input exposed to clients, or payload. Compute revision server-side with SHA-256 canonical serialization; send digest only. Stored CustName may be shown in expanded evidence.

Store exports (existing exports stay compatible):

```js
export async function loadQualityInbox(input) // SELECT only
export async function saveQualityInboxEvent(input, user)
export async function setQualityInboxExclusion(input, user)
```

Event input: `{year, target:{anchorSourceKey,inboxKey?,caseKey?,revision}, kind, body, eventDate?,dueDate?,appliedWeek?,evidenceKeys,requestId,caseVersion?,inboxVersion?}`.

Exclusion input: `{year,target,action:'exclude'|'restore',reason,requestId,inboxVersion?,caseVersion?}`. Require nonblank bounded reason for both actions. Return updated inbox plus acknowledgement event and case version. Keep API withAuth/account/role and same-origin mutation checks.

New endpoint action names: `inboxEvent`, `inboxExclude`, `inboxRestore`. Do not route these through legacy create's confirmed-farm guard. Instead require a current detected component or existing persisted case, exact year/source membership and inbox policy. Keep legacy create validation unchanged for old clients/manual trusted groups.

## Transaction and audit contract

For an explicit mutation: check RequestKey/PayloadHash replay first; serialize ownership decisions per selected year (transaction-owned application lock or equivalent serializable indexed range locks); re-read source, source links, inboxes and target cases; rebuild the same year-wide projection; validate revision, selected case and versions; then write.

First event creates Inbox + Case + Event and links ALL currently displayed validated component sources in the same transaction. If the component has a single legacy case, reuse it and attach its nullable InboxKey; preserve SourceKey/status/history. If there are several cases, require selected case for the event and attach safely without merging histories. Concurrent first events on overlapping source sets must converge on durable ownership; a loser returns refreshed 409 or appends to the resolved target after explicit compatible validation, never a second duplicate case.

First event kind can be COMMENT or an authorized REQUEST (transition from NEW); do not inherit legacy create's forced COMMENT behavior. RESPONSE/APPLY/CLOSE/RECUR keep existing transition prerequisites. New links reference the acknowledging event. Existing persisted component growth links only on explicit mutation; GET shows pending newSourceKeys.

EXCLUDE/RESTORE are immutable audit event kinds which preserve Case.Status. They update inbox exclusion state/version and record actor/reason; do not repurpose CLOSED, delete a case, or edit old event bodies. Suggested permission: current incoming-management permission, enforced server-side; ordinary allowed readers retain COMMENT. Evidence attachment remains restricted to ordinary event operations and existing same-year uploader checks.

For composite cards backed by several inboxes, exclude/restore applies atomically to the reviewed set of inbox IDs and membership revision, recording audit per affected inbox using a deterministic child request ID plus operation payload. Do not implement partial success. A simpler implementation may return target selection for exclusion until atomic composite support exists, but must expose each scope explicitly.

Excluded membership is a reviewed snapshot. New unlinked sources cause the card to reappear in the active inbox with NEW_SOURCE and '제외 이후 새 원본' while prior exclusion remains in audit; old exclusion never suppresses unseen future sources. Restoring reactivates the reviewed inbox without erasing its exclusion reason/history.

New source badges compare current detected source keys with durable links. Merely opening a card never acknowledges them. New sources after CLOSED/OBSERVING produce suspectedRecurrence, not automatic persisted Status change. Reordered rows/changed names do not count as new sources. Existing linked source deletions remain historical evidence and do not destroy the case.

Existing exact-admin physical delete requires explicit handling of new FKs: delete links referencing removed events, then evidence/events/case; preserve remaining histories/inbox when present. Deleting a case does not mean excluding its still-active source: a virtual candidate may return. UI must distinguish exclusion from destructive legacy delete.

## Criteria ledger

| Criterion | Authority / consumer | Fixed behavior |
|---|---|---|
| Feedback-needed | Latest user correction / inbox UI + mutation | Every detected component, including missing farm/unconfirmed |
| Trusted rates | Existing qualityGroups/analytics | Unchanged confirmed/farm/quantity/unit predicates |
| Scope | qualityScope + year-wide identity builder | Year before dedupe; display filters never determine ownership |
| Overlap | Shared DeductionKey sets + durable ownership | Distinct source count, all contributing pattern evidence retained |
| No signal | Existing source coverage | Not invented as an automatic feedback case; historical cases retained |
| Unknown farm | Current signal attribution | Feedback allowed; no fabricated farm attribution |
| First event | Explicit user save | Atomic materialization and source links, no transfer action |
| Legacy conflicts | Real CaseKeys/history | Show every history; require event target; never first-match winner |
| New source | Current minus linked source IDs | Badge until explicit reviewed mutation |
| Recurrence | New evidence + existing observation/closed state | Suspected badge; no GET status update |
| Exclusion | Explicit reasoned management operation | Audited, reversible; new sources not silently excluded |
| Idempotency | Existing RequestKey/PayloadHash | Exact replay once; changed payload rejects |
| Evidence | Existing uploader/year/Event FK | Same transaction and immutable event attachment |
| Privacy | Current authorized name contract | Names in evidence; no internal customer identifiers |

## Side-effect ledger

| Action | Inbox / Source links | Case / Event | Evidence | WebSalesDefectDeduction, Product, ViewWarehouse, ERP ledgers |
|---|---|---|---|---|
| GET/list/filter/open | SELECT only | SELECT only | Existing authenticated SELECT | SELECT only; preserve all |
| First feedback event | INSERT reviewed identity/links | Create or reuse case; INSERT event | Attach authorized drafts atomically | Preserve |
| Later event/new-source acknowledgement | Link new sources; bump version | Existing guarded event/status update | Existing attachment policy | Preserve |
| Exclude/restore | Explicit state/version update | Append audit; preserve business status/history | Preserve | Preserve |
| New source discovered | No writes | No writes | Preserve | Preserve |
| Existing exact-admin delete | Remove dependent links as required | Existing scoped child-first delete | Existing scoped delete | Preserve |

Estimate, OrderDetail, ShipmentDetail.Amount/Vat/isFix, ShipmentDate, StockHistory, WebProfitReport and associated sales/quote Views have no new mutation paths. No SQL quantities are synthesized from legacy Estimate.

## UI and ownership handoff

Default page is one compact feedback inbox (1920x1080 first, then 1366 and <=760). Every virtual candidate displays 요청 필요 and opens the existing composer directly. Remove transfer/create buttons for automatic signals. Keep trusted rate analysis as secondary view. Expanded card has pattern evidence, original source rows, source-quality warnings, all linked histories, and existing evidence/event controls. Composite histories have explicit selected-case labels; statuses are shown per history rather than guessed from the first case. Excluded filter allows reason inspection and restore. First-save errors preserve drafts/evidence.

Core owner: new pure helper + fixtures; storage owner: migration/store/API/contract transaction tests; UI owner: inbox list/composer/history controls, no SQL. Main owns deployment migration and integration. Existing farmQuality rate helpers must not be refactored by the inbox UI worker.

## Acceptance fixtures and unresolved production checks

- Overlap A={1,2}, B={2,3} => one inbox, 3 sources; disjoint same-name signals stay separate; transitive overlap retains all patterns.
- Same source key across years cannot consume identity. Sorting and scope display changes preserve durable identity.
- New source extends existing inbox; late bridge between two persisted inboxes preserves both histories and asks target, never silently merges statuses.
- Two legacy cases with the same anchor remain readable with distinct events/evidence. No-current-signal legacy case stays accessible.
- Unknown-farm and unconfirmed first COMMENT/authorized REQUEST succeed only in new feedback-only boundary; legacy trusted create still rejects.
- Two concurrent first saves with different request IDs produce one ownership mapping; same request replay produces one event; rollback leaves no orphan Inbox/Case/link/evidence binding.
- Exclude/restore requires reason/role/version and preserves status; new sources escape old exclusion; no GET acknowledgements.
- Coverage: detected distinct sources equal union across inbox cards (composite histories do not duplicate source totals). analyzed=detected+noPattern remains unchanged.
- Missing unit preserved as its existing bucket; no cross-unit quantity sum. Internal customer IDs absent recursively including keys.
- UI pending save, HTTP failure, stale membership and history selection preserve input and image drafts; no transfer button; old trusted/manual paths remain functional.

Main preflight before deployment: inspect legacy duplicate SourceKey cases, source anchors whose year differs/missing/deleted, history/evidence FK shape and supported indexes. These checks determine migration/backfill handling; no automatic destructive repair. Existing baseline counts alone do not reveal legacy ownership conflicts. Design is ready for implementation after main accepts the two-table plus nullable Case.InboxKey migration.
