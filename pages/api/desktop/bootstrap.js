import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withAuth } from '../../../lib/auth';
import { buildDesktopBootstrap } from '../../../lib/desktopBootstrap';
import { MENU_ITEMS } from '../../../components/Layout';

function deployedWebVersion() {
  if (process.env.NEXT_PUBLIC_BUILD_VERSION) return process.env.NEXT_PUBLIC_BUILD_VERSION;
  try {
    return readFileSync(join(process.cwd(), process.env.NEXT_DIST_DIR || '.next', 'BUILD_ID'), 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

const webVersion = deployedWebVersion();
const authenticatedHandler = withAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  return res.status(200).json(buildDesktopBootstrap(MENU_ITEMS, req.user, webVersion));
});

export default function desktopBootstrap(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Cookie, Authorization');
  return authenticatedHandler(req, res);
}
