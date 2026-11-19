export function compactFieldRows(wb, source, slots) {
  if(![...slots].some(([row,count])=>count<=2&&slots.has(row+1)&&slots.get(row+1)<=2))return source;
  const ws=wb.addWorksheet('압축',{pageSetup:{...source.pageSetup},views:[{state:'frozen',ySplit:2}]});
  [30,2,57.54,57.54,57.545,7,7,7,7].forEach((width,i)=>{ws.getColumn(i+1).width=width;});
  ws.getColumn(2).hidden=true;
  for(let c=10;c<=21;c++)ws.getColumn(c).hidden=true;
  const map=new Map(), pending=[];
  const copy=(from,row,col)=>{
    const to=ws.getCell(row,col);to.style=JSON.parse(JSON.stringify(from.style));to.value=from.value;
    map.set(from.address,to.address);if(from.formula)pending.push([from,to]);return to;
  };
  for(let r=1;r<=source.rowCount;r++){
    const pack=[];
    if(slots.has(r)&&slots.get(r)<=2){
      pack.push(r);
      while(pack.length<3&&slots.has(r+1)&&slots.get(r+1)<=2)pack.push(++r);
    }
    const out=ws.addRow([]);
    if(pack.length>1){
      out.getCell(1).value='품종별 출고';out.getCell(1).style=source.getCell(pack[0],1).style;
      pack.forEach((old,i)=>{
        const label=source.getCell(old,1).text,body=source.getCell(old,3),cell=out.getCell(3+i);
        cell.style=JSON.parse(JSON.stringify(body.style));
        const nums=[];
        for(let c=4;c<=7;c++){
          const n=source.getCell(old,c);copy(n,out.number,10+i*4+c-4);
          nums.push(n.result??n.value??'');
        }
        cell.value={richText:[{text:label+'  ',font:{name:'맑은 고딕',size:10,bold:true}},...(body.value?.richText||[{text:body.text}]),{text:'\n입 '+nums[0]+' 출 '+nums[1]+' 재 '+nums[2]+' 잔 '+nums[3]}]};
      });
      for(let c=0;c<4;c++){
        const refs=pack.map((_,i)=>ws.getCell(out.number,10+i*4+c));
        const cell=out.getCell(6+c);
        cell.style=JSON.parse(JSON.stringify(source.getCell(pack[0],4+c).style));
        // Restore source mapping to its individual backing value, never the group sum.
        map.set(source.getCell(pack[0],4+c).address,refs[0].address);
        cell.value={formula:'SUM('+refs.map(x=>x.address).join(',')+')',result:pack.reduce((n,old)=>n+Number(source.getCell(old,4+c).result??source.getCell(old,4+c).value??0),0)};
      }
      out.height=Math.min(409,Math.max(...pack.map(old=>{
        const text=source.getCell(old,1).text+'  '+source.getCell(old,3).text;
        return 17+text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((s,ch)=>s+(ch.charCodeAt(0)>255?14:8),0)/390)),0)*15;
      })));
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
  return ws;
}
