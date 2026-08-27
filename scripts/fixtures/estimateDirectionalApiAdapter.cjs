/*
 * Main-prepared adapter for scripts/test-estimate-directional-sql.cjs.
 *
 * This file is intentionally an adapter, not a second implementation of the
 * estimate save policy. It loads the current Locke API handler source in a VM,
 * replaces only its infrastructure imports, and executes the handler against
 * the harness transaction. Pure quantity/unit modules are loaded from the
 * actual workspace source. The native calculator remains dbo.usp_StockCalculation;
 * its reference body is installed by the harness from the approved backup
 * contract and the public wrapper owns only the v2 gate seam.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DATE_HANDLER = path.join(REPO_ROOT, 'pages', 'api', 'estimate', 'update-date-quantity.js');
const ENTRY_HANDLER = path.join(REPO_ROOT, 'pages', 'api', 'estimate', 'update-entry.js');

function fail(message) {
  throw new Error(`[estimate-directional-api-adapter] ${message}`);
}

function normalizeModulePath(file) {
  const withExtension = path.extname(file) ? file : `${file}.js`;
  return path.resolve(withExtension);
}

function parseNamedImports(clause) {
  const body = clause.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
  if (!body) return [];
  return body.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = part.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
    if (!match) fail(`unsupported named import: ${part}`);
    return { source: match[1], local: match[2] || match[1] };
  });
}

function importBindingCode(clause, specifier) {
  const imported = `__imports[${JSON.stringify(specifier)}]`;
  const trimmed = clause.trim();
  if (trimmed.startsWith('{')) {
    return parseNamedImports(trimmed).map(({ source, local }) =>
      `const ${local} = ${imported}.${source};`).join('\n');
  }
  if (trimmed.startsWith('* as ')) {
    return `const ${trimmed.slice(5).trim()} = ${imported};`;
  }
  const comma = trimmed.indexOf(',');
  if (comma < 0) return `const ${trimmed} = ${imported}.default ?? ${imported};`;
  const defaultName = trimmed.slice(0, comma).trim();
  const named = trimmed.slice(comma + 1).trim();
  return `const ${defaultName} = ${imported}.default ?? ${imported};\n${importBindingCode(named, specifier)}`;
}

function transformSource(source) {
  const namedExports = [];
  let transformed = source.replace(
    /\bexport\s+(?:(async)\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    (_all, asyncKeyword, name) => {
      namedExports.push(name);
      return `${asyncKeyword ? 'async ' : ''}function ${name}`;
    },
  );
  transformed = transformed.replace(
    /\bexport\s+(const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
    (_all, kind, name) => {
      namedExports.push(name);
      return `${kind} ${name}`;
    },
  );
  transformed = transformed.replace(/\bexport\s*\{([^}]+)\}\s*;?/g, (_all, body) => {
    for (const item of body.split(',')) {
      const match = item.trim().match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
      if (!match) fail(`unsupported export: ${item}`);
      namedExports.push(`${match[1]}:${match[2] || match[1]}`);
    }
    return '';
  });
  transformed = transformed.replace(/\bexport\s+default\s+/g, 'module.exports.default = ');
  const assignments = namedExports.map((entry) => {
    const [sourceName, exportName] = entry.split(':');
    return `module.exports[${JSON.stringify(exportName || sourceName)}] = ${sourceName};`;
  }).join('\n');
  return { source: transformed, importPattern: /\bimport\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2\s*;?/g, assignments };
}

function createVmLoader(importOverrides) {
  const cache = new Map();

  function resolve(importer, specifier) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      return normalizeModulePath(path.resolve(path.dirname(importer), specifier));
    }
    return specifier;
  }

  function load(file) {
    const absolute = normalizeModulePath(file);
    if (cache.has(absolute)) return cache.get(absolute);
    if (!absolute.startsWith(`${REPO_ROOT}${path.sep}`)) fail(`VM import escaped workspace: ${absolute}`);
    if (!fs.existsSync(absolute)) fail(`VM source missing: ${absolute}`);

    const source = fs.readFileSync(absolute, 'utf8');
    const transformed = transformSource(source);
    const imports = {};
    transformed.source = transformed.source.replace(transformed.importPattern, (_all, clause, _quote, specifier) => {
      const resolved = resolve(absolute, specifier);
      const override = importOverrides[resolved] || importOverrides[specifier];
      imports[specifier] = override || (typeof resolved === 'string' && resolved.startsWith(REPO_ROOT) ? load(resolved) : null);
      if (!imports[specifier]) fail(`VM import has no safe stub: ${specifier} from ${absolute}`);
      return importBindingCode(clause, specifier);
    });

    const module = { exports: {} };
    cache.set(absolute, module.exports);
    const sandbox = {
      module,
      exports: module.exports,
      __imports: imports,
      console,
      Buffer,
      Date,
      Math,
      Number,
      String,
      Boolean,
      Object,
      Array,
      RegExp,
      Error,
      TypeError,
      URL,
      Intl,
      undefined,
      Infinity,
      Set,
      Map,
      JSON,
      Promise,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      require(id) {
        if (id === 'node:crypto' || id === 'crypto') return require('node:crypto');
        fail(`VM native import is not allowed: ${id}`);
      },
    };
    vm.runInNewContext(`'use strict';\n${transformed.source}\n${transformed.assignments}`, sandbox, {
      filename: absolute,
      timeout: 10000,
    });
    cache.set(absolute, module.exports);
    return module.exports;
  }

  return load;
}

function makeDbStub(ctx) {
  return {
    sql: ctx.sql,
    withTransaction: (callback) => ctx.fixture.transactionContext(({ tQ }) => callback(tQ)),
    query: (statement, params) => ctx.fixture.query(statement, params),
  };
}

function makeEditPresenceStub(ctx) {
  return {
    async assertErpEditGuard(tQ, scope, user = {}, body = {}) {
      await ctx.audit.write(tQ, {
        action: 'erp-edit-guard-assert',
        ownerToken: body?.editGuard?.leaseToken || null,
        detail: { scope, userId: user.userId || 'admin' },
      });
      return { scope, lease: null, snapshot: { digest: 'fixture' } };
    },
    async advanceErpEditGuard(tQ, scope, user = {}, body = {}) {
      await ctx.audit.write(tQ, {
        action: 'erp-edit-guard-advance',
        ownerToken: body?.editGuard?.leaseToken || null,
        detail: { scope, userId: user.userId || 'admin' },
      });
      return { editDigestAfter: 'fixture', revision: 1, lease: null };
    },
  };
}

function loadActualHandlers(ctx) {
  const db = makeDbStub(ctx);
  const auth = { withAuth: (handler) => handler };
  const editPresence = makeEditPresenceStub(ctx);
  const pureLoader = createVmLoader({});
  const pure = {
    distributeUnits: pureLoader(path.join(REPO_ROOT, 'lib', 'distributeUnits.js')),
    estimateDateQuantity: pureLoader(path.join(REPO_ROOT, 'lib', 'estimateDateQuantity.js')),
    erpWriteScope: pureLoader(path.join(REPO_ROOT, 'lib', 'erpWriteScope.js')),
    shipmentDetailWriteGuard: pureLoader(path.join(REPO_ROOT, 'lib', 'shipmentDetailWriteGuard.js')),
    shipmentAvailability: pureLoader(path.join(REPO_ROOT, 'lib', 'shipmentAvailability.js')),
    directional: pureLoader(path.join(REPO_ROOT, 'lib', 'estimateDirectionalQuantity.js')),
  };
  const overrides = {
    [path.join(REPO_ROOT, 'lib', 'db.js')]: db,
    [path.join(REPO_ROOT, 'lib', 'auth.js')]: auth,
    [path.join(REPO_ROOT, 'lib', 'distributeUnits.js')]: pure.distributeUnits,
    [path.join(REPO_ROOT, 'lib', 'estimateDateQuantity.js')]: pure.estimateDateQuantity,
    [path.join(REPO_ROOT, 'lib', 'erpWriteScope.js')]: pure.erpWriteScope,
    [path.join(REPO_ROOT, 'lib', 'shipmentDetailWriteGuard.js')]: pure.shipmentDetailWriteGuard,
    [path.join(REPO_ROOT, 'lib', 'shipmentAvailability.js')]: pure.shipmentAvailability,
    [path.join(REPO_ROOT, 'lib', 'estimateDirectionalQuantity.js')]: pure.directional,
    [path.join(REPO_ROOT, 'lib', 'erpEditPresence.js')]: editPresence,
  };
  const load = createVmLoader(overrides);
  const dateHandler = load(DATE_HANDLER).default;
  const entryHandler = load(ENTRY_HANDLER).default;
  if (typeof dateHandler !== 'function' || typeof entryHandler !== 'function') {
    fail('Locke API handler export shape is not callable; adapter is waiting for backend completion');
  }
  return { dateHandler, entryHandler };
}

function assertApiSuccess(response, operation) {
  if (Number(response?.statusCode) >= 400 || response?.body?.success === false) {
    const error = new Error(response?.body?.error || `${operation} API failed`);
    error.code = response?.body?.code;
    error.statusCode = response?.statusCode;
    throw error;
  }
  return response;
}

function estimateQuantityForOut(outQuantity) {
  // Fixture Product.SteamOf1Bunch=16, so the actual API receives the
  // EstUnit quantity 160 for OutQuantity 10 (and 144 for OutQuantity 9).
  return Number(outQuantity) * 16;
}

async function createAdapter(ctx) {
  const handlers = loadActualHandlers(ctx);
  return {
    contract: {
      actualHandler: true,
      transactionBoundTQ: true,
      withAuthStub: true,
      auditStub: true,
      leaseStub: true,
      locking: {
        ownerToken: true,
        enterBeforeTry: true,
        leaveAfterCommitOrRollback: true,
        failureHook: true,
      },
    },

    async run({ operation, fromOutQuantity, toOutQuantity, cost = 701, dateItems } = {}) {
      const bodyBase = {
        orderYear: '2026',
        custKey: 1,
        clientId: 'fixture-client',
        pageCode: 'estimate',
        // The handler requires this for fixed quantity changes. The VM stub
        // owns audit/lease persistence; no production lease is contacted.
        editGuard: {
          leaseToken: 'fixture-edit-lease',
          clientId: 'fixture-client',
          expectedDigest: 'fixture',
        },
      };
      if (operation === 'priceOnly') {
        const response = await ctx.invokeApiHandler(handlers.entryHandler, {
          url: '/api/estimate/update-entry',
          body: {
            ...bodyBase,
            estimateKey: 2601,
            shipmentKey: 2601,
            prodKey: 1,
            unit: '송이',
            quantity: 160,
            cost,
            expectedQuantity: 160,
            expectedCost: 700,
            expectedProdKey: 1,
            expectedUnit: '송이',
            expectedDescr: 'fixture estimate',
            descr: 'fixture price-only',
          },
        });
        return assertApiSuccess(response, operation);
      }

      const items = Array.isArray(dateItems) && dateItems.length
        ? dateItems.map((item) => ({
          sdateKey: item.sdateKey,
          quantity: estimateQuantityForOut(item.toOutQuantity),
          unit: '송이',
          expectedOldQuantity: estimateQuantityForOut(item.fromOutQuantity),
          expectedOldCost: 700,
          expectedOldDescr: item.expectedOldDescr || (item.sdateKey === 2604 ? 'fixture date two' : 'fixture date'),
        }))
        : [{
          sdateKey: 2601,
          quantity: estimateQuantityForOut(toOutQuantity),
          unit: '송이',
          expectedOldQuantity: estimateQuantityForOut(fromOutQuantity),
          expectedOldCost: 700,
          expectedOldDescr: 'fixture date',
        }];
      const response = await ctx.invokeApiHandler(handlers.dateHandler, {
        url: '/api/estimate/update-date-quantity',
        body: {
          ...bodyBase,
          items,
        },
      });
      return assertApiSuccess(response, operation);
    },
  };
}

module.exports = { createAdapter };
