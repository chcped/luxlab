export class RoomRegistry {
  constructor(maxViewers) {
    this.rooms = new Map();
    this.maxViewers = maxViewers;
  }

  join(peer) {
    let room = this.rooms.get(peer.roomId);
    if (!room) this.rooms.set(peer.roomId, room = new Map());
    if (room.has(peer.peerId)) throw new Error('peerId já conectado');
    if (peer.role === 'publisher' && [...room.values()].some(p => p.role === 'publisher')) {
      throw new Error('A sala já possui um transmissor');
    }
    if (peer.role === 'viewer' && [...room.values()].filter(p => p.role === 'viewer').length >= this.maxViewers) {
      throw new Error('Limite de espectadores atingido');
    }
    room.set(peer.peerId, peer);
    return [...room.values()].filter(p => p.peerId !== peer.peerId);
  }

  get(roomId, peerId) { return this.rooms.get(roomId)?.get(peerId); }

  leave(peer) {
    const room = this.rooms.get(peer.roomId);
    if (!room) return [];
    room.delete(peer.peerId);
    if (!room.size) this.rooms.delete(peer.roomId);
    return [...room.values()];
  }

  stats() {
    return { rooms: this.rooms.size, peers: [...this.rooms.values()].reduce((n, r) => n + r.size, 0) };
  }
}
