import {useRouter} from 'next/router';

export function goBackFromMenu(router){
  if(typeof window==='undefined')return;
  if(window.history.length>1){router.back();return;}
  try{if(window.opener&&window.opener!==window){window.close();return;}}catch{}
  router.push('/dashboard');
}

export default function MenuBackButton({standalone=false}){
  const router=useRouter();
  return <><button
      type="button"
      data-ui-back-button
      className={standalone?'nv-standalone-back':''}
      onClick={()=>goBackFromMenu(router)}
      title="이전 화면으로"
      aria-label="뒤로가기"
    >← 뒤로가기</button>{standalone&&<style jsx>{`
    .nv-standalone-back{position:fixed;right:12px;top:34px;z-index:20000;border:1px solid #7292ba;border-radius:6px;background:#fff;color:#173f73;padding:5px 10px;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(16,45,82,.2);cursor:pointer}
    .nv-standalone-back:hover{background:#edf5ff}
    @media(max-width:760px){.nv-standalone-back{right:7px;top:31px;padding:4px 7px;font-size:11px}}
  `}</style>}</>;
}
