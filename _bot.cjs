// Test-Bot: Spieler 2, steht direkt vor dem Standard-Spawn (0,1.6,20 blickt -z).
const { Client } = require('colyseus.js');
const url = 'ws://37.120.164.136:2567';
(async () => {
  const room = await new Client(url).joinOrCreate('arena', { name: 'Bot' });
  console.log('BOT_JOINED', room.sessionId);
  // Direkt ins Sichtfeld: 12m vor dem Spieler, zu ihm gedreht (ry = PI).
  setInterval(() => room.send('move', { x: 0, y: 1.6, z: 8, ry: Math.PI, moving: true }), 100);
  setTimeout(() => { room.leave(); process.exit(0); }, 120000);
})().catch((e) => { console.error('BOT_FAIL', e && (e.message || e)); process.exit(1); });
