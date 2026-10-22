// 이카운트 원본 행을 ecount.Raw_<PrgId> 에 적재. 파라미터 바인딩만 사용(리터럴 조립 금지).
// 같은 (PrgId, RowHash) 가 다른 배치에 이미 있으면 삽입 생략하고 DedupCnt 만 올린다(allowDuplicate=false).
import { query, withTransaction, sql } from '../db.js';
import { ensureEcountSchema, ensureRawTable } from './schema.js';
import {
  qualifiedRaw, quoteIdent, normalizeHeaders, normalizeValue, computeRowHash, isSubtotalValues,
  chunk, rowToValues, MAX_VALUE_LEN, assertPrgId,
} from './core.js';

export const CHUNK_ROWS = 500;
const MAX_PARAMS = 2000;

// 헤더·행을 정규화해 삽입 후보 배열 생성(순수 함수, 테스트 대상)
export function prepareRows(prgId, headers, rows) {
  const names = normalizeHeaders(headers);
  let truncated = 0;
  const out = [];
  (rows || []).forEach((row, i) => {
    const raw = rowToValues(row, headers);
    if (raw.every((v) => normalizeValue(v) === '')) return;
    const values = raw.map((v) => {
      const s = v === null || v === undefined ? null : String(v);
      if (s !== null && s.length > MAX_VALUE_LEN) { truncated += 1; return s.slice(0, MAX_VALUE_LEN); }
      return s === '' ? null : s;
    });
    out.push({
      rowNo: i + 1,
      values,
      hash: computeRowHash(prgId, names, raw),
      isSubtotal: (row && !Array.isArray(row) && row.__isSubtotal === true) || isSubtotalValues(raw),
    });
  });
  return { names, items: out, truncated };
}

async function createBatch(tQuery, { prgId, batchMeta }) {
  const m = batchMeta || {};
  const r = await tQuery(
    `INSERT INTO ecount.LoadBatch (PrgId, MenuName, PeriodFrom, PeriodTo, Source, FileName, FileSha256, ScreenTotal, LoadedBy, Note)
     OUTPUT INSERTED.BatchKey
     VALUES (@prg, @menu, @pf, @pt, @src, @fn, @sha, @st, @by, @note)`,
    {
      prg: { type: sql.NVarChar(20), value: prgId },
      menu: { type: sql.NVarChar(100), value: m.menuName ?? null },
      pf: { type: sql.Date, value: m.periodFrom ?? null },
      pt: { type: sql.Date, value: m.periodTo ?? null },
      src: { type: sql.NVarChar(40), value: m.source || 'xlsx' },
      fn: { type: sql.NVarChar(260), value: m.fileName ?? null },
      sha: { type: sql.Char(64), value: m.fileSha256 ?? null },
      st: { type: sql.Decimal(18, 2), value: m.screenTotal ?? null },
      by: { type: sql.NVarChar(60), value: m.loadedBy ?? null },
      note: { type: sql.NVarChar(400), value: m.note ?? null },
    },
  );
  return r.recordset[0].BatchKey;
}

async function insertGroup(tQuery, table, colList, batchKey, group, names) {
  const params = { b: { type: sql.Int, value: batchKey } };
  const tuples = group.map((it, gi) => {
    const ph = [`@n${gi}`, `@h${gi}`, `@s${gi}`];
    params[`n${gi}`] = { type: sql.Int, value: it.rowNo };
    params[`h${gi}`] = { type: sql.Char(64), value: it.hash };
    params[`s${gi}`] = { type: sql.Bit, value: it.isSubtotal ? 1 : 0 };
    names.forEach((_, ci) => {
      ph.push(`@v${gi}_${ci}`);
      params[`v${gi}_${ci}`] = { type: sql.NVarChar(MAX_VALUE_LEN), value: it.values[ci] };
    });
    return `(@b, ${ph.join(', ')})`;
  });
  await tQuery(`INSERT INTO ${table} (BatchKey, RowNo, RowHash, IsSubtotal${colList}) VALUES ${tuples.join(', ')}`, params);
}

export async function loadRows({ prgId, headers, rows, batchMeta = {}, allowDuplicate = false }) {
  assertPrgId(prgId);
  const { names, items, truncated } = prepareRows(prgId, headers, rows);
  await ensureEcountSchema();
  await ensureRawTable(prgId, names);
  const table = qualifiedRaw(prgId);
  const colList = names.length ? ', ' + names.map(quoteIdent).join(', ') : '';
  const perStmt = Math.max(1, Math.floor(MAX_PARAMS / (names.length + 4)));

  return withTransaction(async (tQuery) => {
    const batchKey = await createBatch(tQuery, { prgId, batchMeta });
    let inserted = 0;
    let dedup = 0;
    for (const part of chunk(items, CHUNK_ROWS)) {
      let todo = part;
      if (!allowDuplicate) {
        const params = { b: { type: sql.Int, value: batchKey } };
        const phs = part.map((it, i) => { params[`k${i}`] = { type: sql.Char(64), value: it.hash }; return `@k${i}`; });
        const ex = await tQuery(`SELECT DISTINCT RowHash FROM ${table} WHERE BatchKey <> @b AND RowHash IN (${phs.join(',')})`, params);
        const seen = new Set((ex.recordset || []).map((r) => String(r.RowHash).trim()));
        todo = part.filter((it) => !seen.has(it.hash));
        dedup += part.length - todo.length;
      }
      for (const g of chunk(todo, perStmt)) {
        await insertGroup(tQuery, table, colList, batchKey, g, names);
        inserted += g.length;
      }
    }
    await tQuery(
      `UPDATE ecount.LoadBatch SET RowCnt = @rc, InsertCnt = @ic, DedupCnt = @dc WHERE BatchKey = @b`,
      { rc: { type: sql.Int, value: items.length }, ic: { type: sql.Int, value: inserted }, dc: { type: sql.Int, value: dedup }, b: { type: sql.Int, value: batchKey } },
    );
    return { batchKey, prgId, rowCnt: items.length, inserted, dedup, truncated, columns: names.length };
  });
}

export { query };
