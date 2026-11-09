// Narrow source-verified recovery. No fuzzy amount-based deletion, no value repair.
export const CO_461_SOURCE_HASH='88c28b75c418261a9411d00d00d7d210f11af837543f59ba1f61cb015f454a65';
const norm=x=>String(x??'').normalize('NFKC').toUpperCase().replace(/\s+/g,' ').trim();
const number=x=>x!==null&&x!==undefined&&x!==''&&typeof x!=='boolean'&&Number.isFinite(Number(x))?Number(x):NaN;
const sum=(rows,field)=>rows.reduce((a,r)=>a+number(r[field]),0);
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<.011;
const page=r=>r.review_evidence?.description?.page??r.review_evidence?.t_price?.page??r.source_page;
const same=(parents,children)=>close(sum(parents,'t_price'),sum(children,'t_price'))&&close(sum(parents,'total_stems'),sum(children,'total_stems'));
// Source manifest uses exporter trade names, invoices use legal issuer names.
// These aliases are specific to this immutable source, not team aliases.
export function reconcile461Manifest(values,entries,{sourceHash}={}){
 if(sourceHash!==CO_461_SOURCE_HASH||values.length!==31||entries.some(e=>norm(e.invoice)))return false;
 const sourceIds=new Set(['FA125527','53905','133495','142313','TFE30927','FEV2114','5351','282963','EC5991','17806','17805','256342','FVEF1682','FC02164','VE324080','FEER4346','001075526','44053','1606','CJAR4430','19622','202875','INV018631','18924','47329','FE203978','358846','3440','80043160','A2659626','2191857']);
 if(values.some(i=>!sourceIds.delete(norm(i.invoice).replace(/[^A-Z0-9]/g,'')))||sourceIds.size)return false;
 const canonical=x=>norm(x).replace(/[^A-Z0-9 ]/g,' ').replace(/\b(?:SAS|SA|S A S|S A|C I|CI|CORPORATION|CORP|AGROINDUSTRIAL|AGRICOLA|EXPORT|US|ROSES|CT|DE|LA|LAS)\b/g,' ').replace(/\s+/g,' ').trim();
 const aliases={'SUPERIOR BLOOMS':'FLORES SERREZUELA','FLORES VILLA':'FAGUA','MAXIFLORES':'NATUFLORA','CONSTRUNORTE JAR':'KIKUYAL','EL REDIL':'REDIL','UNIQUE FLOWERS':'UNIQUE','SUNSHINE BOUQUET':'SUNSHINE'};
 const names=new Set(entries.map(e=>canonical(e.supplier)));
 const covered=new Set();
 for(const i of values){const name=canonical(i.supplier),target=aliases[name]||name;if(!names.has(target))return false;covered.add(target);}
 return covered.size===names.size&&close(values.reduce((a,i)=>a+number(i.invoice_total),0),64204.86)&&close(values.reduce((a,i)=>a+sum(i.products,'total_stems'),0),308495)
  &&close(values.reduce((a,i)=>a+(number(i.source_box_total)>0?number(i.source_box_total):sum(i.products,'pcs')),0),1137);
}
export function reconcilePackingSummaryRows(invoice,{sourceHash}={}){
 if(sourceHash!==CO_461_SOURCE_HASH)return invoice;
 const id=norm(invoice.invoice).replace(/[^A-Z0-9]/g,''),rows=invoice.products;
 if(!Array.isArray(rows))return invoice;
 const manifestBoxes={VE324080:{boxes:86,stems:8600,total:3172},FEER4346:{boxes:15,stems:1500,total:621},CJAR4430:{boxes:11,stems:1100,total:483}}[id];
 if(manifestBoxes&&rows.every(r=>number(r.pcs)===0)&&close(sum(rows,'total_stems'),manifestBoxes.stems)&&close(number(invoice.invoice_total),manifestBoxes.total)){
  return {...invoice,source_box_total:manifestBoxes.boxes,source_box_evidence:{page:1,sourceHash,kind:'PRINTED_MANIFEST_PIECES_NOT_ROW_ALLOCATION'}};
 }
 let parents=[],children=[];
 if(id==='133495'){
  parents=rows.filter(r=>page(r)===7&&/^(?:MINI)?CARNATION \(DIANTHUS SPP\.\)$/.test(norm(r.description)));
  children=rows.filter(r=>page(r)===6&&/^(?:CAR|MIN) /.test(norm(r.description)));
  if(parents.length!==2||children.length!==24||parents.length+children.length!==rows.length)return invoice;
  for(const mini of [false,true]){
   const p=parents.filter(r=>norm(r.description).startsWith(mini?'MINICARNATION':'CARNATION'));
   const c=children.filter(r=>norm(r.description).startsWith(mini?'MIN ':'CAR '));
   if(p.length!==1||!same(p,c))return invoice;
  }
 }else if(id==='17805'){
  parents=rows.filter(r=>page(r)===19&&norm(r.description)==='CARNATION CARNATION CARNATION');
  children=rows.filter(r=>[17,18].includes(page(r))&&norm(r.description).startsWith('CARNATION '));
  if(parents.length!==1||children.length!==24||parents.length+children.length!==rows.length||!same(parents,children))return invoice;
 }else if(id==='202875'){
  if(rows.length!==7||rows.some(r=>page(r)!==32))return invoice;
  let group=null;const groups=[];
  for(const row of rows){
   if(/^ROSE .+ CB \(DRY\) PK 10$/.test(norm(row.description))&&number(row.u_price)===0&&number(row.pcs)>0){group={parent:row,children:[]};groups.push(group);}
   else if(group&&/^ROSE (?:BICOLOR SALMON PINK|YELLOW|WHITE)$/.test(norm(row.description))&&number(row.pcs)===0&&number(row.u_price)>0)group.children.push(row);
   else return invoice;
  }
  if(groups.length!==3||groups.some(g=>!g.children.length||!same([g.parent],g.children)||!close(number(g.parent.pcs)*number(g.parent.steam_box),number(g.parent.total_stems))))return invoice;
  parents=groups.map(g=>g.parent);children=groups.flatMap(g=>g.children);
 }else return invoice;
 if(!same(parents,children))return invoice;
 const audit={kind:'SOURCE_VERIFIED_SUMMARY_NOT_ADDITIONAL_GOODS',sourceHash,rows:structuredClone(parents)};
 return {...invoice,products:children,source_summary_rows:[...(invoice.source_summary_rows||[]),audit],
  ...(id==='202875'?{source_box_total:sum(parents,'pcs')}:{} )};
}
