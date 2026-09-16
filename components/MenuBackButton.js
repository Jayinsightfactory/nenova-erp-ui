import {useRouter} from 'next/router';
import {requestContextualMenuBack,takePreviousMenuRoute} from '../lib/menuNavigationHistory';

export function goBackFromMenu(router){
  if(typeof window==='undefined')return;
  const previous=takePreviousMenuRoute(router.asPath,window.sessionStorage);
  if(previous){router.push(previous);return;}
  let childWindow=false;
  try{childWindow=Boolean(window.opener&&window.opener!==window);}catch{childWindow=true;}
  // 새창의 history에는 about:blank/로그인 redirect가 섞일 수 있어 back()이 창을 닫을 수 있다.
  // 메뉴 이동 기록이 없는 새창에서는 닫지 않고 ERP 홈으로 이동한다.
  if(!childWindow&&window.history.length>1){router.back();return;}
  router.push('/dashboard');
}

export function handleMenuBack(router){
  if(typeof window==='undefined')return;
  if(requestContextualMenuBack(window))return;
  goBackFromMenu(router);
}

export default function MenuBackButton({standalone=false}){
  const router=useRouter();
  return <><button
      type="button"
      data-ui-back-button
      className={standalone?'nv-standalone-back':''}
      onClick={()=>handleMenuBack(router)}
      title="이전 화면으로"
      aria-label="뒤로가기"
    >← 뒤로가기</button>{standalone&&<style jsx>{`
    .nv-standalone-back{position:fixed;right:12px;top:34px;z-index:20000;border:1px solid #7292ba;border-radius:6px;background:#fff;color:#173f73;padding:5px 10px;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(16,45,82,.2);cursor:pointer}
    .nv-standalone-back:hover{background:#edf5ff}
    @media(max-width:760px){.nv-standalone-back{right:7px;top:31px;padding:4px 7px;font-size:11px}}
  `}</style>}</>;
}
