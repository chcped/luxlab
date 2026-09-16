import crypto from 'node:crypto';
import { log } from './logger.js';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { originCors } from './http-cors.js';
import { installStandalone } from './standalone.js';
import { downloadDesktop } from './download.js';
import { openAccountStore } from './account-store.js';
import { createAccounts } from './accounts.js';
import { createSavedRooms } from './saved-rooms.js';
import { configuredMailer } from './mail.js';
import { createCloudflareRealtime } from './cloudflare-realtime.js';

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use((req, res, next) => {
  const started = performance.now(); const requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', requestId);
  res.on('finish', () => log(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http.response', { requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(performance.now() - started) }));
  next();
});
app.use(helmet({ contentSecurityPolicy: { directives: {
  'connect-src': ["'self'", 'https:', 'wss:', 'http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*'],
  'media-src': ["'self'", 'blob:'], 'img-src': ["'self'", 'data:'], 'upgrade-insecure-requests': null
} }, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '16kb' }));
app.use(originCors);
const server = http.createServer(app);
const store = openAccountStore(process.env.DATABASE_PATH || fileURLToPath(new URL('../data/luxlab.sqlite', import.meta.url)));
const accounts = createAccounts({ store, secret: config.jwtSecret, sendCode: configuredMailer() });
const saved = createSavedRooms({ store, secret: config.jwtSecret });
const realtime = createCloudflareRealtime({ appId: config.cloudflareRealtimeAppId, appSecret: config.cloudflareRealtimeAppSecret });
if (!realtime) log('warn', 'realtime.unconfigured', { message: 'Configure CLOUDFLARE_REALTIME_APP_ID e CLOUDFLARE_REALTIME_APP_SECRET para habilitar o SFU.' });
if (!accounts.enabled) log('warn', 'auth.email_unconfigured', { message: 'Configure RESEND_API_KEY e RESEND_FROM, ou SMTP_HOST e SMTP_FROM, para habilitar login por e-mail.' });
const stop = installStandalone(app, server, {
  accounts, saved,
  secret: config.jwtSecret, allowedOrigins: config.allowedOrigins,
  allowGuests: process.env.ALLOW_GUESTS !== 'false',
  authSecret: process.env.AUTH_JWT_SECRET || config.jwtSecret,
  authIssuer: process.env.AUTH_JWT_ISSUER || 'luxlab-auth', authAudience: process.env.AUTH_JWT_AUDIENCE || 'luxlab-desktop',
  maxRooms: Number(process.env.MAX_ROOMS || 100), maxMembers: Number(process.env.MAX_MEMBERS_PER_ROOM || 8),
  ttl: Number(process.env.ROOM_TTL_SECONDS || 14400),
  iceTransportPolicy: process.env.ICE_TRANSPORT_POLICY || 'all',
  iceServers: JSON.parse(process.env.ICE_SERVERS || '[]'),
  turnUrls: (process.env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean), turnSecret: process.env.TURN_SECRET || '',
  realtime
});
app.get('/download/windows', downloadDesktop);
app.get('/health', (_req, res) => res.json({ ok: true, mode: 'standalone' }));
const frontend = process.env.FRONTEND_DIR || fileURLToPath(new URL('../../Frontend/src', import.meta.url));
// Revalidate shared frontend files instead of mixing releases in browser/CDN caches.
app.use(express.static(frontend, {
  setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
}));
app.get('/room/:id', (_req, res) => res.sendFile(path.resolve(frontend, 'index.html'), { headers: { 'Cache-Control': 'no-store' } }));
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) log('error', 'http.error', { name: err.name, message: err.message });
  res.status(status).json({ error: status === 500 ? 'Erro interno do servidor.' : err.message });
});
server.listen(config.port, config.host, () => log('info', 'server.started', { host: config.host, port: config.port }));
let stopping = false;
function shutdown() {
  if (stopping) return; stopping = true;
  stop(); server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
