import Head from 'next/head';
import { verifyReqUser } from '../../lib/auth';
import GabrielProfitAgiWorkbench from '../../components/import-tools/GabrielProfitAgiWorkbench';

export default function GabrielImportProfitAgiPage({ userId = '', userName = '', initialViewMode = 'A' }) {
  return (
    <>
      <Head>
        <title>가브리엘 원가·이익 최적화 AGI | Nenova</title>
      </Head>
      <GabrielProfitAgiWorkbench
        userId={userId}
        userName={userName}
        initialViewMode={initialViewMode}
        showGuide={true}
      />
    </>
  );
}

export async function getServerSideProps({ req, res, query = {} }) {
  const user = await verifyReqUser(req, res);
  if (!user) {
    return { redirect: { destination: '/login?next=/import/gabriel-agi', permanent: false } };
  }
  const rawView = String(query.view || 'A').toUpperCase();
  const initialViewMode = ['A', 'B', 'C', 'ALL'].includes(rawView) ? rawView : 'A';
  return {
    props: {
      userId: String(user.userId || ''),
      userName: String(user.userName || user.userId || ''),
      initialViewMode,
    },
  };
}
