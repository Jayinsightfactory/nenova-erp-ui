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
  // SQL Server 2016 can retain CREATE in OBJECT_DEFINITION after ALTER.
  const storedCreate = alterSql.replace('ALTER PROCEDURE', 'CREATE PROCEDURE');
  return { beforeHash: digest(definition), afterHashes: [digest(alterSql), digest(storedCreate)], alterSql };
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
SELECT COUNT(*) AS SignatureCount FROM sys.crypt_properties WHERE class=1 AND major_id=OBJECT_ID(N'dbo.usp_StockCalculation');
SELECT minor_id,name,CONVERT(varchar(max),CONVERT(varbinary(max),value),2) AS ValueHex
 FROM sys.extended_properties WHERE class=1 AND major_id=OBJECT_ID(N'dbo.usp_StockCalculation') ORDER BY minor_id,name;`);
  const [definitions, modules, parameters, permissions, signatures, properties] = result.recordsets;
  if (definitions.length !== 1 || modules.length !== 1 || signatures.length !== 1) fail('ORDER_REPAIR_METADATA_UNAVAILABLE');
  if (signatures[0].SignatureCount !== 0) fail('ORDER_REPAIR_SIGNED_MODULE');
  if (!Array.isArray(properties)) fail('ORDER_REPAIR_PROPERTIES_UNAVAILABLE');
  return { definition: definitions[0].Definition, modules, parameters, permissions, signatures, properties };
}

function verifyCapabilityProperty(metadata) {
  const rows=metadata.properties.filter(p=>p.minor_id===0&&p.name==='NenovaStockGateOwnerV2Hash');
  const expected=createHash('sha256').update(metadata.definition,'utf16le').digest('hex');
  if(rows.length!==1||rows[0].ValueHex.toLowerCase()!==expected) fail('ORDER_REPAIR_CAPABILITY_HASH');
}
const protectedMetadata = metadata => ({...metadata,definition:null,properties:metadata.properties.map(p=>
  p.minor_id===0&&p.name==='NenovaStockGateOwnerV2Hash'?{...p,ValueHex:null}:p)});
async function requireCapability(tQuery) {
  const rows=(await tQuery('EXEC dbo.usp_NenovaStockWeekGateCapability;')).recordset;
  if(rows?.length!==1||Number(rows[0].ProtocolVersion)!==2||Number(rows[0].IsReady)!==1)fail('ORDER_REPAIR_CAPABILITY_NOT_READY');
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
  verifyCapabilityProperty(metadata);
  await requireCapability(tQuery);
  const migration = planStockCalculationOrderRepair(metadata.definition);
  if (before.procedureHash !== migration.beforeHash) fail('ORDER_REPAIR_SOURCE_POLICY_CHANGED');
  await backup({ metadata, migration, sourceHash: expectedHash });
  const settings = metadata.modules[0];
  await tQuery(`SET ANSI_NULLS ${settings.uses_ansi_nulls ? 'ON' : 'OFF'}; SET QUOTED_IDENTIFIER ${settings.uses_quoted_identifier ? 'ON' : 'OFF'}; EXEC sys.sp_executesql @ddl;`,
    {ddl:{type:options.types.NVarChar(options.types.MAX),value:migration.alterSql}});
  await tQuery(`DECLARE @hash varbinary(32)=HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'dbo.usp_StockCalculation')));
IF NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=1 AND major_id=OBJECT_ID(N'dbo.usp_StockCalculation') AND minor_id=0 AND name=N'NenovaStockGateOwnerV2Hash') THROW 51000,'Capability hash disappeared',1;
EXEC sys.sp_updateextendedproperty @name=N'NenovaStockGateOwnerV2Hash',@value=@hash,@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'PROCEDURE',@level1name=N'usp_StockCalculation';`);
  const updated = await readStockCalculationMetadata(tQuery);
  const afterHash=digest(updated.definition);
  if (!migration.afterHashes.includes(afterHash)
    || stockRepairDigest(protectedMetadata(metadata)) !== stockRepairDigest(protectedMetadata(updated))) fail('ORDER_REPAIR_METADATA_CHANGED');
  verifyCapabilityProperty(updated);
  await requireCapability(tQuery);
  const afterDdl = await readState(tQuery);
  if (afterDdl.procedureHash !== afterHash
    || stockRepairDigest({ ...afterDdl, procedureHash: before.procedureHash }) !== expectedHash) fail('ORDER_REPAIR_DDL_SIDE_EFFECT');
  const result = await executeHistoricalStockRepair({ ...options, expectedHash: stockRepairDigest(afterDdl) });
  if(stockRepairDigest(await readStockCalculationMetadata(tQuery))!==stockRepairDigest(updated))fail('ORDER_REPAIR_NATIVE_METADATA_CHANGED');
  await requireCapability(tQuery);
  return { ...result, ordering: { beforeHash: migration.beforeHash, afterHash, metadataPreserved: true, capabilityReady: true }, afterMetadata:updated };
}
