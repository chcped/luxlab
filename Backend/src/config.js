import 'dotenv/config';

const required = ['JWT_SECRET'];
for (const key of required) {
  if (!process.env[key] || process.env[key].length < 24) {
    throw new Error(`${key} deve possuir pelo menos 24 caracteres`);
  }
}

const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean));
allowedOrigins.add('app://desktop');

export const config = Object.freeze({
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET,
  adminApiKey: process.env.ADMIN_API_KEY,
  allowedOrigins,
  tokenTtl: Number(process.env.TOKEN_TTL_SECONDS || 3600),
  maxViewers: Number(process.env.MAX_VIEWERS_PER_ROOM || 20),
  trustProxy: Number(process.env.TRUST_PROXY || 1),
  maxMessageBytes: 64 * 1024,
  heartbeatMs: 30_000
});
