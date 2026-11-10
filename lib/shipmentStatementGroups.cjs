// Browser draft only: preserve membership of every unselected category.
function assignGroup(groups,selected,name){
 const chosen=new Set(selected),label=String(name??'').trim();
 if(!chosen.size)return groups;
 const next=groups.map(g=>({...g,categories:g.categories.filter(k=>!chosen.has(k))})).filter(g=>g.categories.length);
 if(!label)return next;
 if(label.length>60)throw Error('묶음 이름은 60자 이내로 입력하세요.');
 const target=next.find(g=>g.name===label);
 if(target)target.categories=[...new Set([...target.categories,...chosen])];else next.push({name:label,categories:[...chosen]});
 return next;
}
function suggestedName(categories,selected,groups){
 const chosen=new Set(selected),base=categories.filter(c=>chosen.has(c.key)).map(c=>c.label).join('·').slice(0,52)||'새 묶음';
 let name=base,n=2;while(groups.some(g=>g.name===name))name=`${base} (${n++})`;return name;
}
module.exports={assignGroup,suggestedName};
