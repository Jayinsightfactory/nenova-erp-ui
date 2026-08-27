const assert = require('node:assert/strict');
const fs = require('node:fs');

function response() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

(async () => {
  const store = await import('../lib/chinaVolumeBoardStore.js');
  const api = await import('../lib/chinaVolumeBoardApi.js');

  assert.equal(store.normalizeChinaBoardYear(2026), '2026');
  assert.equal(store.normalizeChinaBoardWeek('35-1'), '35-01');
  assert.throws(() => store.normalizeChinaBoardWeek('35'), { code: 'INVALID_ORDER_WEEK' });

  const normalized = store.normalizeChinaVolumeBoardSave({
    orderYear: 2026, orderWeek: '35-1', name: '', packingRows: [], cells: {},
    matchOverrides: {}, reviewState: { resolved: false, quantity: 0 },
  });
  assert.equal(normalized.name, '35-01 중국물량표');
  assert.deepEqual(JSON.parse(normalized.packingRowsJson), []);
  assert.deepEqual(JSON.parse(normalized.reviewStateJson), { resolved: false, quantity: 0 }, 'false와 0을 기본값으로 덮지 않는다');

  // 교차연도 fixture: 같은 35-01이어도 명시한 연도만 SQL scope에 전달한다.
  const rows = [
    { BoardKey: 1, OrderYear: '2025', OrderWeek: '35-01', BoardName: 'prior', PackingRowsJson: '[]', CellsJson: '{}', MatchOverridesJson: '{}', ReviewStateJson: '{}' },
    { BoardKey: 2, OrderYear: '2026', OrderWeek: '35-01', BoardName: 'current', PackingRowsJson: '[]', CellsJson: '{}', MatchOverridesJson: '{}', ReviewStateJson: '{}' },
  ];
  let readSql = '';
  const current = await store.loadChinaVolumeBoards({ orderYear: 2026, orderWeek: '35-1' }, async (sqlText, params) => {
    readSql = sqlText;
    assert.equal(params.orderYear.value, '2026');
    assert.equal(params.orderWeek.value, '35-01');
    return { recordset: rows.filter(row => row.OrderYear === params.orderYear.value && row.OrderWeek === params.orderWeek.value) };
  });
  assert.deepEqual(current.map(item => item.boardKey), [2]);
  assert.match(readSql, /OrderYear=@orderYear AND OrderWeek=@orderWeek/);
  await assert.rejects(() => store.loadChinaVolumeBoards({ orderYear: 2026 }, async () => ({ recordset: [] })), { code: 'INCOMPLETE_BOARD_SCOPE' });

  // 수정은 BoardKey뿐 아니라 저장된 연도·차수를 잠근 뒤 같은 scope만 갱신한다.
  const executed = [];
  const saved = await store.saveChinaVolumeBoard({
    boardKey: 2, expectedRowVersion: '00000000000000A1', orderYear: 2026, orderWeek: '35-01', name: '35-1 완료본',
    packingRows: [{ sourceItemName: 'ROSE Diana', mappingStatus: 'MATCHED' }],
    cells: { '7:70': { quantity: 0, allocations: [] } }, matchOverrides: {}, reviewState: { status: 'WARNING' },
  }, 'tester', async fn => fn(async (sqlText, params) => {
    executed.push(sqlText);
    if (/WITH\(UPDLOCK,HOLDLOCK\)/.test(sqlText)) return { recordset: [{ BoardKey: 2, OrderYear: '2026', OrderWeek: '35-01', RowVersionHex: '00000000000000A1' }] };
    if (/^UPDATE dbo\.WebChinaVolumeBoard/.test(sqlText)) return { rowsAffected: [1] };
    if (/SELECT BoardKey,BoardName/.test(sqlText)) return { recordset: [{
      BoardKey: 2, BoardName: params.name.value, OrderYear: '2026', OrderWeek: '35-01',
      PackingRowsJson: params.packingRowsJson.value, CellsJson: params.cellsJson.value,
      MatchOverridesJson: params.matchOverridesJson.value, ReviewStateJson: params.reviewStateJson.value,
    }] };
    throw new Error(`unexpected query: ${sqlText}`);
  }));
  assert.equal(saved.boardKey, 2);
  assert.equal(saved.cells['7:70'].quantity, 0);
  assert(executed.some(value => /WHERE BoardKey=@boardKey AND OrderYear=@orderYear AND OrderWeek=@orderWeek[\s\S]*RowVersion=CONVERT\(VARBINARY\(8\),@expectedRowVersion,2\)/.test(value)));

  await assert.rejects(() => store.saveChinaVolumeBoard({ boardKey: 2, expectedRowVersion: '00000000000000A1', orderYear: 2025, orderWeek: '35-01' }, 'tester', async fn => fn(async sqlText => {
    if (/UPDLOCK/.test(sqlText)) return { recordset: [{ BoardKey: 2, OrderYear: '2026', OrderWeek: '35-01', RowVersionHex: '00000000000000A1' }] };
    return { recordset: [] };
  })), { code: 'BOARD_SCOPE_CONFLICT', statusCode: 409 });
  await assert.rejects(() => store.saveChinaVolumeBoard({ boardKey: 2, orderYear: 2026, orderWeek: '35-01' }, 'tester'), { code: 'BOARD_VERSION_REQUIRED', statusCode: 409 });
  await assert.rejects(() => store.saveChinaVolumeBoard({ boardKey: 2, expectedRowVersion: '00000000000000A0', orderYear: 2026, orderWeek: '35-01' }, 'tester', async fn => fn(async sqlText => {
    if (/UPDLOCK/.test(sqlText)) return { recordset: [{ BoardKey: 2, OrderYear: '2026', OrderWeek: '35-01', RowVersionHex: '00000000000000A1' }] };
    throw new Error('stale update must not write');
  })), { code: 'STALE_BOARD_VERSION', statusCode: 409 });

  let boardDeleteSql = '';
  const deleted = await store.deleteChinaVolumeBoard({ boardKey: 2, expectedRowVersion: '00000000000000A1' }, 'tester', async fn => fn(async sqlText => {
    boardDeleteSql = sqlText; return { rowsAffected: [1] };
  }));
  assert.equal(deleted.deleted, true);
  assert.match(boardDeleteSql, /SET isDeleted=1/);
  assert.match(boardDeleteSql, /RowVersion=CONVERT\(VARBINARY\(8\),@expectedRowVersion,2\)/);
  assert.doesNotMatch(boardDeleteSql, /DELETE\s+FROM/i);
  await assert.rejects(() => store.deleteChinaVolumeBoard({ boardKey: 2 }, 'tester'), { code: 'BOARD_VERSION_REQUIRED', statusCode: 409 });

  // 전역 품목 매핑은 Product를 읽기만 하고 웹 전용 매핑에만 저장한다.
  const mappingQueries = [];
  const mapping = await store.saveChinaVolumeProductMapping({ sourceItemName: 'CHINA / ROSE Diana 50cm', prodKey: 70, prodName: '클라이언트값' }, 'tester',
    async sqlText => {
      mappingQueries.push(sqlText);
      assert.match(sqlText, /^SELECT TOP 1 ProdKey/);
      return { recordset: [{ ProdKey: 70, ProdName: 'ROSE Diana 50cm' }] };
    },
    async fn => fn(async (sqlText, params) => {
      mappingQueries.push(sqlText);
      if (/WITH\(UPDLOCK,HOLDLOCK\)/.test(sqlText)) return { recordset: [] };
      if (/INSERT dbo\.WebChinaVolumeProductMap/.test(sqlText)) return { recordset: [{ MapKey: 9 }] };
      if (/FROM dbo\.WebChinaVolumeProductMap WHERE MapKey=@mapKey/.test(sqlText)) return { recordset: [{ MapKey: 9, NormalizedSourceName: params.normalized.value, SourceItemName: params.source.value, ProdKey: 70, ProdNameSnapshot: params.prodName.value }] };
      throw new Error(`unexpected mapping query: ${sqlText}`);
    }));
  assert.equal(mapping.mapKey, 9);
  assert.equal(mapping.prodName, 'ROSE Diana 50cm', '품목명 snapshot은 클라이언트가 아니라 활성 Product에서 가져온다');
  assert(mappingQueries.some(value => /INSERT dbo\.WebChinaVolumeProductMap/.test(value)));
  assert(mappingQueries.every(value => !/(INSERT|UPDATE|DELETE)\s+(dbo\.)?(Order|Shipment|Warehouse|Stock|Estimate|ProductStock|WebProfitReport)/i.test(value)));

  let mapDeleteSql = '';
  await store.deleteChinaVolumeProductMapping(9, 'tester', async fn => fn(async sqlText => {
    mapDeleteSql = sqlText; return { rowsAffected: [1] };
  }));
  assert.match(mapDeleteSql, /WebChinaVolumeProductMap SET isDeleted=1/);

  // API는 migration 누락을 503으로 반환하고 GET 중 DDL 또는 저장 서비스를 호출하지 않는다.
  let touched = false;
  const unavailable = api.createChinaVolumeBoardHandler({
    assertSchema: async () => { const error = new Error('migration required'); error.code = 'MIGRATION_REQUIRED'; error.statusCode = 503; throw error; },
    loadBoards: async () => { touched = true; }, loadMappings: async () => { touched = true; },
  });
  const unavailableRes = response();
  await unavailable({ method: 'GET', query: {}, user: { userId: 'tester' } }, unavailableRes);
  assert.equal(unavailableRes.statusCode, 503);
  assert.equal(unavailableRes.body.code, 'MIGRATION_REQUIRED');
  assert.equal(touched, false);

  const calls = [];
  const handler = api.createChinaVolumeBoardHandler({
    assertSchema: async () => calls.push('schema'),
    loadBoards: async scope => { calls.push(['load', scope]); return [{ boardKey: 2 }]; },
    loadMappings: async () => [{ mapKey: 9 }],
    saveBoard: async body => ({ boardKey: body.boardKey || 3 }),
    saveMapping: async body => ({ mapKey: body.prodKey }),
    deleteBoard: async target => ({ boardKey: Number(target.boardKey), deleted: true }),
    deleteMapping: async key => ({ mapKey: Number(key), deleted: true }),
  });
  const getRes = response();
  await handler({ method: 'GET', query: { orderYear: '2026', orderWeek: '35-01' }, user: { userId: 'tester' } }, getRes);
  assert.equal(getRes.body.current.boardKey, 2);
  assert.equal(getRes.body.productMappings[0].mapKey, 9);
  const deleteRes = response();
  await handler({ method: 'DELETE', query: { mappingKey: '9' }, user: { userId: 'tester' } }, deleteRes);
  assert.deepEqual(deleteRes.body, { success: true, mapKey: 9, deleted: true });

  const apiSource = fs.readFileSync('pages/api/stats/china-volume-board.js', 'utf8');
  const storeSource = fs.readFileSync('lib/chinaVolumeBoardStore.js', 'utf8');
  const migrationSource = fs.readFileSync('docs/migrations/2026-08-27_web_china_volume_board.sql', 'utf8');
  const applySource = fs.readFileSync('scripts/apply-china-volume-board-migration.mjs', 'utf8');
  const deploySource = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
  assert.doesNotMatch(apiSource + storeSource, /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i, 'runtime API/helper에는 DDL이 없어야 한다');
  assert.match(migrationSource, /CREATE TABLE dbo\.WebChinaVolumeBoard/);
  assert.match(migrationSource, /CREATE TABLE dbo\.WebChinaVolumeProductMap/);
  assert.match(migrationSource, /UX_WebChinaVolumeProductMap_ActiveNormalized/);
  assert.match(applySource, /MappingUniqueIndex/);
  assert.match(deploySource, /apply-china-volume-board-migration\.mjs --apply/);

  console.log('china volume board store/API tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
