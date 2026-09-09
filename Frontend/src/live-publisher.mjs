export class LivePublisher {
  constructor({ server, token }, stream, onError) {
    this.server = server;
    this.token = token;
    this.stream = stream;
    this.onError = onError;
    this.closed = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const ws = this.ws = new WebSocket(this.server);
      this.timeout = setTimeout(() => this.fail('Tempo esgotado ao iniciar a transmissão.'), 12000);
      ws.onopen = () => ws.send(JSON.stringify({ token: this.token }));
      ws.onmessage = event => {
        try {
          if (JSON.parse(event.data).type !== 'ready' || this.recorder || this.closed) return;
          const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus'].find(type => MediaRecorder.isTypeSupported(type));
          if (!mimeType) throw new Error('O dispositivo não suporta a codificação necessária.');
          const recorder = this.recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 });
          recorder.ondataavailable = event => {
            if (this.closed || !event.data.size) return;
            if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount + event.data.size > 8 * 1024 * 1024) return this.fail('Upload congestionado. Confira sua conexão e inicie novamente.');
            ws.send(event.data);
          };
          recorder.onerror = () => this.fail('Falha ao codificar a captura.');
          recorder.start(500);
          clearTimeout(this.timeout);
          this.reject = null;
          resolve();
        } catch (error) { this.fail(error.message); }
      };
      ws.onerror = () => this.fail('Falha na conexão com o servidor de vídeo.');
      ws.onclose = () => { if (!this.closed) this.fail('Transmissão encerrada pelo servidor ou pela Activity.'); };
    });
  }
  fail(message) { if (this.closed) return; this.close(); this.onError(message); }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    this.reject?.(new Error('Conexão encerrada.'));
    this.reject = null;
    if (this.recorder?.state !== 'inactive' && this.recorder) this.recorder.stop();
    this.ws?.close();
  }
}

export function serverURLs(value) {
  const base = new URL(value);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('Use HTTPS para o servidor remoto.');
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Informe somente a origem do servidor, por exemplo https://luxlab.net.br.');
  return { api: `${base.origin}/api/live/pair`, ingest: `${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}/ingest` };
}
