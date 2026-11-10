// Call rooms: people join with a short code and pick the language they speak.
// Whatever one person says is delivered to everyone else, each in their own language.

export class Rooms {
  constructor(maxPerRoom = 4) {
    this.max = maxPerRoom;
    this.rooms = new Map(); // code -> Map(peerId -> peer)
  }

  join(code, peer) {
    const room = this.rooms.get(code) ?? new Map();
    if (room.size >= this.max) throw new Error('This room is full');
    room.set(peer.id, peer);
    this.rooms.set(code, room);
    return room;
  }

  leave(code, id) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.delete(id);
    if (!room.size) this.rooms.delete(code);
  }

  peers(code) {
    return [...(this.rooms.get(code)?.values() ?? [])];
  }

  /** Everyone in the room except the speaker, grouped by the language they listen in. */
  listenersByLang(code, speakerId) {
    const groups = new Map();
    for (const p of this.peers(code)) {
      if (p.id === speakerId) continue;
      groups.set(p.lang, [...(groups.get(p.lang) ?? []), p]);
    }
    return groups;
  }
}

/** A short, easy-to-read room code (no 0/O or 1/I to confuse people). */
export function newRoomCode(rand = Math.random) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => abc[Math.floor(rand() * abc.length)]).join('');
}
