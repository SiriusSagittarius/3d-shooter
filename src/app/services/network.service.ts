import { Injectable } from '@angular/core';
import { Client, Room } from 'colyseus.js';
import { Subject, Observable } from 'rxjs';

/** Netzwerk-Abbild eines Spielers (spiegelt das Server-Schema, nur Lesezugriff). */
export interface NetPlayer {
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  moving: boolean;
  hp: number;
  kills: number;
  dead: boolean;
}

/** "Jemand hat geschossen" (fuer Muendungsfeuer/Sound bei den anderen). */
export interface ShotEvent {
  id: string;
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
}

/** "Jemand wurde eliminiert." */
export interface KilledEvent {
  victim: string;
  killer: string;
}

/**
 * Verbindung zum Colyseus-Deathmatch-Server: haelt den Raum, sendet die eigene
 * Position (~20x/Sek) und stellt den synchronisierten Spieler-State bereit.
 * Die Darstellung der anderen uebernimmt der RemotePlayerService.
 */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  private client?: Client;
  private room?: Room;

  /** Eigene Spieler-ID im Raum (leer, solange nicht verbunden). */
  public sessionId = '';
  public connected = false;

  private shotSubject = new Subject<ShotEvent>();
  /** Ein anderer Spieler hat geschossen. */
  public shot$: Observable<ShotEvent> = this.shotSubject.asObservable();

  private killedSubject = new Subject<KilledEvent>();
  /** Ein Spieler wurde eliminiert (Opfer + Schuetze). */
  public killed$: Observable<KilledEvent> = this.killedSubject.asObservable();

  private leftSubject = new Subject<void>();
  /** Verbindung wurde getrennt (Server weg / Raum verlassen). */
  public left$: Observable<void> = this.leftSubject.asObservable();

  private playerJoinedSubject = new Subject<{ id: string; name: string }>();
  /** Ein ANDERER Spieler ist dem Raum beigetreten (oder war schon da). */
  public playerJoined$: Observable<{ id: string; name: string }> = this.playerJoinedSubject.asObservable();

  private playerLeftSubject = new Subject<{ id: string }>();
  /** Ein ANDERER Spieler hat den Raum verlassen. */
  public playerLeft$: Observable<{ id: string }> = this.playerLeftSubject.asObservable();

  /**
   * Server-URL: optional per ?server=... in der Adresszeile ueberschreibbar,
   * sonst automatisch gleicher Host wie die Seite auf Port 2567. So funktioniert
   * LAN (localhost/IP) und gehostetes Spiel (VPS-IP/Domain) ohne Code-Aenderung.
   */
  public defaultUrl(): string {
    const override = new URLSearchParams(location.search).get('server');
    if (override) return override;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.hostname || 'localhost';
    return `${proto}://${host}:2567`;
  }

  /** Verbindet und tritt der Deathmatch-Arena bei. Wirft bei Fehler. */
  public async connect(url: string, name: string): Promise<void> {
    this.client = new Client(url);
    this.room = await this.client.joinOrCreate('arena', { name });
    this.sessionId = this.room.sessionId;
    this.connected = true;

    this.room.onMessage('shot', (data: ShotEvent) => this.shotSubject.next(data));
    this.room.onMessage('killed', (data: KilledEvent) => this.killedSubject.next(data));

    // Andere Spieler beobachten (feuert auch fuer bereits Anwesende beim Beitritt).
    const players = (this.room.state as { players?: any })?.players;
    players?.onAdd?.((p: NetPlayer, id: string) => {
      if (id !== this.sessionId) this.playerJoinedSubject.next({ id, name: p?.name ?? 'Spieler' });
    });
    players?.onRemove?.((_p: NetPlayer, id: string) => {
      if (id !== this.sessionId) this.playerLeftSubject.next({ id });
    });

    this.room.onLeave(() => {
      this.connected = false;
      this.leftSubject.next();
    });
    this.room.onError((code, message) => {
      console.error('Colyseus-Raumfehler', code, message);
    });
  }

  /** Live-Map aller Spieler im Raum (Server-Schema; pro Frame gelesen). */
  public get players(): Map<string, NetPlayer> | undefined {
    return this.room?.state?.players as unknown as Map<string, NetPlayer> | undefined;
  }

  public getPlayer(id: string): NetPlayer | undefined {
    return this.players?.get(id);
  }

  /** Eigene Position + Blickrichtung an den Server melden. */
  public sendMove(x: number, y: number, z: number, ry: number, moving: boolean): void {
    this.room?.send('move', { x, y, z, ry, moving });
  }

  /** Eigenen Schuss melden (Startpunkt + Richtung) fuer Effekte bei anderen. */
  public sendShoot(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    this.room?.send('shoot', { x, y, z, dx, dy, dz });
  }

  /** Treffer auf einen anderen Spieler melden (Server rechnet Schaden/Kill). */
  public sendHit(target: string, damage: number): void {
    this.room?.send('hit', { target, damage });
  }

  public disconnect(): void {
    this.room?.leave();
    this.room = undefined;
    this.connected = false;
    this.sessionId = '';
  }
}
