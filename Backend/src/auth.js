import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function createPeerToken({ roomId, peerId, role }) {
  return jwt.sign({ roomId, peerId, role }, config.jwtSecret, {
    algorithm: 'HS256', expiresIn: config.tokenTtl, issuer: 'p2p-signaling', audience: 'webrtc-peer'
  });
}

export function verifyPeerToken(token) {
  const claims = jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'], issuer: 'p2p-signaling', audience: 'webrtc-peer'
  });
  if (!claims.roomId || !claims.peerId || !['publisher', 'viewer'].includes(claims.role)) {
    throw new Error('Token inválido');
  }
  return claims;
}
