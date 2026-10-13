const assert=require('node:assert/strict'),fs=require('node:fs');
const {installInTransaction,PARAMETERS,META}=require('./native-stock-gate-atomic-installer.cjs');const {hash}=require('./native-stock-gate-atomic.cjs');
const original=JSON.parse(fs.readFileSync('__tests__/fixtures/native-stock-gate-2026-10-12.json','utf8').replace(/^\uFEFF/,'')).find(r=>r.name==='usp_StockCalculation').definition;
const empty={ProtocolVersion:2,PendingCalc:false,Mode:null,Action:null,OrderYear:null,OrderWeek:null,OwnerSessionID:null,OwnerToken:null,LockedAt:null,CalcProdKey:null};
const types={NVarChar:()=>null,MAX:-1};
function mock(failure){let definition=original,propertyHash=hash(original),calls=[];return {calls,query:async(s,p)=>{calls.push(s);
 if(s===META)return {recordsets:[[{definition,propertyHash,uses_ansi_nulls:true,uses_quoted_identifier:true,execute_as_principal_id:null,signatures:failure==='signed'?1:0}],PARAMETERS]};
 if(s.includes('@@TRANCOUNT'))return {recordset:[{n:1,state:1}]};
 if(s.includes('SELECT * FROM dbo.NenovaStockWeekGate'))return {recordset:[{...empty,...(failure==='busy'?{Mode:'RUN'}:{})}]};
 if(s.includes('GateCapability'))return {recordset:[{ProtocolVersion:2,IsReady:failure==='capability'?0:1}]};
 if(p?.ddl){definition=p.ddl.value;if(failure==='create-normalized')definition=definition.replace('ALTER PROCEDURE [dbo].[usp_StockCalculation]','CREATE PROCEDURE [dbo].[usp_StockCalculation]');if(failure==='changed-body')definition=definition.replace('COMMIT TRANSACTION; -- leave and business commit together','COMMIT TRANSACTION; -- changed body');return {};}
 if(s.includes('sp_updateextendedproperty')){propertyHash=hash(definition);return {};}
 return {};}};}
(async()=>{for(const failure of ['busy','signed','capability']){const m=mock(failure);await assert.rejects(()=>installInTransaction(m.query,types,{apply:true,drained:true}));assert(!m.calls.some(s=>s.includes('sp_executesql')));}
 const none=mock();await assert.rejects(()=>installInTransaction(none.query,types,{apply:true}));assert.equal(none.calls.length,0);
 const normalized=mock('create-normalized');const normalizedResult=await installInTransaction(normalized.query,types,{apply:true,drained:true});assert(normalizedResult.capabilityReady);
 const changed=mock('changed-body');await assert.rejects(()=>installInTransaction(changed.query,types,{apply:true,drained:true}),/Stored module differs/);
 const m=mock();const result=await installInTransaction(m.query,types,{apply:true,drained:true});assert(result.capabilityReady);assert.notEqual(result.beforeHash,result.afterHash);assert.equal(m.calls.filter(s=>s.includes('sp_updateextendedproperty')).length,1);assert(!m.calls.some(s=>/UPDATE\s+dbo.NenovaStockWeekGate|GRANT\s|KILL\s/i.test(s)));console.log('Installer injected-query guards PASS; no database execution.');})().catch(e=>{console.error(e);process.exitCode=1;});
