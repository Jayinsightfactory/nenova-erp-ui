const DB_NAME='nenova-distribution-inbox';
const STORE='snapshots';
const VERSION=1;
const writeChains=new Map();

function snapshotKey(userId,year,week) {
  const user=String(userId||'').trim(), y=String(year||''), w=String(week||'');
  if(!user||!/^[0-9]{4}$/.test(y)||!new RegExp(`^${y}-[0-9]{2}-[0-9]{2}$`).test(w)) return '';
  return JSON.stringify([user,y,w]);
}

function openDatabase(indexedDB=globalThis.indexedDB) {
  if(!indexedDB) return Promise.reject(new Error('IndexedDB unavailable'));
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,VERSION);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'key'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
    request.onblocked=()=>reject(new Error('IndexedDB upgrade blocked'));
  });
}

function transaction(db,mode,run) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
    let value;
    tx.oncomplete=()=>resolve(value);
    tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed'));
    tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));
    try {run(store,result=>{value=result;});} catch(error){tx.abort();reject(error);}
  });
}

function validRecord(record,key) {
  if(!record||record.version!==VERSION||record.key!==key||!Array.isArray(record.data?.rows))return false;
  const data=record.data;
  const [userId,year,week]=JSON.parse(key);
  if(record.userId!==userId||record.year!==year||record.week!==week)return false;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data.from)||!/^\d{4}-\d{2}-\d{2}$/.test(data.to)||!Number.isFinite(Date.parse(data.from))||!Number.isFinite(Date.parse(data.to)))return false;
  if(typeof data.loadedPeriod!=='string'||(data.loadedPeriod&&data.loadedPeriod!==`${data.from}/${data.to}`)||typeof data.cursor!=='string'||typeof data.more!=='boolean')return false;
  if(data.rows.some(row=>!row||typeof row.identity!=='string'||typeof row.message!=='string'))return false;
  if(!Array.isArray(data.pendingRows||[])||!Array.isArray(data.operationHistory||[]))return false;
  if(!['selected','refreshStatus','manualApplications','auditApplications','operationApplications','applicationStatus','liveHistory','liveHistoryStatus'].every(field=>data[field]===undefined||data[field]!==null&&typeof data[field]==='object'&&!Array.isArray(data[field])))return false;
  if(data.liveHistoryStatus?.warnings!==undefined&&!Array.isArray(data.liveHistoryStatus.warnings))return false;
  if(data.liveHistoryStatus?.loaded===true&&typeof data.liveHistoryStatus.scope!=='string')return false;
  if(data.historyAttempted!==undefined&&typeof data.historyAttempted!=='boolean')return false;
  if(data.applicationAttempted!==undefined&&typeof data.applicationAttempted!=='boolean')return false;
  return typeof record.savedAt==='string'&&Number.isFinite(Date.parse(record.savedAt));
}

async function readInboxSnapshot(scope,{indexedDB}={}) {
  const key=snapshotKey(scope.userId,scope.year,scope.week);
  if(!key)return null;
  // A quick menu re-entry must observe the last committed write from the
  // previous component, even if IndexedDB has not finished that transaction.
  if(writeChains.has(key))await writeChains.get(key).catch(()=>{});
  const db=await openDatabase(indexedDB);
  try {
    const record=await transaction(db,'readonly',(store,done)=>{const request=store.get(key);request.onsuccess=()=>done(request.result||null);});
    if(record&&!validRecord(record,key))throw new Error('Invalid inbox snapshot record');
    return record;
  } finally {db.close();}
}

async function writeNow(scope,data,{indexedDB,now=()=>new Date().toISOString()}={}) {
  const key=snapshotKey(scope.userId,scope.year,scope.week);
  if(!key)throw new Error('Invalid inbox snapshot scope');
  const savedAt=now(),record={key,version:VERSION,userId:String(scope.userId).trim(),year:String(scope.year),week:String(scope.week),savedAt,data};
  if(!validRecord(record,key))throw new Error('Invalid inbox snapshot data');
  const db=await openDatabase(indexedDB);
  try {
    await transaction(db,'readwrite',(store)=>store.put(record));
    return savedAt;
  } finally {db.close();}
}

function writeInboxSnapshot(scope,data,options) {
  const key=snapshotKey(scope.userId,scope.year,scope.week);
  if(!key)return Promise.reject(new Error('Invalid inbox snapshot scope'));
  const previous=writeChains.get(key)||Promise.resolve();
  const next=previous.catch(()=>{}).then(()=>writeNow(scope,data,options));
  writeChains.set(key,next);
  next.finally(()=>{if(writeChains.get(key)===next)writeChains.delete(key);}).catch(()=>{});
  return next;
}

module.exports={snapshotKey,readInboxSnapshot,writeInboxSnapshot,validRecord};
