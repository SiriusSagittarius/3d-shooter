import { Server } from 'colyseus';
import { ArenaRoom } from './rooms/ArenaRoom';

const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server();
gameServer.define('arena', ArenaRoom);

gameServer.listen(port).then(() => {
  console.log(`🎮 Deathmatch-Server laeuft auf  ws://localhost:${port}`);
  console.log('   Im LAN verbinden sich Mitspieler ueber die lokale IP dieses PCs.');
}).catch((err) => {
  console.error('Server konnte nicht starten:', err);
  process.exit(1);
});
