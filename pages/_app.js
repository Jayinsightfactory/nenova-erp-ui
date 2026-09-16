import Layout, { MENU_ITEMS } from '../components/Layout';
import MenuBackButton from '../components/MenuBackButton';
import '../styles/globals.css';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { MENU_PAGE_RESET_EVENT } from '../lib/menuNavigationHistory';

const NO_LAYOUT = [
  '/login',
  '/',
  '/shipment/week-pivot',
  '/stats/pivot',
  '/catalog',
  '/catalog/print',
  '/incoming-price',
  '/admin/category-overrides',
  '/admin/orbit-report',
  '/orders/paste',
  '/orders/paste-template',
  '/orders/mapping-status',
  '/orders/kakao-audit',
  '/sales/defect-deductions',
  '/sales/defect-deduction-register-review',
  '/sales/customs-clearance',
  '/sales/forwarding-clearance',
];
const STANDALONE_MENU_BACK_ROUTES = new Set(['/shipment/week-pivot', '/stats/pivot', '/catalog']);

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [menuPageRevision, setMenuPageRevision] = useState(0);
  useEffect(() => {
    const resetPage = () => setMenuPageRevision(value => value + 1);
    window.addEventListener(MENU_PAGE_RESET_EVENT, resetPage);
    return () => window.removeEventListener(MENU_PAGE_RESET_EVENT, resetPage);
  }, []);
  useEffect(() => { setMenuPageRevision(0); }, [router.pathname]);
  const page = (
    <div data-ui-page-content style={{display:'contents'}}>
      <Component key={`${router.pathname}:${menuPageRevision}`} {...pageProps} />
    </div>
  );
  // 정확 매칭 + /m/* 접두사 매칭 (모바일 전용 페이지는 레이아웃 없음)
  const isNoLayout =
    NO_LAYOUT.includes(router.pathname) || router.pathname === '/m' || router.pathname.startsWith('/m/');
  const isMenuPage = MENU_ITEMS.some(group => group.items.some(item => item.href === router.pathname));
  const needsStandaloneBack = isMenuPage && STANDALONE_MENU_BACK_ROUTES.has(router.pathname);

  if (isNoLayout) {
    return (
      <>
        <style>{`body { background: #F0F0F0; }`}</style>
        {needsStandaloneBack && <MenuBackButton standalone />}
        {page}
      </>
    );
  }

  return (
    <Layout>
      {page}
    </Layout>
  );
}
