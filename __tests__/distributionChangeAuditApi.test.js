'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const routeSource = fs.readFileSync(require.resolve('../pages/api/orders/distribution-change-audit.js'), 'utf8');

function compileRoute(deps, env = { ANTHROPIC_API_KEY: 'test-key', ORDER_PASTE_LLM_MODEL: 'test-model' }) {
  const transformed = routeSource
    .replace("import Anthropic from '@anthropic-ai/sdk';", 'const Anthropic = deps.Anthropic;')
    .replace("import { query, sql } from '../../../lib/db';", 'const { query, sql } = deps.db;')
    .replace("import { withAuth } from '../../../lib/auth';", 'const { withAuth } = deps.auth;')
    .replace("import { buildExtractionPrompt, normalizeExtraction } from '../../../lib/distributionChangeExtract';", 'const { buildExtractionPrompt, normalizeExtraction } = deps.extract;')
    .replace("import { validateAuditScope, loadDistributionChangeFacts } from '../../../lib/distributionChangeFacts';", 'const { validateAuditScope, loadDistributionChangeFacts } = deps.facts;')
    .replace("import { compareDistributionChanges } from '../../../lib/distributionChangeCompare';", 'const { compareDistributionChanges } = deps.compare;')
    .replace("import { loadMappings, normalizeToken } from '../../../lib/parseMappings';", 'const { loadMappings, normalizeToken } = deps.products;')
    .replace("import { loadCustomerMappings, normalizeCustomerToken } from '../../../lib/customerMappings';", 'const { loadCustomerMappings, normalizeCustomerToken } = deps.customers;')
    .replace("import { normalizeCustomerMappingKey } from '../../../lib/normalizeCustomerToken';", 'const { normalizeCustomerMappingKey } = deps.customers;')
    .replace("import { saveAudit } from '../../../lib/distributionAuditStore';", 'const { saveAudit } = deps.store;')
    .replace('export default withAuth', 'module.exports = withAuth');
  const module = { exports: null };
  vm.runInNewContext(transformed, {
    module,
    deps,
    process: { env },
    Date,
    Number,
    String,
    Boolean,
    Array,
    Set,
    JSON,
  });
  return module.exports;
}

function response() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeDeps({ approximate = false, rejectLlm = false, llmError = null, toolName = 'record_distribution_changes', toolInput = {}, responseContent = null, schemaError = null, contextProductAlias = false, conflictingProductAliases = false, duplicateDirectProductNames = false, storeFailure = false, missingSourceAt = false, factsFailure = false, manyCandidates = false, conflictingCustomerAliases = false } = {}) {
  const saveCalls = [];
  const messageCalls = [];
  const history = manyCandidates
    ? Array.from({ length: 51 }, (_, index) => ({ eventId: `event-${index + 1}`, before: index, after: index + 1, changeAt: '2026-09-10T10:00:00+09:00', week: '37-01', shipmentDate: '2026-09-10', unit: '단' }))
    : [{ eventId: 'event-1', before: 3, after: 23, changeAt: '2026-09-10T10:00:00+09:00', week: '37-01', shipmentDate: '2026-09-10', unit: '단' }];
  class Anthropic {
    constructor() {
      this.messages = {
        create: async input => {
          messageCalls.push(input);
          if (rejectLlm) throw new Error('vendor-header: secret prompt content');
          if (llmError) throw llmError;
          return { content: responseContent || [{ type: 'tool_use', name: toolName, input: toolInput }] };
        },
      };
    }
  }
  return {
    Anthropic,
    db: { query: async () => { throw new Error('query should be mocked by facts loader'); }, sql: {} },
    auth: { withAuth: handler => handler },
    extract: {
      buildExtractionPrompt: () => 'strict prompt',
      normalizeExtraction: (raw) => {
        if (schemaError && raw.__schemaFailure === true) throw schemaError;
        return Array.isArray(raw.requests)
          ? raw
          : {
          requests: [{
            id: 'request-1', sourceIdentity: 'message-1', quote: '라움별칭 화이트별칭 2박스 추가',
            action: 'ADD', customerText: '라움별칭', productText: contextProductAlias || conflictingProductAliases || duplicateDirectProductNames ? '돈셀' : '화이트별칭', productContextText: contextProductAlias || conflictingProductAliases || duplicateDirectProductNames ? '카네이션' : null, qty: 2, unit: '박스',
            week: '37-01', shipmentDate: null, ...(missingSourceAt ? {} : { sourceAt: '2026-09-10T09:30:00+09:00' }), timestamp_approximate: approximate,
          }],
          unresolved: [],
          };
      },
    },
    facts: {
      validateAuditScope: ({ year, week }) => ({ year: String(year), weeks: [week], from: '2026-09-10', to: '2026-09-10' }),
      loadDistributionChangeFacts: async () => {
        if (factsFailure) throw new Error('database unavailable');
        return {
        customers: [{ CustKey: 11, CustName: '라움' }, { CustKey: 12, CustName: '다른 업체' }],
        products: duplicateDirectProductNames ? [
          { ProdKey: 22, ProdName: '돈셀', DisplayName: 'DONCEL-A', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 },
          { ProdKey: 23, ProdName: '돈셀', DisplayName: 'DONCEL-B', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 },
        ] : [
          { ProdKey: 22, ProdName: '화이트', DisplayName: 'WHITE', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 },
          ...(conflictingProductAliases ? [{ ProdKey: 23, ProdName: '다른 돈셀', DisplayName: 'OTHER', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100 }] : []),
        ],
        history,
        currentRows: [{ ignored: true }], historyComplete: false, warnings: [],
        };
      },
    },
    compare: {
      compareDistributionChanges: input => {
        assert.match(input.asOf, /^\d{4}-\d{2}-\d{2}T/);
        if (!input.requests.length) return [];
        return [{ requestId: input.requests[0].id, candidateEventIds: manyCandidates ? history.map(event => event.eventId) : ['event-1'], advisoryOnly: true }];
      },
    },
    products: {
      loadMappings: () => duplicateDirectProductNames
        ? { '카네이션 돈셀': { prodKey: 22 } }
        : conflictingProductAliases
        ? { '돈셀': { prodKey: 22 }, '카네이션 돈셀': { prodKey: 23 } }
        : contextProductAlias ? { '카네이션 돈셀': { prodKey: 22 } } : { '화이트별칭': { prodKey: 22 } },
      normalizeToken: value => String(value).trim(),
    },
    customers: {
      loadCustomerMappings: () => conflictingCustomerAliases
        ? { primary: { custKey: 11 }, token: { custKey: 12 } }
        : { '라움별칭': { custKey: 11 } },
      normalizeCustomerToken: value => conflictingCustomerAliases ? 'token' : String(value).trim(),
      normalizeCustomerMappingKey: value => conflictingCustomerAliases ? 'primary' : String(value).trim(),
    },
    store: {
      saveAudit: async input => {
        saveCalls.push(input);
        if (storeFailure) throw new Error('storage unavailable');
        return { id: 'aa111111-1111-4111-8111-111111111111', createdAt: '2026-09-10T01:30:00.000Z', report: input.report };
      },
    },
    saveCalls,
    messageCalls,
  };
}

async function invoke(options) {
  const deps = makeDeps(options);
  const handler = compileRoute(deps);
  const res = response();
  await handler({ method: 'POST', user: { accountActive: true, userId: 'authenticated-user' }, body: { year: 2026, week: '37-01', messages: [{ identity: 'message-1', message: 'untrusted' }] } }, res);
  return { res, saveCalls: deps.saveCalls, messageCalls: deps.messageCalls };
}

function sdkError({ name, status, code, message = 'vendor detail must not leave the server' }) {
  const error = new Error(message);
  if (name) error.name = name;
  if (status !== undefined) error.status = status;
  if (code) error.code = code;
  return error;
}

(async () => {
  const { res: exactAliasResponse, saveCalls, messageCalls } = await invoke();
  assert.equal(exactAliasResponse.statusCode, 200);
  assert.equal(exactAliasResponse.body.advisoryOnly, true);
  assert.match(exactAliasResponse.body.asOf, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(JSON.parse(JSON.stringify(exactAliasResponse.body.snapshot)), {
    id: 'aa111111-1111-4111-8111-111111111111', createdAt: '2026-09-10T01:30:00.000Z',
  });
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0].year, '2026');
  assert.equal(saveCalls[0].week, '37-01');
  assert.equal(saveCalls[0].userId, 'authenticated-user');
  assert.equal(saveCalls[0].report.advisoryOnly, true);
  assert.equal(exactAliasResponse.body.requests[0].mappingConfirmed, true);
  assert.equal(exactAliasResponse.body.requests[0].inputQty, 2);
  assert.equal(exactAliasResponse.body.requests[0].inputUnit, '박스');
  assert.equal(exactAliasResponse.body.requests[0].qty, 20);
  assert.equal(exactAliasResponse.body.requests[0].unit, '단');
  assert.match(exactAliasResponse.body.requests[0].conversionReason, /명시적 단위 계수/);
  assert.deepEqual(JSON.parse(JSON.stringify(exactAliasResponse.body.findings[0].evidence.candidateEvents)), [{
    eventId: 'event-1', before: 3, after: 23, changeAt: '2026-09-10T10:00:00+09:00', week: '37-01', shipmentDate: '2026-09-10', unit: '단',
  }]);
  assert.equal(messageCalls.length, 1);
  assert.equal(messageCalls[0].tool_choice.type, 'tool');
  assert.equal(messageCalls[0].tool_choice.name, 'record_distribution_changes');
  assert.equal(messageCalls[0].tool_choice.disable_parallel_tool_use, true);
  assert.equal(messageCalls[0].tools[0].name, 'record_distribution_changes');
  assert.deepEqual(JSON.parse(JSON.stringify(messageCalls[0].tools[0].input_schema.required)), ['requests', 'unresolved']);
  assert.deepEqual(JSON.parse(JSON.stringify(messageCalls[0].tools[0].input_schema.properties.requests.items.required)), ['sourceIdentity', 'quote', 'action', 'customerText', 'productText', 'productContextText', 'qty', 'unit', 'week', 'shipmentDate']);
  assert.deepEqual(JSON.parse(JSON.stringify(messageCalls[0].tools[0].input_schema.properties.unresolved.items.required)), ['sourceIdentity', 'quote', 'reason']);

  const { res: wrongToolResponse } = await invoke({
    toolName: 'unexpected_tool', toolInput: { requests: [], unresolved: [] },
  });
  assert.equal(wrongToolResponse.statusCode, 200);
  assert.equal(wrongToolResponse.body.requests.length, 0);
  assert.equal(wrongToolResponse.body.extractionErrorCode, 'EXTRACTION_SCHEMA');
  assert.equal(wrongToolResponse.body.extractionValidationField, 'shape');

  const { res: textOnlyResponse } = await invoke({
    responseContent: [{ type: 'text', text: '{"rawResponseMarker":"must-not-return"}' }],
  });
  assert.equal(textOnlyResponse.body.extractionErrorCode, 'EXTRACTION_SCHEMA');
  assert.equal(textOnlyResponse.body.extractionValidationField, 'shape');
  assert.doesNotMatch(JSON.stringify(textOnlyResponse.body), /rawResponseMarker|must-not-return/);

  const { res: multipleToolsResponse } = await invoke({
    responseContent: [
      { type: 'tool_use', name: 'record_distribution_changes', input: {} },
      { type: 'tool_use', name: 'unexpected_tool', input: {} },
    ],
  });
  assert.equal(multipleToolsResponse.body.extractionErrorCode, 'EXTRACTION_SCHEMA');
  assert.equal(multipleToolsResponse.body.extractionValidationField, 'shape');

  const { res: schemaFailureResponse } = await invoke({
    schemaError: new TypeError('week must be WW-SS or null'), toolInput: { __schemaFailure: true },
  });
  assert.equal(schemaFailureResponse.body.extractionErrorCode, 'EXTRACTION_SCHEMA');
  assert.equal(schemaFailureResponse.body.extractionValidationField, 'week');
  assert.match(schemaFailureResponse.body.warnings[0], /AI가 차수 형식을 올바르게 반환하지 못했습니다/);

  const { res: unknownSchemaFailureResponse } = await invoke({
    schemaError: new Error('vendor schema details must not leave the server'), toolInput: { __schemaFailure: true },
  });
  assert.equal(unknownSchemaFailureResponse.body.extractionErrorCode, 'EXTRACTION_SCHEMA');
  assert.equal(unknownSchemaFailureResponse.body.extractionValidationField, 'other');
  assert.doesNotMatch(JSON.stringify(unknownSchemaFailureResponse.body), /vendor schema details/);

  const { res: approximateResponse } = await invoke({ approximate: true });
  assert.equal(approximateResponse.body.requests[0].mappingConfirmed, false);

  const { res: conflictingAliasResponse } = await invoke({ conflictingCustomerAliases: true });
  assert.equal(conflictingAliasResponse.body.requests[0].mappingConfirmed, false);

  const { res: contextProductResponse } = await invoke({ contextProductAlias: true });
  assert.equal(contextProductResponse.body.requests[0].productContextText, '카네이션');
  assert.equal(contextProductResponse.body.requests[0].prodKey, 22);
  assert.equal(contextProductResponse.body.requests[0].mappingConfirmed, true);

  const { res: conflictingProductResponse } = await invoke({ conflictingProductAliases: true });
  assert.equal(conflictingProductResponse.body.requests[0].prodKey, null);
  assert.equal(conflictingProductResponse.body.requests[0].mappingConfirmed, false);

  const { res: duplicateDirectProductResponse } = await invoke({ duplicateDirectProductNames: true });
  assert.equal(duplicateDirectProductResponse.body.requests[0].prodKey, null);
  assert.equal(duplicateDirectProductResponse.body.requests[0].mappingConfirmed, false);

  const { res: llmFailureResponse } = await invoke({ rejectLlm: true });
  assert.equal(llmFailureResponse.statusCode, 200);
  assert.equal(llmFailureResponse.body.requests.length, 0);
  assert.equal(llmFailureResponse.body.extractionErrorCode, 'OTHER');
  assert.match(llmFailureResponse.body.warnings[0], /알 수 없는 문제/);
  assert.doesNotMatch(llmFailureResponse.body.warnings[0], /vendor-header|secret prompt/);

  for (const [error, expectedCode] of [
    [sdkError({ name: 'AuthenticationError', status: 401 }), 'API_AUTH'],
    [sdkError({ name: 'RateLimitError', status: 429 }), 'RATE_LIMIT'],
    [sdkError({ name: 'NotFoundError', status: 404 }), 'MODEL_UNAVAILABLE'],
    [sdkError({ name: 'APIConnectionTimeoutError', code: 'ETIMEDOUT' }), 'TIMEOUT'],
  ]) {
    const { res: classifiedFailureResponse } = await invoke({ llmError: error });
    assert.equal(classifiedFailureResponse.statusCode, 200);
    assert.equal(classifiedFailureResponse.body.extractionErrorCode, expectedCode);
    assert.match(classifiedFailureResponse.body.warnings[0], /원문을 미확인 항목으로 보존했습니다/);
    assert.doesNotMatch(JSON.stringify(classifiedFailureResponse.body), /vendor detail/);
  }

  const { res: missingSourceAtResponse, saveCalls: missingSourceAtSaveCalls } = await invoke({ missingSourceAt: true });
  assert.equal(Object.hasOwn(missingSourceAtResponse.body.requests[0], 'sourceAt'), false);
  assert.equal(Object.hasOwn(missingSourceAtSaveCalls[0].report.requests[0], 'sourceAt'), false);

  const { res: storageFailureResponse } = await invoke({ storeFailure: true });
  assert.equal(storageFailureResponse.statusCode, 200);
  assert.equal(storageFailureResponse.body.snapshot, null);
  assert.match(storageFailureResponse.body.warnings.at(-1), /비교 결과 저장에 실패/);

  const { res: factsFailureResponse } = await invoke({ factsFailure: true });
  assert.equal(factsFailureResponse.statusCode, 503);
  assert.equal(factsFailureResponse.body.requests.length, 1);
  assert.equal(factsFailureResponse.body.requests[0].sourceIdentity, 'message-1');

  const { res: truncatedEvidenceResponse } = await invoke({ manyCandidates: true });
  const truncatedFinding = truncatedEvidenceResponse.body.findings[0];
  assert.equal(truncatedFinding.candidateCount, 51);
  assert.equal(truncatedFinding.candidateEventIds.length, 50);
  assert.equal(truncatedFinding.evidence.candidateEvents.length, 50);
  assert.equal(truncatedFinding.evidenceTruncated, true);
  assert.equal(truncatedEvidenceResponse.body.warnings.some(warning => /50건을 초과/.test(warning)), true);
  console.log('distribution change audit API runtime tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
