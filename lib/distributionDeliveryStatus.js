// Delivery evidence is distinct from ERP application evidence. Never infer a
// delivery from partial text, edited summaries, approximate dates or duplicates.
const DELIVERY_ROOM='현장 추가취소방';
function normalizedDeliveryText(value) {
  return typeof value==='string'?value.normalize('NFC').replace(/\s+/gu,' ').trim():'';
}
function fullDeliveryText(value) {
  return typeof value==='string'&&value.length<=20000&&normalizedDeliveryText(value)!==''&&!/(?:\.\.\.|…|생략|truncated|\[더보기\])/iu.test(value);
}
function deliveryIdentity(row) {
  return row?.source==='nenovakakao'&&typeof row.chat_id==='string'&&row.chat_id&&typeof row.external_message_id==='string'&&row.external_message_id?`${row.source}|${row.chat_id}|${row.external_message_id}`:'';
}
function exactDeliveryTime(row,year) {
  const value=row?.created_at;
  if(row?.timestamp_approximate===true||row?.truncated===true||row?.is_truncated===true||typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value))return null;
  const timestamp=Date.parse(value);
  if(!Number.isFinite(timestamp))return null;
  const calendar=new Date(`${value.slice(0,10)}T00:00:00Z`);
  if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==value.slice(0,10))return null;
  const kstYear=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date(timestamp));
  return kstYear===String(year)?timestamp:null;
}
function sourceDeliveryReason(source,year) {
  if(!deliveryIdentity(source)||deliveryIdentity(source)!==source.identity||source.chatroom!=='영업방')return 'source_metadata';
  if(!fullDeliveryText(source.message)||source.truncated===true||source.is_truncated===true)return 'incomplete';
  if(source.timestamp_approximate===true)return 'source_time_approximate';
  if(exactDeliveryTime(source,year)===null)return 'source_time_invalid';
  return '';
}
const DELIVERY_REASON_LABELS={source_metadata:'원본 식별 정보 확인 필요',incomplete:'원문 잘림 확인 필요',source_time_approximate:'원본 시각이 추정값',source_time_invalid:'원본 시각·연도 확인 필요',no_target:'최근 7일 동일 전송 없음',ambiguous:'동일 원문 중복 확인 필요'};
function matchDeliveryStatus({sources,targets,year}) {
  const texts=new Map(),identities=new Map();
  for(const row of sources){const text=normalizedDeliveryText(row.message);texts.set(text,(texts.get(text)||0)+1);identities.set(row.identity,(identities.get(row.identity)||0)+1);}
  return sources.map(source=>{
    const base={identity:source.identity,status:'UNCONFIRMED',reason:'no_target'};
    const identity=deliveryIdentity(source),text=normalizedDeliveryText(source.message),at=exactDeliveryTime(source,year);
    const reason=sourceDeliveryReason(source,year);
    if(reason)return {...base,reason};
    if(texts.get(text)!==1||identities.get(source.identity)!==1)return {...base,status:'AMBIGUOUS',reason:'ambiguous'};
    const candidates=targets.filter(target=>{
      const targetIdentity=deliveryIdentity(target),targetAt=exactDeliveryTime(target,year);
      return targetIdentity&&targetIdentity!==identity&&target.chatroom===DELIVERY_ROOM&&fullDeliveryText(target.message)&&targetAt!==null&&targetAt>=at&&normalizedDeliveryText(target.message)===text;
    });
    if(candidates.length>1)return {...base,status:'AMBIGUOUS',reason:'ambiguous'};
    if(candidates.length!==1)return base;
    return {...base,status:'DELIVERED',reason:'',deliveryIdentity:deliveryIdentity(candidates[0]),deliveredAt:candidates[0].created_at};
  });
}
module.exports={sourceDeliveryReason,DELIVERY_REASON_LABELS,DELIVERY_ROOM,normalizedDeliveryText,fullDeliveryText,deliveryIdentity,exactDeliveryTime,matchDeliveryStatus};
