#!/usr/bin/env node
/**
 * Create NenovaStockWeekGate + helper SPs, then patch
 * usp_ShipmentFix / usp_ShipmentFixCancel / usp_StockCalculation
 * to enter/leave the gate. Dry-run unless --apply.
 */
const fs = require('fs');
const path = require('path');

const envPath = fs.existsSync(path.join(__dirname, '..', '.env.local'))
  ? path.join(__dirname, '..', '.env.local')
  : 'C:\\Users\\USER\\nenova-erp-ui\\.env.local';
fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const sql = require(fs.existsSync(path.join(__dirname, '..', 'node_modules', 'mssql'))
  ? 'mssql'
  : 'C:/Users/USER/nenova-erp-ui/node_modules/mssql');

const GATE_SQL_PATH = path.join(__dirname, '..', 'docs', 'migrations', '2026-08-23_nenova_stock_week_gate.sql');
const BACKUP_DIR = path.join(__dirname, '..', 'docs', 'migrations');

const TARGETS = [
  { name: 'usp_ShipmentFix', action: 'FIX' },
  { name: 'usp_ShipmentFixCancel', action: 'CANCEL' },
  { name: 'usp_StockCalculation', action: 'CALC' },
];

function enterBlock(action) {
  return `
	DECLARE @gateRes int, @gateMsg nvarchar(200);
	EXEC dbo.usp_NenovaStockWeekGateEnter
		@Action = N'${action}',
		@OrderYear = @OrderYear,
		@OrderWeek = @OrderWeek,
		@oResult = @gateRes OUTPUT,
		@oMessage = @gateMsg OUTPUT;
	IF ISNULL(@gateRes, 0) <> 0
	BEGIN
		SET @oResult = @gateRes;
		SET @oMessage = @gateMsg;
		RETURN;
	END
`;
}

function patchProcedure(def, action) {
  if (!def) throw new Error('empty procedure definition');
  if (def.includes('usp_NenovaStockWeekGateEnter')) {
    return { sql: def.replace(/CREATE\s+PROCEDURE/i, 'ALTER PROCEDURE'), already: true };
  }
  let out = def.replace(/CREATE\s+PROCEDURE/i, 'ALTER PROCEDURE');
  const msgAssign = /set\s+@oMessage\s*=\s*'';/i;
  if (!msgAssign.test(out)) throw new Error('set @oMessage = \'\' not found');
  out = out.replace(msgAssign, (m) => `${m}\n${enterBlock(action)}`);
  out = out.replace(/\breturn\s+(-1|0)\s*;/gi, (_, code) => {
    const success = Number(code) === 0 ? 1 : 0;
    return `EXEC dbo.usp_NenovaStockWeekGateLeave @Action = N'${action}', @Success = ${success};\n\t\treturn ${code};`;
  });
  return { sql: out, already: false };
}

function splitBatches(text) {
  return text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true, requestTimeout: 120000 },
  });

  const defs = {};
  for (const t of TARGETS) {
    const r = await pool.request().query(
      `SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.${t.name}')) AS def`,
    );
    defs[t.name] = r.recordset[0]?.def || '';
    console.log(t.name, 'len', defs[t.name].length, 'patched', defs[t.name].includes('usp_NenovaStockWeekGateEnter') ? 1 : 0);
  }

  if (!apply) {
    for (const t of TARGETS) {
      const patched = patchProcedure(defs[t.name], t.action);
      console.log('dry-run', t.name, 'already', patched.already ? 1 : 0, 'outLen', patched.sql.length);
    }
    console.log('dry-run only. pass --apply to write gate + ALTER procedures.');
    await pool.close();
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  for (const t of TARGETS) {
    const backupPath = path.join(BACKUP_DIR, `backup_${t.name}_${stamp}_before_stock_week_gate.sql`);
    fs.writeFileSync(backupPath, defs[t.name], 'utf8');
    console.log('backup', backupPath);
  }

  for (const batch of splitBatches(fs.readFileSync(GATE_SQL_PATH, 'utf8'))) {
    await pool.request().batch(batch);
  }
  console.log('gate table/helpers applied');

  for (const t of TARGETS) {
    const latest = await pool.request().query(
      `SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.${t.name}')) AS def`,
    );
    const patched = patchProcedure(latest.recordset[0].def, t.action);
    if (patched.already) {
      console.log(t.name, 'already patched, skip ALTER');
      continue;
    }
    await pool.request().batch(patched.sql);
    console.log('altered', t.name);
  }

  const check = await pool.request().query(`
    SELECT name,
           CASE WHEN OBJECT_DEFINITION(object_id) LIKE N'%usp_NenovaStockWeekGateEnter%' THEN 1 ELSE 0 END AS gated
      FROM sys.procedures
     WHERE name IN (N'usp_ShipmentFix', N'usp_ShipmentFixCancel', N'usp_StockCalculation')
     ORDER BY name
  `);
  console.log('verify', JSON.stringify(check.recordset, null, 2));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
