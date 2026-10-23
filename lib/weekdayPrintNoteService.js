import path from 'node:path';
import crypto from 'node:crypto';
import pageNotes from './weekdayPageNoteStore.js';
import {weekdayPrintRowKey,PRINT_HEADER_KEY} from './weekdayPrintNotes.js';
import {normalizeWeekdayPrintRequest,readWeekdayAllocationPrintInTransaction} from './weekdayAllocationPrint.js';

export function createWeekdayPrintNoteService({directory=path.join(process.cwd(),'data/runtime/weekday-print-notes'),read=readWeekdayAllocationPrintInTransaction,createStore=pageNotes.createWeekdayPageNoteStore}={}) {
  function storeFor(scope,row) {
    const bucket=crypto.createHash('sha256').update(JSON.stringify([scope.mode,scope.dates,weekdayPrintRowKey(row)])).digest('hex');
    return createStore({directory:path.join(directory,bucket)});
  }
  const identity=(scope,row)=>({year:scope.year,majorWeek:scope.majorWeek,custKey:scope.custKey,prodKey:Number(row.ProdKey)});
  // Dedicated document namespace. The store's numeric slot is a customer file key,
  // never an ERP product, and is never passed to SQL or the printable row lookup.
  const headerIdentity=scope=>({...identity(scope,{ProdKey:scope.custKey})});
  const headerStore=scope=>createStore({directory:path.join(directory,'document-header',
    crypto.createHash('sha256').update(JSON.stringify([scope.mode,scope.dates])).digest('hex'))});
  async function list(scope,items) {
    const notes={};
    if(items.length){const header=await headerStore(scope).get(headerIdentity(scope));if(header)notes[PRINT_HEADER_KEY]=header;}
    await Promise.all(items.map(async row=>{const key=weekdayPrintRowKey(row);if(!key)return;
      const note=await storeFor(scope,row).get(identity(scope,row));if(note)notes[key]=note;
    }));
    return notes;
  }
  async function save(body,user,tQuery,types) {
    pageNotes.validateUserId(user?.userId);
    if(user?.accountActive===false)throw new pageNotes.WeekdayPageNoteError('UNAUTHENTICATED','활성 로그인이 필요합니다.',401);
    let scope;
    try{scope=normalizeWeekdayPrintRequest(body?.scope);}catch{throw new pageNotes.WeekdayPageNoteError('INVALID_SCOPE','견적서 연도·차수·업체·날짜를 확인하세요.');}
    if(scope.mode==='dates'&&scope.dates.length!==1)throw new pageNotes.WeekdayPageNoteError('INVALID_SCOPE','적요는 견적서 날짜별로 저장하세요.');
    if(typeof body.rowKey!=='string'||typeof body.note!=='string'||body.note.length>1000||body.note.includes('\0')
      ||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw new pageNotes.WeekdayPageNoteError('INVALID_INPUT','적요와 저장 버전을 확인하세요.');
    const current=await read(scope,tQuery,types);
    if(body.rowKey===PRINT_HEADER_KEY){
      if(!current.items.length)throw new pageNotes.WeekdayPageNoteError('PRINT_ROW_CHANGED','출력 자료가 없습니다. 미리보기를 다시 열어주세요.',409);
      if(body.note.length>100||/[\r\n]/.test(body.note))throw new pageNotes.WeekdayPageNoteError('INVALID_INPUT','차수 표시는 한 줄, 100자 이하로 입력하세요.');
      const note=await headerStore(scope).save({...headerIdentity(scope),note:body.note,earlyShipment:null,expectedRevision:body.expectedRevision},user.userId);
      return {scope,rowKey:PRINT_HEADER_KEY,note};
    }
    const candidates=current.items.filter(row=>weekdayPrintRowKey(row)===body.rowKey);
    if(candidates.length!==1)throw new pageNotes.WeekdayPageNoteError('PRINT_ROW_CHANGED','출력 품목이 변경됐습니다. 미리보기를 다시 열어주세요.',409);
    const row=candidates[0];
    const note=await storeFor(scope,row).save({...identity(scope,row),note:body.note,earlyShipment:null,expectedRevision:body.expectedRevision},user.userId);
    return {scope,rowKey:body.rowKey,note};
  }
  return {list,save};
}
export const weekdayPrintNotes=createWeekdayPrintNoteService();
