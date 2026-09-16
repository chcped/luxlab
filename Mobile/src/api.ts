export type IceServer = { credential?: string; url?: string; urls?: string | string[]; username?: string };
export type RoomSession = { roomId: string; token: string; iceServers?: IceServer[]; iceTransportPolicy?: 'all' | 'relay' };

export class LuxlabApi {
  readonly base: string;
  constructor(base: string) { this.base = base.replace(/\/$/, ''); }
  private async request(path: string, init: RequestInit = {}, token?: string) {
    const response = await fetch(`${this.base}/api/v2${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(response.status === 404
        ? 'O servidor precisa ser atualizado para habilitar o compartilhamento de tela.'
        : 'O servidor retornou uma resposta invalida. Tente novamente em instantes.');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'O servidor recusou a operacao.');
    return data;
  }
  createRoom(name: string): Promise<RoomSession> { return this.request('/rooms', { method: 'POST', body: JSON.stringify({ profile: { name } }) }); }
  joinRoom(roomId: string, name: string): Promise<RoomSession> { return this.request(`/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST', body: JSON.stringify({ profile: { name } }) }); }
  media(path: string, method: 'POST' | 'PUT', token: string, body?: unknown) {
    return this.request(`/realtime${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, token);
  }
}
