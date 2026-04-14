import Layout from '../components/Layout';
import '../styles/globals.css';
import { useRouter } from 'next/router';

const NO_LAYOUT = ['/login', '/', '/shipment/week-pivot'];

export default function App({ Component, pageProps }) {
  const router = useRouter();
  // 정확 매칭 + /m/* 접두사 매칭 (모바일 전용 페이지는 레이아웃 없음)
  const isNoLayout =
    NO_LAYOUT.includes(router.pathname) || router.pathname.startsWith('/m/');

  if (isNoLayout) {
    return (
      <>
        <style>{`body { background: #F0F0F0; }`}</style>
        <Component {...pageProps} />
      </>
    );
  }

  return (
    <Layout>
      <Component {...pageProps} />
    </Layout>
  );
}
