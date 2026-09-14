import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredMailer } from '../src/mail.js';

test('Resend sends the login code to one recipient using server credentials', async () => {
  let called = 0;
  const mail = configuredMailer({ RESEND_API_KEY: 'test-key', RESEND_FROM: 'Luxlab <acesso@example.com>' }, {
    fetch: async (url, options) => {
      called++;
      assert.equal(url, 'https://api.resend.com/emails');
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      const body = JSON.parse(options.body);
      assert.deepEqual(body.to, ['ana@example.com']);
      assert.equal(body.from, 'Luxlab <acesso@example.com>');
      assert.match(body.text, /12345678/);
      assert.ok(!options.body.includes('test-key'));
      return Response.json({ id: 'mail-id' });
    }
  });
  await mail('ana@example.com', '12345678'); assert.equal(called, 1);
});

test('incomplete Resend config does not silently use SMTP', () => {
  assert.equal(configuredMailer({}), null);
  assert.equal(configuredMailer({ RESEND_API_KEY: 'test', SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'a@example.com' }), null);
  assert.equal(configuredMailer({ RESEND_FROM: 'a@example.com' }), null);
});

test('Resend rejects failed and malformed responses without exposing provider error bodies', async () => {
  for (const response of [Response.json({ message: 'private provider details' }, { status: 403 }), Response.json({})]) {
    const mail = configuredMailer({ RESEND_API_KEY: 'test', RESEND_FROM: 'a@example.com' }, { fetch: async () => response });
    await assert.rejects(mail('a@example.com', '12345678'), error => !error.message.includes('private provider details'));
  }
  const mail = configuredMailer({ RESEND_API_KEY: 'test', RESEND_FROM: 'a@example.com' }, { fetch: async () => { throw new Error('network failure'); } });
  await assert.rejects(mail('a@example.com', '12345678'));
});
