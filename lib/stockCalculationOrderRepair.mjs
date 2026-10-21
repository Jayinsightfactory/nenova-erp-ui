import { createHash } from 'node:crypto';
import { executeHistoricalStockRepair, stockRepairDigest } from './historicalStockRepair.mjs';

export const UNORDERED_CALC_SHA256 = '990d54a853ef8a9794cc76ffcb13a7e720ae2cff13e723ca5c97e235cca1890c';
const digest = value => createHash('sha256').update(value).digest('hex');
const original = 'SELECT OrderYear, OrderWeek FROM #CalculationList;';
const ordered = 'SELECT OrderYear, OrderWeek FROM #CalculationList ORDER BY OrderYear, OrderWeek;';
const fail = message => { throw Error(message); };

/** A single reviewed definition, not a general-purpose SQL patcher. */
export function planStockCalculationOrderRepair(definition) {
  if (typeof definition !== 'string' || digest(definition) !== UNORDERED_CALC_SHA256) fail('ORDER_REPAIR_DEFINITION_CHANGED');
  if (definition.split(original).length !== 2
    || definition.split('CREATE PROCEDURE [dbo].[usp_StockCalculation]').length !== 2) fail('ORDER_REPAIR_SHAPE_CHANGED');
  const alterSql = definition.replace('CREATE PROCEDURE [dbo].[usp_StockCalculation]', 'ALTER PROCEDURE [dbo].[usp_StockCalculation]')
    .replace(original, ordered);
  return { beforeHash: digest(definition), afterHash: digest(alterSql), alterSql };
}

export async function readStockCalculationMetadata(tQuery) {
  const result = await tQuery(`
SELECT OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_StockCalculation')) AS Definition;
SELECT m.object_id,m.uses_ansi_nulls,m.uses_quoted_identifier,m.is_schema_bound,m.is_recompiled,
 m.null_on_null_input,m.execute_as_principal_id FROM sys.sql_modules m WHERE m.object_id=OBJECT_ID(N'dbo.usp_StockCalculation');
SELECT parameter_id,name,system_type_id,user_type_id,max_length,precision,scale,is_output,is_readonly,has_default_value
 FROM sys.parameters WHERE object_id=OBJECT_ID(N'dbo.usp_StockCalculation') ORDER BY parameter_id;
SELECT class,major_id,minor_id,grantee_principal_id,grantor_principal_id,type,state
 FROM sys.database_permissions WHERE class=1 AND major_id=OBJECT_ID(N'dbo.usp_StockCalculation')
 ORDER BY minor_id,grantee_principal_id,grantor_principal_id,type,state;
SELECT COUNT(*) AS SignatureCount FROM sys.crypt_properties WHERE class=1 AND major_id=OBJECT_ID(N'dbo.usp_StockCalculation');`);
  const [definitions, modules, parameters, permissions, signatures] = result.recordsets;
  if (definitions.length !== 1 || modules.length !== 1 || signatures.length !== 1) fail('ORDER_REPAIR_METADATA_UNAVAILABLE');
  if (signatures[0].SignatureCount !== 0) fail('ORDER_REPAIR_SIGNED_MODULE');
  return { definition: definitions[0].Definition, modules, parameters, permissions, signatures };
}

/** Caller owns ONE transaction for ALTER + correction + native CALC, with no retry. */
export async function executeOrderedHistoricalStockRepair(options) {
  const { tQuery, readState, expectedHash, backup, orderingFixApproved } = options;
  if (orderingFixApproved !== true || typeof backup !== 'function') fail('ORDER_REPAIR_EXPLICIT_APPROVAL_REQUIRED');
  const gate = await tQuery("SELECT * FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT) WHERE GateKey='1'");
  const row = gate.recordset?.[0];
  if (gate.recordset?.length !== 1 || row.ProtocolVersion !== 2 || row.PendingCalc
    || ['Mode','LockedAt','Action','OrderYear','OrderWeek','OwnerSessionID','OwnerToken','CalcProdKey'].some(k => row[k] !== null)) fail('ORDER_REPAIR_GATE_BUSY');
  const before = await readState(tQuery);
  if (stockRepairDigest(before) !== expectedHash) fail('ORDER_REPAIR_SOURCE_CHANGED');
  const metadata = await readStockCalculationMetadata(tQuery);
  const migration = planStockCalculationOrderRepair(metadata.definition);
  if (before.procedureHash !== migration.beforeHash) fail('ORDER_REPAIR_SOURCE_POLICY_CHANGED');
  await backup({ metadata, migration, sourceHash: expectedHash });
  const settings = metadata.modules[0];
  await tQuery(`SET ANSI_NULLS ${settings.uses_ansi_nulls ? 'ON' : 'OFF'}; SET QUOTED_IDENTIFIER ${settings.uses_quoted_identifier ? 'ON' : 'OFF'};`);
  await tQuery(migration.alterSql);
  const updated = await readStockCalculationMetadata(tQuery);
  if (digest(updated.definition) !== migration.afterHash
    || stockRepairDigest({ ...metadata, definition: null }) !== stockRepairDigest({ ...updated, definition: null })) fail('ORDER_REPAIR_METADATA_CHANGED');
  const afterDdl = await readState(tQuery);
  if (afterDdl.procedureHash !== migration.afterHash
    || stockRepairDigest({ ...afterDdl, procedureHash: before.procedureHash }) !== expectedHash) fail('ORDER_REPAIR_DDL_SIDE_EFFECT');
  const result = await executeHistoricalStockRepair({ ...options, expectedHash: stockRepairDigest(afterDdl) });
  return { ...result, ordering: { beforeHash: migration.beforeHash, afterHash: migration.afterHash, metadataPreserved: true } };
}
