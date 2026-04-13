import Layout from '../components/Layout';
import '../styles/globals.css';
import { useRouter } from 'next/router';

const NO_LAYOUT = ['/login', '/', '/shipment/week-pivot'];

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const isNoLayout = NO_LAYOUT.includes(router.pathname);

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
