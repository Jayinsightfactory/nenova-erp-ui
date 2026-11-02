// File-only, reviewed labels. Existing current values always win over labels.
// Never copy historical transactions, selling prices or itemized bill amounts.
export function restoreCostResultLabels({values,profile,snapshot,rows,put}) {
 const add=(r,v)=>{if(!values.has(r)&&v!==undefined)put(r,v);};
 const sum=k=>rows.reduce((n,r)=>n+(Number(r.cost.componentAmounts[k])||0),0);
 const goods=rows.reduce((n,r)=>n+r.source.lineAmount,0);
 const compact=Boolean(profile.priceBasis)&&profile.id!=='EC_ORIGINAL_V1',us=profile.id==='US_ORIGINAL_V1',nz=profile.id==='NZ_ORIGINAL_V1';
 const valueCol=compact?(us||nz?'C':'D'):'C';
 add('B3','조회 결과는 고정값입니다. 입력·자동 수식은 「원본 양식 계산」 및 「원본수식 비교」 시트에서 확인하세요. 주황색 칸이 입력 대상입니다.');
 add(`B${compact?8:9}`,'품목 수');add(`${valueCol}${compact?8:9}`,rows.length);
 if(compact){
  add(us?'E4':'F4','금액 검산');add(us?'E5':'F5',sum('cnfNative'));
  if(profile.id==='AU_ORIGINAL_V1'){
   add('H5','적용 세율');add('I5',[...new Set(snapshot.input.lineInputs.map(l=>l.tariffRate))].map(v=>`${Number((v*100).toFixed(4))}%`).join(' / '));
   add('H6','세율 기준');add('I6','검증된 품목별 입력');add('H8','박스 수');
   const boxes=rows.map(r=>r.detail.boxQuantity);add('I8',boxes.every(v=>typeof v==='number'&&Number.isFinite(v))?boxes.reduce((a,b)=>a+b,0):'자료 없음');
  }
  if(us){for(const[r,v]of Object.entries({G4:'현재 포장 규격',G5:'구분',H5:'단당 송이',I5:'박스당 단',J5:'박스당 송이',G6:'공통/행별'}))add(r,v);
   const common=key=>{const v=snapshot.input.lineInputs.map(l=>l[key]);return v.every(n=>typeof n==='number'&&n===v[0])?v[0]:'행별';};
   const stems=common('stemsPerBunch'),bunches=common('bunchesPerBox');add('H6',stems);add('I6',bunches);add('J6',typeof stems==='number'&&typeof bunches==='number'?stems*bunches:'행별');
   add('E7','박스 수');const boxes=rows.map(r=>r.detail.boxQuantity);add('F7',boxes.every(v=>typeof v==='number')?boxes.reduce((a,b)=>a+b,0):'자료 없음');}
 }else if(profile.id==='NL_ORIGINAL_V1'){
  add('H5','금액 검산');add('H6',goods+sum('freightNative'));
  add('B12','총수량 (송이)');add('C12',rows.reduce((n,r)=>n+r.detail.stemQuantity,0));
  add('D9','운임 단가');add('E9','상세 미보유');add('D11','서류비');add('E11','상세 미보유 · 운임합계 적용');
  add('J5','원본 세율 참고 · 적용은 품목별 입력');
  for(const[r,name,rate]of [[6,'Eryngium',.25],[7,'Clematis',.25],[8,'Grevillea',.08],[9,'Kangoroo paw Red',.25],[10,'Delphinium noNL',.25],[11,'Cordyline',.08]]){add(`J${r}`,name);add(`K${r}`,rate);}
  for(const[r,name,rate]of [[6,'Colombia',.25],[7,'Africa',.25],[8,'Israel',.08],[9,'Sanguisorba',.25]]){add(`L${r}`,name);add(`M${r}`,rate);}
 }else if(profile.id==='TH_ORIGINAL_V1'){
  add('I5','현재 포장 요약');add('J6','박스');add('K6','기준 수량');
  const groups=snapshot.input.costGroups||[];
  for(const[i,g]of groups.slice(0,3).entries()){add(`I${7+i}`,g.groupId);add(`J${7+i}`,g.boxQuantity);add(`K${7+i}`,g.quantity);}
  add('I10','전체 합계');add('J10',groups.reduce((n,g)=>n+(g.boxQuantity||0),0));add('K10',groups.reduce((n,g)=>n+(g.quantity||0),0));
 }else if(profile.grouped&&profile.id!=='CN_SEA_ORIGINAL_V1'){
  add('B6',`상품합계 ${snapshot.input.nativeCurrency}`);add('C6',goods);
  add('H5','금액 검산');add('H6',goods+sum('freightNative'));
  add('D9','운임 단가');add('E9','상세 미보유');add('D11','서류비');add('E11','상세 미보유');
  add('J5','품목별 운임 요약');for(const[c,v]of Object.entries({J:'품목군',K:'운임 합계',L:'기준 수량',M:'단위 운임'}))add(`${c}6`,v);
  for(const[i,g]of(snapshot.input.costGroups||[]).slice(0,5).entries()){
   const r=7+i,ids=new Set(snapshot.input.lineInputs.filter(l=>l.groupId===g.groupId).map(l=>l.lineId));
   const freight=rows.filter(x=>ids.has(x.source.lineId)).reduce((n,x)=>n+(x.cost.componentAmounts.freightNative||0),0);
   add(`J${r}`,g.groupId);add(`K${r}`,freight);add(`L${r}`,g.quantity);add(`M${r}`,g.quantity>0?freight/g.quantity:'-');
  }
 }
}

// Highlight only missing current selling inputs; numeric zero is a valid input.
export function costSellingInputCue({sheet,profile,count,dxfId}) {
 const compact=profile.priceBasis&&profile.id!=='EC_ORIGINAL_V1';
 const col=['NL_ORIGINAL_V1','CN_SEA_ORIGINAL_V1','TH_ORIGINAL_V1'].includes(profile.id)?'R':profile.id==='US_ORIGINAL_V1'?'N':compact?'O':'Q';
 const first=profile.detailStartRow,last=first+count-1;
 const rule=`<conditionalFormatting sqref="${col}${first}:${col}${last}"><cfRule type="expression" dxfId="${dxfId}" priority="1"><formula>NOT(ISNUMBER(${col}${first}))</formula></cfRule></conditionalFormatting>`;
 sheet=sheet.replace(/(<c\b[^>]*r="B3"[^>]*>[\s\S]*?<t\b[^>]*>)([\s\S]*?)(<\/t>)/,(_,a,b,c)=>a+b+' · 주황색 칸: 기준가 계산에 필요한 값 확인. 숫자 입력 시 표시 해제.'+c);
 return sheet.replace(/<(?:pageMargins|pageSetup)\b|<\/worksheet>/,m=>rule+m);
}
export function appendCostInputDifferentialStyle(styles) {
 const dxf='<dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/><bgColor indexed="64"/></patternFill></fill></dxf>';
 const block=styles.match(/<dxfs\b([^>]*)>([\s\S]*?)<\/dxfs>/),empty=styles.match(/<dxfs\b[^>]*\/>/);
 const count=block?[...block[2].matchAll(/<dxf\b/g)].length:0;
 if(block)return {id:count,styles:styles.replace(block[0],`<dxfs count="${count+1}">${block[2]}${dxf}</dxfs>`)};
 const addition=`<dxfs count="1">${dxf}</dxfs>`;
 return {id:0,styles:empty?styles.replace(empty[0],addition):styles.replace(/<tableStyles\b|<colors\b|<extLst\b|<\/styleSheet>/,m=>addition+m)};
}

// Sea freight's real missing source drivers, not derived formula cells. A
// cancelled row needs no packing input. Never substitute guessed CBM or zero.
export function costRequiredSourceCue({sheet,profile,count,dxfId}) {
 if(profile.id!=='CN_SEA_ORIGINAL_V1')return sheet;
 const rule=`<conditionalFormatting sqref="W13:X${12+count}"><cfRule type="expression" dxfId="${dxfId}" priority="1"><formula>AND($B13&lt;&gt;0,OR(NOT(ISNUMBER(W13)),W13&lt;=0))</formula></cfRule></conditionalFormatting>`;
 return sheet.replace(/<(?:pageMargins|pageSetup)\b|<\/worksheet>/,m=>rule+m);
}
