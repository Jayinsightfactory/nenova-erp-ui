// This function is serialized into the SRM main world. All dependencies must be local.
// Adapter evidence: SRM es-sh-sp-gr-detail.html onFindList/completeFindList, 2026-10-20.
export async function collectReceipts(from,to) {
  const fail=error=>({success:false,error});
  if(location.origin!=='https://www.shillasrm.com' || location.pathname!=='/afterLoginOK.do') return fail('신라 로그인 상태를 확인하세요.');
  const page=document.querySelector('es-sh-sp-gr-detail');
  const ajax=page?.querySelector('sc-ajax#findListGrSp');
  if(!page || !ajax || typeof page.onFindList!=='function' || typeof page.set!=='function') return fail('신라의 발주/입고 → 입고실적 탭을 열어주세요.');
  if(new URL(ajax.getAttribute('url'),location.href).pathname!=='/ui/sp/pro/gr/findGrSpListEai.do') return fail('신라 조회 화면이 변경되어 연결 확인이 필요합니다.');
  const rows=[],slices=[];
  const date=value=>new Date(`${value}T12:00:00`);
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let cursor=date(from);
  try {
    while(iso(cursor)<=to) {
      const start=iso(cursor), end=iso(new Date(cursor.getFullYear(),cursor.getMonth()+1,0,12))<to?iso(new Date(cursor.getFullYear(),cursor.getMonth()+1,0,12)):to;
      const response=await new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);ajax.removeEventListener('response',done);ajax.removeEventListener('error',error);};
        const done=event=>{
          cleanup();
          if(typeof page.get==='function' && (String(page.get('searchParam.i_fdate'))!==start.replaceAll('-','') || String(page.get('searchParam.i_tdate'))!==end.replaceAll('-',''))) {reject(new Error('조회 중 신라 날짜 조건이 바뀌었습니다. 다시 조회하세요.'));return;}
          resolve(event.detail?.response);
        };
        const error=()=>{cleanup();reject(new Error('신라 조회가 실패했습니다. 로그인 상태를 확인하세요.'));};
        const timer=setTimeout(()=>{cleanup();reject(new Error('신라 조회가 45초 안에 끝나지 않았습니다. 다시 조회하세요.'));},45000);
        ajax.addEventListener('response',done);ajax.addEventListener('error',error);
        try {
          page.set('searchParam.fdate',date(start));page.set('searchParam.tdate',date(end));page.set('searchParam.i_werks','');
          page.onFindList();
        } catch(e){cleanup();reject(e);}
      });
      if(!response || !response.HEADER || ['9999','9998','0900'].includes(String(response.HEADER.result_code)) || !Array.isArray(response.lt_srmif6_re)) throw new Error('신라 로그인 만료 또는 조회 오류입니다. 재로그인 후 다시 조회하세요.');
      const text=v=>String(v??'').trim();
      for(const r of response.lt_srmif6_re) {
        const raw=text(r.budat).replace(/[^0-9]/g,'');
        const receiptDate=`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
        if(raw.length!==8 || receiptDate<start || receiptDate>end) throw new Error('신라 응답 기간이 요청과 다릅니다. 조회를 다시 실행하세요.');
        rows.push({date:receiptDate,site:text(r.werks_na),receiptNo:text(r.belnr),receiptItem:text(r.buzei),code:text(r.matnr),name:text(r.maktx),spec:text(r.groes),unit:text(r.meins),qty:r.menge,price:r.netpr,amount:r.wrbtr});
      }
      if(rows.length>50000) throw new Error('입고자료가 50,000행을 초과합니다. 조회기간을 줄이세요.');
      slices.push({from:start,to:end,count:response.lt_srmif6_re.length});
      cursor=date(end);cursor.setDate(cursor.getDate()+1);
    }
    return {success:true,rows,source:{origin:location.origin,from,to,complete:true,readAt:new Date().toISOString(),slices}};
  } catch(error) {return fail(error.message);}
}
