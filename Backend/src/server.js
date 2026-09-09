import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { originCors } from './http-cors.js';
import { installStandalone } from './standalone.js';

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: {
  'connect-src': ["'self'", 'https:', 'wss:', 'http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*'],
  'media-src': ["'self'", 'blob:'], 'img-src': ["'self'", 'data:'], 'upgrade-insecure-requests': null
} }, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '16kb' }));
app.use(originCors);
const server = http.createServer(app);
const stop = installStandalone(app, server, {
  secret: config.jwtSecret, allowedOrigins: config.allowedOrigins,
  allowGuests: process.env.ALLOW_GUESTS !== 'false',
  authSecret: process.env.AUTH_JWT_SECRET || config.jwtSecret,
  authIssuer: process.env.AUTH_JWT_ISSUER || 'luxlab-auth', authAudience: process.env.AUTH_JWT_AUDIENCE || 'luxlab-desktop',
  maxRooms: Number(process.env.MAX_ROOMS || 100), maxMembers: Number(process.env.MAX_MEMBERS_PER_ROOM || 8),
  ttl: Number(process.env.ROOM_TTL_SECONDS || 14400),
  iceServers: JSON.parse(process.env.ICE_SERVERS || '[]'),
  turnUrls: (process.env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean), turnSecret: process.env.TURN_SECRET || ''
});
app.get('/health', (_req, res) => res.json({ ok: true, mode: 'standalone' }));
const frontend = process.env.FRONTEND_DIR || fileURLToPath(new URL('../../Frontend/src', import.meta.url));
app.use(express.static(frontend));
app.get('/room/:id', (_req, res) => res.sendFile(path.resolve(frontend, 'index.html')));
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Erro interno do servidor.' : err.message });
});
server.listen(config.port, config.host, () => console.log(`Luxlab em http://${config.host}:${config.port}`));
function shutdown() { stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
