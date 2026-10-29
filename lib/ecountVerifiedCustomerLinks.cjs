'use strict';
const crypto=require('node:crypto');
const registry=require('./ecountVerifiedCustomerLinks.json');
const digest=(prefix,value)=>crypto.createHash('sha256').update(prefix+String(value??'')).digest('hex');
const fingerprint=code=>/^sha256:[a-f0-9]{64}$/.test(code)?code.slice(7):digest('E040723:',code);
const localIdentityHash=code=>digest('LOCAL:',code);

// Explicit evidence-backed exceptions only. Names discover candidates; hashes select identity.
function resolveLinks(rows,entries=registry){
  const result=rows.map(c=>{
    const matches=entries.filter(e=>e.custKey===c.CustKey),e=matches[0];
    const valid=matches.length===1&&e.name===c.CustName&&e.localIdentityHash===localIdentityHash(c.code)&&/^[a-f0-9]{64}$/.test(e.sourceHash);
    return {custKey:c.CustKey,name:c.CustName,managerUserId:c.managerUserId,managerMatchCount:c.managerMatchCount,
      managerName:c.managerMatchCount===1?c.managerName:null,active:true,accountActive:c.accountActive,identityEligible:valid||(!matches.length&&c.codeMatchCount===1),
      ecountCode:valid?'sha256:'+e.sourceHash:matches.length?'':/^\d{10}$/.test(c.code)?c.code:'',
      lookupName:valid?e.lookupName:null,lookupQuery:valid?e.lookupQuery:null,canonicalKey:valid?e.canonicalKey:c.CustKey,codeMatchCount:0,linked:false};
  });
  for(const c of result){
    if(!c.ecountCode)continue;
    const same=result.filter(r=>r.ecountCode&&fingerprint(r.ecountCode)===fingerprint(c.ecountCode));
    const primary=result.find(r=>r.custKey===c.canonicalKey);
    // All aliases must explicitly share one canonical active owner and source. No implicit dedup.
    const valid=c.identityEligible&&primary?.identityEligible&&primary.canonicalKey===primary.custKey&&primary.ecountCode&&
      fingerprint(primary.ecountCode)===fingerprint(c.ecountCode)&&
      same.every(r=>r.canonicalKey===c.canonicalKey&&(r.custKey===primary.custKey||
        (r.managerMatchCount===1&&primary.managerMatchCount===1&&r.managerUserId===primary.managerUserId)));
    c.codeMatchCount=valid?1:same.length>1?same.length:0;c.linked=!!valid;
    c.sharedLedgerName=valid&&same.length>1?primary.name:null;
  }
  return result;
}
function syncCustomer(c){return {custKey:c.custKey,sourceCode:c.ecountCode,...(c.lookupName?{lookupName:c.lookupName,lookupQuery:c.lookupQuery}: {})};}
module.exports={fingerprint,localIdentityHash,resolveLinks,syncCustomer};
