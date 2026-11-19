export const inventoryText=nums=>' [입'+nums[0]+' /출'+nums[1]+' /재'+nums[2]+' 잔'+nums[3];
export function printHeight(text,width){return Math.min(409,8+String(text).split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((s,ch)=>s+(ch.charCodeAt(0)>255?14:8),0)/(width-16))),0)*16);}
export function compactFieldRows(wb, source, slots) {
  const finish=(sheet,productRows)=>{
    for(const r of productRows){
      const row=sheet.getRow(r),cell=row.getCell(3);
      if(cell.isMerged||sheet===source){
        const nums=[sheet===source?4:6,sheet===source?5:7,sheet===source?6:8,sheet===source?7:9].map(c=>row.getCell(c).result??row.getCell(c).value??'');
        const runs=cell.value?.richText||[{text:cell.text}],result=[];let inserted=false;
        for(const run of runs){const at=run.text.indexOf('\n');if(!inserted&&at>=0){result.push({...run,text:run.text.slice(0,at)},{text:inventoryText(nums)},{...run,text:run.text.slice(at)});inserted=true;}else result.push(run);}
        if(!inserted)result.push({text:inventoryText(nums)});
        cell.value={richText:result.filter(run=>run.text.length>0)};
        row.height=Math.max(row.height||0,printHeight(cell.text,1170));
      }
      for(const col of [1,3,4,5,6,7,8,9]){
        const target=row.getCell(col);if(target.isMerged&&target.master.address!==target.address)continue;
        target.font={...target.font,name:'맑은 고딕',size:10};
        if(target.value?.richText)target.value={richText:target.value.richText.map(run=>({...run,font:{...run.font,name:'맑은 고딕',size:10}}))};
        target.alignment={...target.alignment,shrinkToFit:false,...(col===3||col===4||col===5?{vertical:'top',wrapText:true}:{})};
      }
    }
    return sheet;
  };
  if(![...slots].some(([row,count])=>count<=2&&slots.has(row+1)&&slots.get(row+1)<=2))return finish(source,[...slots.keys()]);
  const ws=wb.addWorksheet('압축',{pageSetup:{...source.pageSetup},views:[{state:'frozen',ySplit:2}]});
  [30,2,57.54,57.54,57.545,7,7,7,7].forEach((width,i)=>{ws.getColumn(i+1).width=width;});
  ws.getColumn(2).hidden=true;
  for(let c=10;c<=21;c++)ws.getColumn(c).hidden=true;
  const map=new Map(), pending=[],productRows=[];
  const lines=row=>source.getCell(row,3).text.split('\n').filter(Boolean);
  const span=row=>lines(row).length===2?2:1;
  const copy=(from,row,col)=>{
    const to=ws.getCell(row,col);to.style=JSON.parse(JSON.stringify(from.style));to.value=from.value;
    map.set(from.address,to.address);if(from.formula)pending.push([from,to]);return to;
  };
  for(let r=1;r<=source.rowCount;r++){
    const pack=[];
    if(slots.has(r)&&slots.get(r)<=2){
      pack.push(r);
      let used=span(r);
      while(slots.has(r+1)&&slots.get(r+1)<=2&&used+span(r+1)<=3){used+=span(r+1);pack.push(++r);}
    }
    const out=ws.addRow([]);
    if(pack.length||slots.has(r))productRows.push(out.number);
    if(pack.length>1||(pack.length===1&&span(pack[0])===2)){
      out.getCell(1).value='품종별 출고';out.getCell(1).style=source.getCell(pack[0],1).style;
      let lane=0;
      pack.forEach((old,i)=>{
        const label=source.getCell(old,1).text,body=source.getCell(old,3),cell=out.getCell(3+lane);
        cell.style=JSON.parse(JSON.stringify(body.style));
        const nums=[];
        for(let c=4;c<=7;c++){
          const n=source.getCell(old,c);copy(n,out.number,10+i*4+c-4);
          nums.push(n.result??n.value??'');
        }
        const groups=[[]];
        for(const run of body.value?.richText||[{text:body.text}]){
          const parts=run.text.split('\n');
          parts.forEach((text,j)=>{if(j)groups.push([]);if(text)groups[groups.length-1].push({...run,text});});
        }
        const metric={text:inventoryText(nums),font:{name:'맑은 고딕',size:10}};
        cell.value={richText:[{text:label+'  ',font:{name:'맑은 고딕',size:10,bold:true}},...(span(old)===2?groups[0]:body.value?.richText||[{text:body.text}]),metric]};
        if(span(old)===2){const next=out.getCell(4+lane);next.style=JSON.parse(JSON.stringify(body.style));next.value={richText:groups[1]};}
        lane+=span(old);
      });
      for(let c=0;c<4;c++){
        const refs=pack.map((_,i)=>ws.getCell(out.number,10+i*4+c));
        const cell=out.getCell(6+c);
        cell.style=JSON.parse(JSON.stringify(source.getCell(pack[0],4+c).style));
        // Restore source mapping to its individual backing value, never the group sum.
        map.set(source.getCell(pack[0],4+c).address,refs[0].address);
        cell.value={formula:'SUM('+refs.map(x=>x.address).join(',')+')',result:pack.reduce((n,old)=>n+Number(source.getCell(old,4+c).result??source.getCell(old,4+c).value??0),0)};
      }
      out.height=Math.max(...[3,4,5].map(c=>printHeight(out.getCell(c).text,390)));
      for(const c of [3,4,5])out.getCell(c).alignment={...out.getCell(c).alignment,vertical:'top',wrapText:true,shrinkToFit:false};
    }else{
      const old=source.getRow(r);out.height=old.height;
      for(let c=1;c<=7;c++){
        const from=old.getCell(c);if(from.isMerged&&from.master.address!==from.address)continue;
        const col=c<=3?c:c+2;
        copy(from,out.number,col);
        if(c===3)ws.mergeCells(out.number,3,out.number,5);
        if(c===1&&source.getCell(r,7).master.address===from.address)ws.mergeCells(out.number,1,out.number,9);
      }
    }
  }
  for(const [from,to] of pending){
    const range=from.formula.match(/^SUM\(([A-Z]+)(\d+):\1(\d+)\)$/);
    const formula=range?'SUM('+Array.from({length:+range[3]-+range[2]+1},(_,i)=>map.get(range[1]+(+range[2]+i))).filter(Boolean).join(',')+')':from.formula.replace(/\b[A-Z]+\d+\b/g,ref=>map.get(ref)||ref);
    to.value={formula,result:from.result};
  }
  ws.pageSetup.printArea='A1:I'+ws.rowCount;
  wb.removeWorksheet(source.id);ws.name='현장물량표';
  return finish(ws,productRows);
}
