const { Client } = require('colyseus.js');
const url = 'ws://37.120.164.136:2567';

function watch(label) {
  return new Client(url).joinOrCreate('arena', { name: label }).then((room) => {
    console.log(`${label}: joined room=${room.roomId} session=${room.sessionId}`);
    room.state.players.onAdd((p, id) => console.log(`${label}: sieht Spieler + ${id} (${p.name}) @ ${p.x.toFixed(1)},${p.z.toFixed(1)}`));
    room.state.players.onRemove((p, id) => console.log(`${label}: Spieler weg - ${id}`));
    return room;
  });
}

(async () => {
  const a = await watch('A');
  await new Promise((r) => setTimeout(r, 800));
  const b = await watch('B');
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`\nA sieht ${a.state.players.size} Spieler, B sieht ${b.state.players.size} Spieler`);
  console.log(a.state.players.size === 2 && b.state.players.size === 2 ? 'SAME_ROOM_OK' : 'DIFFERENT_ROOMS_OR_PROBLEM');
  a.leave(); b.leave();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})().catch((e) => { console.error('FAIL', e && (e.message || e)); process.exit(1); });
