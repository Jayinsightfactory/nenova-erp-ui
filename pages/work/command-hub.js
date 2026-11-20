// pages/work/command-hub.js
// 사장님 전용 통합 지휘실 (/work/command-hub) — nenovaSS3 전용 (비권한 계정 404 은닉).
// 단일 shell 원칙: _app.js 가 Layout 을 소유하므로 여기서는 Layout 을 import/render 하지 않는다.
import fs from 'node:fs';
import Head from 'next/head';
import CeoCommandHub from '../../components/work/CeoCommandHub';
import { verifyReqUser } from '../../lib/auth';
import { isOrbitReportViewer } from '../../lib/orbitReportAccess';
import { featureFilePath } from '../../lib/workFeatureData';
import { readStaffRequests } from '../../lib/pmStaffRequests';

function readJsonSafe(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readPmOfficeInitial() {
  const filePath = featureFilePath('pm-office');
  if (!filePath) return null;
  try {
    const stat = fs.statSync(filePath);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const now = Date.now();
    const gen = raw?.generatedAt ? Date.parse(raw.generatedAt) : NaN;
    const ageSec = Number.isFinite(gen)
      ? Math.max(0, Math.round((now - gen) / 1000))
      : Math.round((now - stat.mtimeMs) / 1000);
    return {
      success: true,
      serverNow: new Date(now).toISOString(),
      ageSec,
      data: raw
        ? {
            mode: raw.mode || 'shadow',
            generatedAt: raw.generatedAt || null,
            agents: Array.isArray(raw.agents) ? raw.agents : [],
            staff: Array.isArray(raw.staff) ? raw.staff : [],
            tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
            playbooks: raw.playbooks || null,
            pmDetail: raw.pmDetail || null,
            vision: raw.vision || null,
            workLog: Array.isArray(raw.workLog) ? raw.workLog.slice(0, 60) : [],
          }
        : null,
    };
  } catch {
    return null;
  }
}

function trimTechRadar(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rounds = Array.isArray(raw.rounds) ? raw.rounds.slice(0, 2) : [];
  return {
    generatedAt: raw.generatedAt || null,
    rounds,
  };
}

function trimDeviceHub(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    generatedAt: raw.generatedAt || null,
    binarySizeKB: raw.binarySizeKB ?? 402.5,
    devices: Array.isArray(raw.devices) ? raw.devices.slice(0, 20) : [],
  };
}

export async function getServerSideProps({ req, res }) {
  const user = await verifyReqUser(req, res);
  if (!isOrbitReportViewer(user)) {
    return { notFound: true };
  }

  const initialPmOffice = readPmOfficeInitial();
  let initialStaffRequests = [];
  try {
    initialStaffRequests = readStaffRequests().slice(-80).reverse();
  } catch {
    initialStaffRequests = [];
  }

  const initialAdoptionLedger = readJsonSafe(featureFilePath('adoption-ledger'));
  const initialTechRadar = trimTechRadar(readJsonSafe(featureFilePath('tech-radar')));
  const initialDeviceHub = trimDeviceHub(readJsonSafe(featureFilePath('device-hub-status')));
  const initialSelfTune = readJsonSafe(featureFilePath('self-tune-report'));
  const initialOwnerTwin = readJsonSafe(featureFilePath('owner-twin'));

  return {
    props: {
      userId: String(user.userId || ''),
      initialSyncedAt: new Date().toISOString(),
      initialPmOffice,
      initialStaffRequests,
      initialAdoptionLedger,
      initialTechRadar,
      initialDeviceHub,
      initialSelfTune,
      initialOwnerTwin,
    },
  };
}

export default function CeoCommandHubPage(props) {
  return (
    <>
      <Head>
        <title>사장님 통합 지휘실 | Nenova</title>
      </Head>
      <CeoCommandHub {...props} />
    </>
  );
}
