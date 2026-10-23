// Shared Product.Descr, not a web-only color column. Unknown prose is preserved.
const COLORS = /^(화이트|흰색|백색|핑크|연핑크|진핑크|블루|파랑|레드|빨강|옐로우|노랑|그린|초록|퍼플|보라|라벤더|오렌지|주황|버건디|크림|살몬|피치|믹스|white|pink|blue|red|yellow|green|purple|lavender|orange|burgundy|cream|salmon|peach|mix)$/i;
export function productColorLabel(descr) {
  const head=String(descr??'').split(/[\/／]/)[0].trim();
  if(COLORS.test(head))return head;
  if(!/[가-힣]/.test(head)||/[0-9]|\bmoq\b|시즌|월|단색|단당|박스|스템|길이|원산지|최소|주문|포장/i.test(head))return '';
  return head.replace(/\s{2,}/g,' ');
}
export function productColorDescription(descr, color) {
  if(typeof color!=='string'||!color.trim()||color.trim().length>40||/[\/／\r\n\x00-\x1f]/.test(color))throw Error('칼라는 1~40자이며 줄바꿈이나 /를 넣을 수 없습니다.');
  if(productColorLabel(color)!==color.trim())throw Error('칼라는 한글 색상명 또는 기본 영문 색상명으로 입력하세요. 규격·포장 설명은 비고에 보존됩니다.');
  const original=String(descr??'');
  const head=original.split(/[\/／]/)[0];
  const next=COLORS.test(head.trim()) ? color.trim()+(head.match(/\s+$/)?.[0]||'')+original.slice(head.length) : color.trim()+(original?' / '+original:'');
  if(next.length>200)throw Error('기존 품목 비고를 보존하면 200자를 넘습니다. 품목 비고를 먼저 확인하세요.');
  return next;
}

export async function saveProductColor(q,sql,body,actor) {
  if(!Number.isSafeInteger(body?.prodKey)||body.prodKey<=0||!Object.hasOwn(body,'expectedDescr')||(body.expectedDescr!==null&&typeof body.expectedDescr!=='string'))throw Error('품목 번호와 기존 비고를 다시 조회하세요.');
  const params={pk:{type:sql.Int,value:body.prodKey}};
  const before=(await q('SELECT * FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk AND isDeleted=0',params)).recordset[0];
  if(!before||(before.Descr??null)!==body.expectedDescr){const e=Error('품목 비고가 변경되었습니다. 다시 조회 후 저장하세요.');e.status=409;throw e;}
  const descr=productColorDescription(before.Descr,body.color);
  if(descr===before.Descr)return {prodKey:body.prodKey,descr};
  await q('UPDATE Product SET Descr=@descr,LastUpdateID=@actor,LastUpdateDtm=GETDATE() WHERE ProdKey=@pk AND isDeleted=0',{...params,descr:{type:sql.NVarChar(200),value:descr},actor:{type:sql.NVarChar(50),value:String(actor).slice(0,50)}});
  const after=(await q('SELECT * FROM Product WHERE ProdKey=@pk AND isDeleted=0',params)).recordset[0];
  if(!after||after.Descr!==descr||Object.keys(before).filter(k=>!['Descr','LastUpdateID','LastUpdateDtm'].includes(k)).some(k=>JSON.stringify(before[k])!==JSON.stringify(after[k])))throw Error('품목 저장 후 보존값 대조 실패');
  await q("INSERT INTO SystemActionLog (Actor,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel) VALUES (@actor,'PRODUCT_COLOR_EDIT','POST','/api/master/product-color','Product',1,@payload,'SUCCESS',N'품목 비고 칼라 저장 및 보호필드 대조','HIGH')",{actor:{type:sql.NVarChar(100),value:String(actor).slice(0,100)},payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify({prodKey:body.prodKey,before:before.Descr,after:descr})}});
  return {prodKey:body.prodKey,descr};
}
