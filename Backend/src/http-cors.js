import cors from 'cors';
import { config } from './config.js';

export const originCors = cors({
  origin(origin, callback) {
    if (!origin || config.allowedOrigins.has(origin)) return callback(null, true);
    callback(Object.assign(new Error('Origem não permitida'), { status: 403 }));
  },
  methods: ['GET', 'POST']
});
