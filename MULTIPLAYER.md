# Mehrspieler (Deathmatch 1 gegen 1)

Prototyp für ein Netzwerk-Deathmatch: zwei Spieler sehen sich als animierte
Soldaten in derselben Arena und können aufeinander schießen. Ein kleiner
**Colyseus-Server** (Node.js) ist der Schiedsrichter für Position, Leben, Kills
und Respawn.

## Architektur in einem Bild

```
 Spieler A (Browser) ─┐
                      ├──►  Colyseus-Server (Node, Port 2567)  ──► verteilt State
 Spieler B (Browser) ─┘        (server/)                            an beide Clients
```

- **Server:** [server/](server/) — Raum `arena`, max. 2 Spieler, siehe
  [server/src/rooms/ArenaRoom.ts](server/src/rooms/ArenaRoom.ts).
- **Client:** [NetworkService](src/app/services/network.service.ts) (Verbindung),
  [RemotePlayerService](src/app/services/remote-player.service.ts) (Avatare),
  verdrahtet in [game.component.ts](src/app/services/game.component.ts).

## Starten

Du brauchst **zwei** Terminals.

**1. Server** (einmalig `npm install`, danach nur noch `npm start`):

```bash
cd server
npm install      # nur beim ersten Mal
npm start        # -> "Deathmatch-Server laeuft auf ws://localhost:2567"
```

**2. Client** (im Projekt-Hauptordner):

```bash
npm start        # ng serve, öffnet http://localhost:4200
```

## Zusammen spielen

### Auf demselben PC (zum Testen)
Öffne `http://localhost:4200` in **zwei** Browserfenstern und klicke in beiden
auf **🌐 Mehrspieler (LAN)**. Ihr seht euch gegenseitig als Soldaten.

### Im selben WLAN (zwei PCs)
1. Finde die lokale IP des PCs, auf dem **Server + Client** laufen
   (Windows: `ipconfig` → z. B. `192.168.1.42`).
2. Der Server muss erreichbar sein. `ng serve` ist standardmäßig nur auf
   `localhost` — starte den Client stattdessen so, dass er im Netz sichtbar ist:
   ```bash
   npx ng serve --host 0.0.0.0
   ```
3. Der Mitspieler öffnet im Browser `http://192.168.1.42:4200` und klickt auf
   **Mehrspieler**. Der Client verbindet sich automatisch zum Server unter
   derselben IP auf Port **2567** (siehe `defaultUrl()` im NetworkService).
4. Ggf. muss die **Windows-Firewall** für Node.js / Port 2567 + 4200 freigegeben
   werden.

### Über das Internet
Server bei einem Hoster laufen lassen (Render, Railway, Fly.io) oder für eine
Testrunde einen Tunnel nutzen (ngrok / Cloudflare Tunnel) und die Server-URL
im Client anpassen.

## Steuerung
Wie im Einzelspieler: **WASD** laufen, **Maus** umsehen, **Linksklick** schießen,
**R** nachladen. Zwei Treffer eliminieren den Gegner (Respawn nach 3 s).

## Was der Prototyp kann
- Beide Spieler sehen sich in Echtzeit bewegen (Position weich interpoliert)
- Lauf-/Ruhe-Animation der Soldaten je nach Bewegung
- Aufeinander schießen: Treffer über den bestehenden Raycast, Muzzle-Sound der
  Gegenseite
- Leben, Kills, Tod und Respawn (Server-gesteuert), HUD zeigt eigene Kills

## Bewusste Vereinfachungen (nächste Ausbaustufen)
- **Treffer sind client-vertrauend:** Der schießende Client meldet den Treffer,
  der Server glaubt ihm. Für Freunde völlig ok; cheat-sicher wäre
  server-seitiges Nachrechnen der Schusslinie.
- **Fix 2 Spieler.** Für 4 Spieler: `maxClients` im ArenaRoom erhöhen (der Client
  zeigt beliebig viele Avatare bereits an).
- **Keine Lobby / kein Rundenende / keine Scoretafel** — kommt in einer späteren
  Stufe.
- **Blickrichtung** der Avatare wird aus dem Kamera-Yaw abgeleitet; falls ein
  Soldat „falsch herum" steht, das `+ Math.PI` in
  `remote-player.service.ts` (Methode `update`) anpassen.
- **Server-URL** ist fest auf Host:2567. Für andere Setups `defaultUrl()` im
  NetworkService anpassen.
```
