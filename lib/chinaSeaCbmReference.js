import {createHash} from 'node:crypto';
import reference from './invoiceCostTemplates/china-sea-cbm-reference-v1.json' with {type:'json'};
const {assetHash,...payload}=reference;
if(assetHash!=='1ebffebafcb0f60b4d913b720bec63f02edba02ca51c4ce3d3cf315ba54b34f1'||createHash('sha256').update(JSON.stringify(payload)).digest('hex')!==assetHash)throw Error('Unverified China sea CBM reference');
const normalize=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
// A historical package is not a country-wide volume default. Different packing
// counts, ambiguous names and explicit invalid values must remain reviewable.
export function chinaSeaCbmDefault({profile,source,detail,setting}){
 if(profile.id!=='CN_SEA_ORIGINAL_V1'||profile.sourceHash!==reference.sourceHash||profile.sourceSheet!==reference.sourceSheet)return null;
 if(setting.boxCbm!==undefined&&setting.boxCbm!==null&&setting.boxCbm!=='')return null;
 const keys=new Set([source.originalName,source.prodName,source.matchedProdName,detail.prodName].filter(Boolean).map(normalize));
 const matches=reference.records.filter(r=>keys.has(normalize(r.name))&&r.bunchesPerBox===setting.bunchesPerBox);
 if(!matches.length||new Set(matches.map(r=>r.boxCbm)).size!==1)return null;
 return {...matches[0],basis:`기존 ${reference.sourceSheet} · ${matches[0].sourceCell} · ${matches[0].dimensionsCm}cm · 참고 기본값`};
}
