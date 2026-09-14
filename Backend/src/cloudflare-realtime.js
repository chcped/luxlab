const DEFAULT_BASE_URL = 'https://rtc.live.cloudflare.com/v1';

export class RealtimeApiError extends Error {
  constructor(message, status = 502, details) {
    super(message);
    this.name = 'RealtimeApiError';
    this.status = status;
    this.details = details;
  }
}

export function createCloudflareRealtime({ appId, appSecret, baseUrl = DEFAULT_BASE_URL, fetch: request = globalThis.fetch } = {}) {
  if (!appId || !appSecret) return null;
  if (typeof request !== 'function') throw new Error('fetch indisponivel para o Cloudflare Realtime');
  const root = `${String(baseUrl).replace(/\/$/, '')}/apps/${encodeURIComponent(appId)}`;

  async function call(path, { method = 'POST', body } = {}) {
    let response;
    try {
      response = await request(root + path, {
        method,
        signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${appSecret}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (error) {
      throw new RealtimeApiError(error.name === 'TimeoutError' ? 'Cloudflare Realtime demorou para responder.' : 'Nao foi possivel acessar o Cloudflare Realtime.');
    }
    const text = await response.text();
    let result = {};
    if (text) {
      try { result = JSON.parse(text); }
      catch { throw new RealtimeApiError('Cloudflare Realtime retornou uma resposta invalida.'); }
    }
    if (!response.ok) throw new RealtimeApiError('Cloudflare Realtime recusou a operacao.', response.status >= 500 ? 502 : 409, result);
    return result;
  }

  return Object.freeze({
    createSession: () => call('/sessions/new'),
    addTracks: (sessionId, body) => call(`/sessions/${encodeURIComponent(sessionId)}/tracks/new`, { body }),
    updateTracks: (sessionId, body) => call(`/sessions/${encodeURIComponent(sessionId)}/tracks/update`, { method: 'PUT', body }),
    renegotiate: (sessionId, body) => call(`/sessions/${encodeURIComponent(sessionId)}/renegotiate`, { method: 'PUT', body }),
    closeTracks: (sessionId, body) => call(`/sessions/${encodeURIComponent(sessionId)}/tracks/close`, { method: 'PUT', body })
  });
}
