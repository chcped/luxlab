import { LuxlabApi } from '../src/api';

test('uses the room token only for the authenticated media gateway', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = jest.fn(async (url, init) => {
    requests.push({ url: String(url), init: init || {} });
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ sessionId: 'sfu-session' }) } as Response;
  });
  const api = new LuxlabApi('https://luxlab.example/');
  await api.media('/sessions', 'POST', 'room-token');
  expect(requests[0].url).toBe('https://luxlab.example/api/v2/realtime/sessions');
  expect((requests[0].init.headers as Record<string, string>).authorization).toBe('Bearer room-token');
});

test('explains when the deployed server does not have realtime routes', async () => {
  globalThis.fetch = jest.fn(async () => ({
    ok: false,
    status: 404,
    headers: new Headers({ 'content-type': 'text/html' }),
  }) as Response);
  const api = new LuxlabApi('https://luxlab.example');
  await expect(api.media('/sessions', 'POST', 'room-token')).rejects.toThrow('servidor precisa ser atualizado');
});
