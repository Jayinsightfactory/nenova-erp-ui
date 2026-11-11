// Excel presentation only. Never use shortened labels as grouping or ERP keys.
const countries=['콜롬비아','중국','에콰도르','네덜란드','태국','미국','케냐','호주','베트남','이스라엘','남아공','페루','이탈리아','뉴질랜드','colombia','china','ecuador','netherlands','holland','thailand','usa','united states','kenya','australia','vietnam','israel','south africa','peru','italy','new zealand'];
const aliases={카네이션:['carnation','spray carnation'],장미:['rose','spray rose'],수국:['hydrangea']};
const normalize=s=>String(s??'').trim().replace(/\s+/g,' ').toLocaleLowerCase();
function tokens(row){return [...new Set([row.flower,row.country,...(aliases[row.flower]??[]),...countries].map(normalize).filter(Boolean))].sort((a,b)=>b.length-a.length);}
function stripPrefix(text,labels){
 let rest=text.trim(),changed=false;const removed=[];
 while(rest){const key=labels.find(k=>normalize(rest)===k||normalize(rest).startsWith(k+' '));if(!key)break;
  // Work on normalized whitespace, but preserve the actual cultivar spelling.
  const words=key.split(' ').length,match=rest.match(new RegExp('^(?:\\S+\\s+){'+(words-1)+'}\\S+'));
  rest=rest.slice(match[0].length).trim();changed=true;removed.push(key);
 }return {rest,changed,removed};
}
function categoryLabel(group){
 const country=String(group.country??'').trim(),flower=String(group.flower??'').trim();
 if(country==='국내'&&flower==='왁스')return '운임비';
 return flower||country;
}
function categoryDisplayLabel(group){
 const country=String(group.country??'').trim();
 return country==='국내'&&String(group.flower??'').trim()==='왁스'?'운임비':`${country} ${categoryLabel(group)}`.trim();
}
function itemLabel(row){
 const original=String(row.name??row.originalName??'').trim();if(!original)return original;
 const labels=tokens(row),parts=original.split(/\s*[／/]\s*/);let structured=false;
 while(parts.length>1){const p=stripPrefix(parts[0],labels);if(!p.changed||p.rest)break;parts.shift();structured=true;}
 const joined=parts.join(' / '),prefix=stripPrefix(joined,labels),flowerTokens=[row.flower,...(aliases[row.flower]??[])].map(normalize),shortened=prefix.rest&&prefix.removed.some(k=>flowerTokens.includes(k));let name=shortened?prefix.rest:joined;
 // ERP's structured 'classification / Korean name (English alias)' convention.
 // Preserve sizes, colors and grades; unknown Korean notes remain visible.
 if(structured||shortened||/[가-힣]/.test(name)){const m=name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if(m&&m[1].trim()){
   const base=m[1].trim(),note=m[2].trim(),same=normalize(note)===normalize(base);
   const spec=/\d|^(?:XL|XXL|XS|SP|SPRAY|L|M|S|premium|standard|bunch|box|stem|stems|pot|pots|assorted|tinted|dyed|white|pink|red|blue|green|yellow|orange|purple|mix|cream)$/i.test(note);
   const english=/[A-Za-z]/.test(note)&&/^[A-Za-z\s.'’\-]+$/.test(note);
   const repeated=normalize(note).startsWith(normalize(base)+' ')&&/^[A-Za-z\s]+$/.test(note.slice(base.length));
   if(!spec&&(same||english||repeated))name=base;
  }
 }
 return name||original;
}
module.exports={categoryLabel,categoryDisplayLabel,itemLabel};
