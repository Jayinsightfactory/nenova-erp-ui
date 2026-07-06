#!/usr/bin/env node
/**
 * 선택 품종 확정 해제 — 최근 확정 차수 → 05-01~05-04
 *
 * 대상(사용자 지정):
 *   콜롬비아 카네이션, 콜롬비아 수국, 콜롬비아 장미,
 *   중국기타, 네덜란드, 베트남, 태국
 *
 * Usage:
 *   node scripts/bulk-unfix-selected-categories.js              # dry-run
 *   node scripts/bulk-unfix-selected-categories.js --execute    # 실행
 *   node scripts/bulk-unfix-selected-categories.js --execute --toWeek 05-01
 */

const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const ROOT = path.join(__dirname, '..');
const envPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
}

const EXECUTE = process.argv.includes('--execute');
const FORCE = process.argv.includes('--force') || EXECUTE;
const toWeekArg = (() => {
  const i = process.argv.indexOf('--toWeek');
  return i >= 0 ? process.argv[i + 1] : '05-01';
})();

const EXPLICIT_COUNTRY_FLOWERS = new Set([
  '콜롬비아카네이션',
  '콜롬비아수국',
  '콜롬비아장미',
  '중국기타',
  '네덜란드',
]);

const COUN_NAME_TARGETS = new Set(['베트남', '태국']);

function parseWeekKey(orderYear, orderWeek) {
  return String(orderYear || new Date().getFullYear()) + String(orderWeek || '').replace('-', '');
}

function weekKeyToLabel(key) {
  const year = key.slice(0, 4);
  const rest = key.slice(4);
  return `${year}-${rest.slice(0, 2)}-${rest.slice(2)}`;
}

function cfNameSql(alias = 'p') {
  return `NULLIF(LTRIM(RTRIM(ISNULL(${alias}.CountryFlower, N''))), N'')`;
}

function cfLabelSql(alias = 'p') {
  const cf = cfNameSql(alias);
  return `ISNULL(${cf}, ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(${alias}.CounName, N''))), N''), N'(분류없음)'))`;
}

function matchesTarget(row) {
  const cf = String(row.countryFlower || '').trim();
  const label = String(row.label || '').trim();
  const coun = String(row.counName || '').trim();
  if (EXPLICIT_COUNTRY_FLOWERS.has(cf)) return true;
  if (COUN_NAME_TARGETS.has(coun) && (!cf || COUN_NAME_TARGETS.has(label))) return true;
  if (COUN_NAME_TARGETS.has(label)) return true;
  if (cf.startsWith('베트남')) return true;
  return false;
}

async function connect() {
  return sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      connectTimeout: 30000,
      requestTimeout: 120000,
    },
  });
}

async function discoverCategories(pool) {
  const q = `
    SELECT DISTINCT
      ${cfNameSql('p')} AS countryFlower,
      ${cfLabelSql('p')} AS label,
      LTRIM(RTRIM(ISNULL(p.CounName, N''))) AS counName,
      COUNT(DISTINCT p.ProdKey) AS prodCnt
    FROM Product p
    WHERE p.isDeleted = 0
    GROUP BY ${cfNameSql('p')}, ${cfLabelSql('p')}, LTRIM(RTRIM(ISNULL(p.CounName, N'')))
    ORDER BY counName, label`;
  const res = await pool.request().query(q);
  const matched = res.recordset.filter(matchesTarget);
  console.log('\n## 매칭 CountryFlower / 라벨');
  for (const r of matched) {
    console.log(`  - CF="${r.countryFlower || ''}" label="${r.label}" coun="${r.counName}" (${r.prodCnt}품목)`);
  }
  return matched;
}

async function loadFixedTargets(pool, toWeekKey) {
  const year = toWeekKey.slice(0, 4);
  const q = `
    SELECT
      ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @yr) AS OrderYear,
      sm.OrderWeek,
      ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm.OrderWeek, '-', '') AS WeekKey,
      ${cfNameSql('p')} AS countryFlower,
      ${cfLabelSql('p')} AS label,
      LTRIM(RTRIM(ISNULL(p.CounName, N''))) AS counName,
      CASE WHEN ${cfNameSql('p')} IS NULL THEN 1 ELSE 0 END AS isBlank,
      COUNT(*) AS fixedLines
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
    JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
    WHERE sm.isDeleted = 0
      AND ISNULL(sd.isFix, 0) = 1
      AND ISNULL(sd.OutQuantity, 0) > 0
      AND ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm.OrderWeek, '-', '') >= @toKey
    GROUP BY ISNULL(CAST(sm.OrderYear AS NVARCHAR(4)), @yr), sm.OrderWeek,
             ${cfNameSql('p')}, ${cfLabelSql('p')}, LTRIM(RTRIM(ISNULL(p.CounName, N'')))
    ORDER BY WeekKey DESC, label`;
  const res = await pool.request()
    .input('yr', sql.NVarChar, year)
    .input('toKey', sql.NVarChar, toWeekKey)
    .query(q);
  return res.recordset.filter(matchesTarget);
}

async function loadProcedureShape(pool) {
  const res = await pool.request()
    .input('procedureName', sql.NVarChar, 'dbo.usp_ShipmentFixCancel')
    .query(`SELECT LOWER(name) AS name FROM sys.parameters WHERE object_id = OBJECT_ID(@procedureName)`);
  const names = new Set(res.recordset.map(r => r.name));
  return {
    hasCountryFlower: names.has('@countryflower'),
    hasOutput: names.has('@oresult') || names.has('@omessage'),
  };
}

async function loadShipmentProdKeys(pool, orderWeek, countryFlower, mode) {
  const res = await pool.request()
    .input('wk', sql.NVarChar, orderWeek)
    .input('cf', sql.NVarChar, countryFlower || null)
    .input('mode', sql.NVarChar, mode)
    .query(`
      SELECT DISTINCT sd.ProdKey
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
      JOIN Product p ON p.ProdKey = sd.ProdKey AND p.isDeleted = 0
      WHERE sm.OrderWeek = @wk
        AND sm.isDeleted = 0
        AND ISNULL(sd.OutQuantity, 0) > 0
        AND (
          @mode = N'ALL'
          OR (@mode = N'BLANK' AND NULLIF(LTRIM(RTRIM(ISNULL(p.CountryFlower, N''))), N'') IS NULL)
          OR (@mode = N'CATEGORY' AND p.CountryFlower = @cf)
        )`);
  return res.recordset.map(r => Number(r.ProdKey)).filter(Boolean);
}

async function runStockCalc(pool, orderYear, orderWeek, prodKeys, uid) {
  const errors = [];
  for (const prodKey of [...new Set(prodKeys)].sort((a, b) => a - b)) {
    try {
      const r = await pool.request()
        .input('yr', sql.NVarChar, orderYear)
        .input('wk', sql.NVarChar, orderWeek)
        .input('pk', sql.Int, prodKey)
        .input('uid', sql.NVarChar, uid)
        .query(`
          DECLARE @r INT, @m NVARCHAR(200);
          EXEC dbo.usp_StockCalculation
               @OrderYear = @yr, @OrderWeek = @wk, @ProdKey = @pk,
               @iUserID = @uid, @oResult = @r OUTPUT, @oMessage = @m OUTPUT;
          SELECT ISNULL(@r, 0) AS result, @m AS message;`);
      const row = r.recordset?.[0] || {};
      if (Number(row.result || 0) !== 0) {
        errors.push({ prodKey, message: row.message || 'unknown' });
      }
    } catch (e) {
      errors.push({ prodKey, message: e.message });
    }
  }
  return errors;
}

async function runUnfixCategory(pool, shape, orderYear, orderWeek, target, uid) {
  const cf = target.countryFlower || '';
  const req = pool.request()
    .input('yr', sql.NVarChar, orderYear)
    .input('wk', sql.NVarChar, orderWeek)
    .input('uid', sql.NVarChar, uid);
  let sqlText;
  if (shape.hasOutput) {
    if (shape.hasCountryFlower) {
      req.input('cf', sql.NVarChar, cf);
      sqlText = `
        DECLARE @r INT, @m NVARCHAR(MAX);
        EXEC dbo.usp_ShipmentFixCancel
             @OrderYear = @yr, @OrderWeek = @wk, @CountryFlower = @cf,
             @iUserID = @uid, @oResult = @r OUTPUT, @oMessage = @m OUTPUT;
        SELECT ISNULL(@r, 0) AS result, @m AS message;`;
    } else {
      sqlText = `
        DECLARE @r INT, @m NVARCHAR(MAX);
        EXEC dbo.usp_ShipmentFixCancel
             @OrderYear = @yr, @OrderWeek = @wk,
             @iUserID = @uid, @oResult = @r OUTPUT, @oMessage = @m OUTPUT;
        SELECT ISNULL(@r, 0) AS result, @m AS message;`;
    }
  } else if (shape.hasCountryFlower) {
    req.input('cf', sql.NVarChar, cf);
    sqlText = `
      EXEC dbo.usp_ShipmentFixCancel @OrderYear = @yr, @OrderWeek = @wk, @CountryFlower = @cf, @iUserID = @uid;
      SELECT 0 AS result, N'' AS message;`;
  } else {
    sqlText = `
      EXEC dbo.usp_ShipmentFixCancel @OrderYear = @yr, @OrderWeek = @wk, @iUserID = @uid;
      SELECT 0 AS result, N'' AS message;`;
  }
  const r = await req.query(sqlText);
  return r.recordset?.[0] || { result: -1, message: 'no result' };
}

function dedupeTargets(rows) {
  const map = new Map();
  for (const row of rows) {
    const mode = Number(row.isBlank) === 1 ? 'BLANK' : 'CATEGORY';
    const key = `${row.WeekKey}|${row.countryFlower || ''}|${row.label}|${mode}`;
    if (!map.has(key)) {
      map.set(key, {
        orderYear: row.OrderYear,
        orderWeek: row.OrderWeek,
        weekKey: row.WeekKey,
        countryFlower: row.countryFlower || '',
        label: row.label,
        counName: row.counName,
        mode,
        fixedLines: Number(row.fixedLines || 0),
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.weekKey !== b.weekKey) return a.weekKey < b.weekKey ? 1 : -1;
    return a.label.localeCompare(b.label, 'ko');
  });
}

(async () => {
  const pool = await connect();
  const uid = process.env.UNFIX_USER || 'catalog-bot';
  const defaultYear = String(new Date().getFullYear());
  const toWeekKey = parseWeekKey(defaultYear, toWeekArg);

  console.log(`모드: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`해제 범위: 최근 확정 차수 → ${weekKeyToLabel(toWeekKey)} (${toWeekArg})`);

  await discoverCategories(pool);
  const rawTargets = await loadFixedTargets(pool, toWeekKey);
  const targets = dedupeTargets(rawTargets);

  if (!targets.length) {
    console.log('\n확정 해제 대상 없음.');
    await pool.close();
    return;
  }

  console.log(`\n## 확정 해제 대상 ${targets.length}건 (높은 차수 → 낮은 차수)`);
  let curWeek = '';
  for (const t of targets) {
    const wkLabel = `${t.orderYear}-${t.orderWeek}`;
    if (wkLabel !== curWeek) {
      curWeek = wkLabel;
      console.log(`\n[${wkLabel}]`);
    }
    console.log(`  · ${t.label} (${t.mode}) — 확정라인 ${t.fixedLines}`);
  }

  if (!EXECUTE) {
    console.log('\n실행하려면: node scripts/bulk-unfix-selected-categories.js --execute');
    await pool.close();
    return;
  }

  const shape = await loadProcedureShape(pool);
  const results = [];
  const errors = [];
  for (const t of targets) {
    const tag = `${t.orderYear}-${t.orderWeek} ${t.label}`;
    try {
      const prodKeys = await loadShipmentProdKeys(pool, t.orderWeek, t.countryFlower, t.mode);
      const row = await runUnfixCategory(pool, shape, t.orderYear, t.orderWeek, t, uid);
      if (Number(row.result || 0) === 0) {
        const stockErrors = await runStockCalc(pool, t.orderYear, t.orderWeek, prodKeys, uid);
        results.push({ tag, ok: true, stockErrors: stockErrors.length });
        console.log(`✓ ${tag}${stockErrors.length ? ` (재고경고 ${stockErrors.length})` : ''}`);
      } else {
        errors.push({ tag, message: row.message || `code ${row.result}` });
        console.log(`✗ ${tag} — ${row.message || row.result}`);
      }
    } catch (e) {
      errors.push({ tag, message: e.message });
      console.log(`✗ ${tag} — ${e.message}`);
    }
  }

  console.log(`\n완료: 성공 ${results.length}, 실패 ${errors.length}`);
  if (errors.length) {
    for (const e of errors) console.log(`  FAIL ${e.tag}: ${e.message}`);
    process.exitCode = 1;
  }

  const remain = await loadFixedTargets(pool, toWeekKey);
  const remainFiltered = dedupeTargets(remain);
  console.log(`\n잔여 확정(대상 품종): ${remainFiltered.length}건`);
  for (const t of remainFiltered.slice(0, 20)) {
    console.log(`  · ${t.orderYear}-${t.orderWeek} ${t.label} (${t.fixedLines})`);
  }
  if (remainFiltered.length > 20) console.log(`  ... 외 ${remainFiltered.length - 20}건`);

  await pool.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
