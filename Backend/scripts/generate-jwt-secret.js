import { randomBytes } from 'node:crypto';

// 32 random bytes = 256 bits of entropy for the HS256 signing secret.
// Print only; never read or modify .env automatically.
console.log(`JWT_SECRET=${randomBytes(32).toString('base64url')}`);
