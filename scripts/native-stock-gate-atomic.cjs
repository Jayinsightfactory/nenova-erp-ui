// Offline source transformer only. No DB/env/network imports or deployment action.
const {createHash}=require('node:crypto');
const EXPECTED='879357e7bf8aabe4cb60f853d18331109580f673e0dc3ba21570ad984bfbc67b';
const hash=s=>createHash('sha256').update(s,'utf16le').digest('hex');
function once(s,needle,replacement){if(s.split(needle).length!==2)throw Error('Native anchor missing/duplicated');return s.replace(needle,replacement);}
function business(s){const start=s.indexOf('\t\tDECLARE @OrderYearWeek nvarchar(20);'),end=s.indexOf('\t\tDEALLOCATE list_cursor;');if(start<0||end<start)throw Error('Business boundaries missing');return s.slice(start,end+'\t\tDEALLOCATE list_cursor;'.length);}
function patch(definition){
 if(hash(definition)!==EXPECTED)throw Error('Exact native definition hash mismatch');
 const nl=definition.includes('\r\n')?'\r\n':'\n';
 // Original source mixes LF and CRLF. Match exact original anchors; never normalize.
 let result=definition;
 const begin=result.match(/\tBEGIN TRY\r?\n        BEGIN TRANSACTION\r?\n/);if(!begin)throw Error('Transaction anchor missing');
 result=once(result,begin[0],'');
 const invalid=result.match(/\t\tIF \(@OrderYear <= 2025\)\r?\n\t\tBEGIN[\s\S]*?\t\tEND\r?\n/);if(!invalid)throw Error('Invalid-year anchor missing');
 const message=invalid[0].match(/set @oMessage = [^\r\n]+/)[0];
 result=once(result,invalid[0],'');
 const gate='\tEXEC dbo.usp_NenovaStockWeekGateEnter';
 result=once(result,gate,`\tIF (@OrderYear <= 2025)${nl}\tBEGIN${nl}\t\tSET @oResult=-1;${nl}\t\t${message}${nl}\t\tRETURN -1;${nl}\tEND;${nl}\tBEGIN TRY${nl}\t\tBEGIN TRANSACTION; -- NATIVE_STOCK_GATE_ATOMIC_CALC${nl}${gate}`);
 result=once(result,'\t\tSET @oMessage = @gateMsg;','\t\tSET @oMessage = @gateMsg;'+nl+'\t\tCOMMIT TRANSACTION; -- release only this call level');
 const commit=result.match(/\t\tIF @@TRANCOUNT > 0\r?\n            COMMIT TRANSACTION;/);if(!commit)throw Error('Commit anchor missing');result=once(result,commit[0],'');
 const leave="\t\tEXEC dbo.usp_NenovaStockWeekGateLeave @Action = N'CALC', @Success = 1, @ProtocolVersion = 2, @OwnerToken = @nenovaGateOwnerToken;";
 result=once(result,leave,leave+nl+'\t\tCOMMIT TRANSACTION; -- leave and business commit together');
 if(business(result)!==business(definition))throw Error('Business SQL changed');
 return {definition:result,beforeHash:hash(definition),afterHash:hash(result),businessHash:hash(business(result))};
}
module.exports={patch,hash,business,EXPECTED};
