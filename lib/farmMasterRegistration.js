import {invoiceSupplierKey} from './invoiceReceiptAutoFill.js';
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
export function farmRegistrationInput(body={}){
 if(!body||typeof body!=='object'||Array.isArray(body))throw failure('농장 등록값을 확인하세요.');
 const farmName=typeof body.farmName==='string'?body.farmName.normalize('NFKC').trim():'';
 const farmCode=typeof body.farmCode==='string'?body.farmCode.trim():'';
 if(body.confirmed!==true||!farmName||farmName.length>100||farmCode.length>20||(body.farmCode!=null&&typeof body.farmCode!=='string')||/[\u0000-\u001f\u007f]/.test(farmName+farmCode)||!Number.isSafeInteger(body.counKey)||body.counKey<1)throw failure('농장명·국가와 등록 버튼을 확인하세요.');
 return {farmName,farmCode,counKey:body.counKey};
}
// Called inside one transaction. Native ClassFarm.Insert and actual IDENTITY schema.
export async function registerFarmMaster(query,types,input,userId){
 const {farmName,farmCode,counKey}=farmRegistrationInput(input);
 const country=(await query('SELECT CounKey,CounName FROM dbo.Country WITH (HOLDLOCK) WHERE CounKey=@country AND isDeleted=0',{country:{type:types.Int,value:counKey}})).recordset?.[0];
 if(!country)throw failure('현재 사용 중인 국가를 선택하세요.');
 const existing=(await query('SELECT FarmKey,FarmCode,FarmName,CounKey,isDeleted,CASE WHEN FarmName=@name THEN 1 ELSE 0 END NativeNameMatch FROM dbo.Farm WITH (UPDLOCK,HOLDLOCK)',{name:{type:types.NVarChar,value:farmName}})).recordset;
 if(!Array.isArray(existing))throw failure('농장 중복 확인에 실패했습니다.',503);
 const nativeExact=existing.filter(f=>f.NativeNameMatch===1||String(f.FarmName||'').normalize('NFKC').trim().toLowerCase()===farmName.toLowerCase());
 if(nativeExact.length>1||nativeExact.some(f=>f.CounKey!==counKey))throw failure('같은 농장명이 이미 다른 국가에 등록되어 있거나 중복되어 있습니다. 기존 농장을 확인하세요. 전산 조회 중복을 막기 위해 새로 등록하지 않습니다.',409);
 const exact=nativeExact.filter(f=>f.CounKey===counKey);
 if(exact.length===1&&!exact[0].isDeleted)return {created:false,farm:{...exact[0],CounName:country.CounName}};
 const equivalent=existing.filter(f=>(f.CounKey===counKey&&invoiceSupplierKey(f.FarmName)&&invoiceSupplierKey(f.FarmName)===invoiceSupplierKey(farmName))||(farmCode&&f.FarmCode===farmCode));
 if(exact.length||equivalent.length)throw Object.assign(failure('같거나 유사한 농장이 이미 있습니다. 기존 농장을 선택하세요. 삭제된 농장은 관리자에게 확인하세요.',409),{candidates:equivalent.filter(f=>f.CounKey===counKey&&!f.isDeleted).map(f=>({FarmKey:f.FarmKey,FarmName:f.FarmName,CounName:country.CounName}))});
 const params={name:{type:types.NVarChar,value:farmName},code:{type:types.NVarChar,value:farmCode},country:{type:types.Int,value:counKey},uid:{type:types.NVarChar,value:userId}};
 const saved=(await query(`INSERT INTO dbo.Farm(FarmCode,FarmName,CounKey,isDeleted,Descr,CreateID,CreateDtm,LastUpdateID,LastUpdateDtm)
 OUTPUT INSERTED.FarmKey,INSERTED.FarmCode,INSERTED.FarmName,INSERTED.CounKey
 VALUES(@code,@name,@country,0,N'',@uid,GETDATE(),@uid,GETDATE())`,params)).recordset?.[0];
 if(!saved||!Number.isSafeInteger(saved.FarmKey)||saved.FarmKey<1||saved.FarmName!==farmName||saved.CounKey!==counKey)throw failure('농장 등록 결과를 확인하지 못했습니다. 저장을 취소했습니다.',503);
 return {created:true,farm:{...saved,CounName:country.CounName}};
}
