'use strict';
const TYPE='ecount-lookup-select';
const DATASETS=Object.freeze(['orderStat','poStat']);
const NONCE=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validContext({nonce,dataset}={}) { return typeof nonce==='string'&&NONCE.test(nonce)&&DATASETS.includes(dataset); }
function createSelection({nonce,dataset,value='daily'}={}) {
  if(!validContext({nonce,dataset})||value!=='daily')throw Error('INVALID_LOOKUP_SELECTION');
  return {type:TYPE,nonce,dataset,value};
}
function validateSelection(event,{origin,child,nonce,dataset,currentDataset,parentClosed=false}={}) {
  try {
    if(parentClosed||!validContext({nonce,dataset})||dataset!==currentDataset||!child||child.closed)return false;
    if(typeof origin!=='string'||origin==='null'||new URL(origin).origin!==origin)return false;
    if(!event||event.origin!==origin||event.source!==child)return false;
    const data=event.data;
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join(',')!=='dataset,nonce,type,value')return false;
    return data.type===TYPE&&data.nonce===nonce&&data.dataset===dataset&&data.value==='daily';
  } catch {return false;}
}
function canReturn(opener) {try{return !!opener&&!opener.closed;}catch{return false;}}
module.exports={TYPE,DATASETS,validContext,createSelection,validateSelection,canReturn};
