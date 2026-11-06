import { currentErpReadContext } from './erpReadContext.js';

const REGISTRY=Symbol.for('nenova.profit.coherent-live.inflight.v1');
// Sharing is an overlap-only read interval, never a completed-result cache.
export async function shareLatestProfitRead(orderYear,major,read){
  if(currentErpReadContext())return read();
  const year=String(orderYear),week=String(major).padStart(2,'0');
  if(!/^\d{4}$/.test(year)||!/^(0[1-9]|[1-4]\d|5[0-3])$/.test(week))return read();
  const registry=globalThis[REGISTRY]??=new Map();
  const key=JSON.stringify([year,week]);
  let pending=registry.get(key);
  if(!pending){
    pending=Promise.resolve().then(read);registry.set(key,pending);
    // Delete before waiters resume, including rejection. No TTL, signal or saved payload.
    pending.finally(()=>{if(registry.get(key)===pending)registry.delete(key);}).catch(()=>{});
  }
  return structuredClone(await pending);
}
