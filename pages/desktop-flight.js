import Head from 'next/head';
import { useRouter } from 'next/router';
import ImportFlightBoard from '../components/home/ImportFlightBoard';
import WorkflowGuide from '../components/WorkflowGuide';
import MenuBackButton from '../components/MenuBackButton';

export default function DesktopFlight() {
  const router = useRouter();
  const value = router.query.flight;
  const viewId = typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : '';
  return (
    <main className="desktop-flight-view">
      <Head><title>수입 비행기 현황 · 네노바</title></Head>
      <div style={{ marginBottom: 8 }}><MenuBackButton /></div>
      <ImportFlightBoard initialViewId={viewId} />
      <WorkflowGuide workflowId="desktop-flight-popup" />
      <style jsx>{`
        .desktop-flight-view { padding: 18px; min-height: 100vh; background: #f4f7fb; }
        @media (max-width: 700px) { .desktop-flight-view { padding: 8px; } }
      `}</style>
    </main>
  );
}
