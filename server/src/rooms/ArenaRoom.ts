import { Room, Client } from 'colyseus';
import { Schema, MapSchema, type } from '@colyseus/schema';

/**
 * Zustand EINES Spielers, den der Server an alle Clients synchronisiert.
 * Position + Blickrichtung kommen ~20x/Sek vom jeweiligen Spieler-Client,
 * Leben/Kills/Tod verwaltet ausschliesslich der Server (Schiedsrichter).
 */
export class Player extends Schema {
  @type('string') name = 'Spieler';
  @type('number') x = 0;
  @type('number') y = 1.6;
  @type('number') z = 20;
  /** Blickrichtung (Yaw, entspricht camera.rotation.y im Client). */
  @type('number') ry = 0;
  /** true, wenn der Spieler sich gerade bewegt (steuert die Lauf-Animation). */
  @type('boolean') moving = false;
  @type('number') hp = 100;
  @type('number') kills = 0;
  @type('boolean') dead = false;
  /** Feste Spawn-Seite (nicht synchronisiert) — Spieler starten einander zugewandt. */
  spawnIndex = 0;
}

export class ArenaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

/** Nachricht "ich habe geschossen" (fuer Muendungsfeuer/Sound bei den anderen). */
interface ShootMsg {
  x: number; y: number; z: number;      // Startpunkt (Kameraposition)
  dx: number; dy: number; dz: number;   // Blickrichtung
}

/** Nachricht "ich habe Spieler <target> getroffen" (client-vertrauend, siehe README). */
interface HitMsg {
  target: string;
  damage?: number;
}

/**
 * Deathmatch-Arena fuer 2 Spieler (1 gegen 1).
 *
 * Treffer-Modell: der schiessende Client meldet selbst, wen er getroffen hat
 * (client-authoritative). Fuer eine Runde unter Freunden voellig ausreichend;
 * cheat-sicher waere server-seitiges Nachrechnen (spaeterer Ausbau).
 */
export class ArenaRoom extends Room<ArenaState> {
  maxClients = 2;

  private readonly respawnDelayMs = 3000;
  private readonly defaultDamage = 50; // Sniper: 2 Treffer = Kill

  /**
   * Feste Spawn-Punkte, einander zugewandt (Blick zur Mitte). So sehen sich
   * beide Spieler sofort und stehen nicht aufeinander. ry entspricht
   * camera.rotation.y im Client (0 = Blick Richtung -z, PI = Richtung +z).
   */
  private readonly spawns = [
    { x: 0, z: 26, ry: 0 },        // Spieler 1: Blick Richtung -z (zur Mitte)
    { x: 0, z: -26, ry: Math.PI }, // Spieler 2: Blick Richtung +z (zur Mitte)
  ];

  onCreate(): void {
    this.setState(new ArenaState());

    // Position/Blickrichtung eines Spielers uebernehmen.
    this.onMessage('move', (client, data: Partial<Player>) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || p.dead) return;
      if (typeof data.x === 'number') p.x = data.x;
      if (typeof data.y === 'number') p.y = data.y;
      if (typeof data.z === 'number') p.z = data.z;
      if (typeof data.ry === 'number') p.ry = data.ry;
      p.moving = !!data.moving;
    });

    // Schuss an alle ANDEREN weiterreichen (fuer Muendungsfeuer/Sound).
    this.onMessage('shoot', (client, data: ShootMsg) => {
      this.broadcast('shot', { id: client.sessionId, ...data }, { except: client });
    });

    // Treffer-Meldung: Ziel Schaden zufuegen, ggf. Kill werten + Respawn planen.
    this.onMessage('hit', (client, data: HitMsg) => {
      const shooter = this.state.players.get(client.sessionId);
      const target = this.state.players.get(data.target);
      if (!shooter || !target || target.dead || data.target === client.sessionId) return;

      target.hp -= data.damage ?? this.defaultDamage;
      if (target.hp <= 0) {
        target.hp = 0;
        target.dead = true;
        shooter.kills += 1;
        this.broadcast('killed', { victim: data.target, killer: client.sessionId });
        this.clock.setTimeout(() => this.respawn(data.target), this.respawnDelayMs);
      }
    });
  }

  onJoin(client: Client, options?: { name?: string }): void {
    const p = new Player();
    p.name = options?.name?.slice(0, 16) || `Spieler-${this.clients.length}`;
    // Freie Spawn-Seite waehlen: erster Spieler Seite 0, zweiter Seite 1.
    p.spawnIndex = this.state.players.size % this.spawns.length;
    this.placeAtSpawn(p);
    this.state.players.set(client.sessionId, p);
    console.log(`[+] ${p.name} (${client.sessionId}) beigetreten. Spieler: ${this.state.players.size}`);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    console.log(`[-] ${client.sessionId} verlassen. Spieler: ${this.state.players.size}`);
  }

  /** Setzt Leben zurueck und platziert den Spieler an einem frischen Spawn. */
  private respawn(id: string): void {
    const p = this.state.players.get(id);
    if (!p) return;
    p.hp = 100;
    p.dead = false;
    this.placeAtSpawn(p);
  }

  /** Setzt den Spieler an seinen festen, der Mitte zugewandten Spawn-Punkt. */
  private placeAtSpawn(p: Player): void {
    const s = this.spawns[p.spawnIndex] ?? this.spawns[0];
    p.x = s.x;
    p.z = s.z;
    p.y = 1.6;
    p.ry = s.ry;
  }
}
