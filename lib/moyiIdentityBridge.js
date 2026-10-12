import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getTenant } from './tenant';

export const MOYI_IDENTITY_ISSUER = 'nenovaweb';
export const MOYI_IDENTITY_AUDIENCE = 'moyi-identity-bridge';
export const MOYI_IDENTITY_SCOPE = 'identity:link';

export function createMoyiIdentityExchangeToken(user) {
  const secret = process.env.MOYI_IDENTITY_BRIDGE_SECRET;
  const workspaceId = process.env.MOYI_WORKSPACE_ID;
  if (!secret || secret.length < 32) throw new Error('MOYI_IDENTITY_BRIDGE_SECRET must be at least 32 characters');
  if (!workspaceId) throw new Error('MOYI_WORKSPACE_ID is required');
  const userId = String(user?.userId || '').trim();
  if (!userId) throw new Error('authenticated UserInfo.UserID is required');
  const tenantId = String(getTenant().tenantId || '').trim();
  if (!tenantId) throw new Error('TENANT_ID is required');
  return jwt.sign(
    { tenant_id: tenantId, workspace_id: workspaceId, scope: MOYI_IDENTITY_SCOPE },
    secret,
    {
      algorithm: 'HS256', issuer: MOYI_IDENTITY_ISSUER, audience: MOYI_IDENTITY_AUDIENCE,
      subject: userId, jwtid: crypto.randomUUID(), expiresIn: '2m',
    },
  );
}
