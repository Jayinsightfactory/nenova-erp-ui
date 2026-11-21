import Head from 'next/head';
import { verifyReqUser } from '../../lib/auth';
import ImportCostAgiWorkbench from '../../components/import-tools/ImportCostAgiWorkbench';

export default function ImportCostAgiPage({ userId = '', userName = '', initialViewMode = 'A' }) {
  return (
    <>
      <Head>
        <title>수입 원가·이익 AGI | Nenova</title>
      </Head>
      <ImportCostAgiWorkbench
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
    return { redirect: { destination: '/login?next=/import/cost-agi', permanent: false } };
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
