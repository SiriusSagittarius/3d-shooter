# Deployment auf einem netcup VPS (Ubuntu)

Schritt-für-Schritt-Anleitung, um Server **und** Client auf deinem VPS laufen zu
lassen, sodass Freunde über's Internet mitspielen können. Alles zum Kopieren.

> **Der einfache Weg zuerst:** Wir hosten alles über **http** (ohne Domain, ohne
> Zertifikat). Das reicht, um mit Freunden zu spielen — der Browser zeigt nur ein
> „Nicht sicher" an, das ist rein kosmetisch. Wie du später eine **Domain +
> HTTPS** ergänzt, steht ganz unten.

## Was du brauchst
- **IP-Adresse** und **Root-Passwort** deines VPS (kamen per netcup-Mail).
- Betriebssystem auf dem VPS: **Ubuntu** (LTS, z. B. 22.04 / 24.04).
- Der Code muss auf **GitHub** liegen (dein Repo `SiriusSagittarius/3d-shooter`)
  — inklusive der neuen Multiplayer-Dateien. Also **vorher lokal committen &
  pushen**:
  ```bash
  git add .
  git commit -m "Multiplayer-Deathmatch + VPS-Deployment"
  git push
  ```

Im Folgenden steht überall `DEINE-IP` — ersetze das durch die echte IP deines VPS.

---

## 1. Auf dem Server einloggen (von deinem Windows-PC)

Öffne **PowerShell** und verbinde dich per SSH:

```powershell
ssh root@DEINE-IP
```

- Beim ersten Mal fragt er nach dem Fingerprint → `yes` tippen.
- Dann das Root-Passwort eingeben (aus der netcup-Mail). Eventuell musst du beim
  ersten Login ein neues Passwort setzen.

Ab jetzt tippst du alle Befehle **im Server-Fenster** (nicht mehr auf deinem PC).

---

## 2. Grundeinrichtung (einmalig)

```bash
# System aktualisieren
apt update && apt upgrade -y

# 2 GB Swap anlegen — damit dem 1-GB-Server beim Client-Build nicht der RAM ausgeht
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Node.js 22 (LTS) + git installieren
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git

# pm2 (hält die Prozesse dauerhaft am Laufen, auch nach Neustart)
npm install -g pm2

# Kontrolle: sollte Versionsnummern zeigen
node -v && npm -v && pm2 -v
```

---

## 3. Code holen, Abhängigkeiten installieren, Client bauen

```bash
cd /root
git clone https://github.com/SiriusSagittarius/3d-shooter.git
cd 3d-shooter

# --- Server (Colyseus) ---
cd server
npm install
cd ..

# --- Client (Angular) ---
npm install
npm run build        # baut nach dist/3d-shooter/browser  (dauert 1-2 Min)
```

---

## 4. Server + Client dauerhaft starten (pm2)

```bash
# 1) Game-Server (Colyseus) auf Port 2567
cd /root/3d-shooter/server
pm2 start npm --name game -- start

# 2) Client (statische Dateien) auf Port 80, mit SPA-Fallback
pm2 serve /root/3d-shooter/dist/3d-shooter/browser 80 --name web --spa

# 3) Automatisch nach jedem Reboot starten
pm2 save
pm2 startup            # gibt EINEN Befehl aus -> diesen kopieren und ausführen
pm2 save
```

Status prüfen:

```bash
pm2 status             # beide (game, web) sollten "online" sein
pm2 logs game          # Server-Log ansehen (mit Strg+C wieder raus)
```

---

## 5. Firewall freigeben (empfohlen)

**Wichtig:** Zuerst SSH (22) erlauben, damit du dich nicht aussperrst!

```bash
ufw allow 22           # SSH (nicht vergessen!)
ufw allow 80           # Client (Webseite)
ufw allow 2567         # Game-Server
ufw enable             # mit "y" bestätigen
ufw status
```

---

## 6. Spielen 🎮

- Du und deine Freunde öffnet im Browser: **`http://DEINE-IP`**
- Jeder klickt auf **🌐 Mehrspieler (LAN)** — der Client verbindet sich
  automatisch zum Server unter `ws://DEINE-IP:2567`.
- Ihr solltet euch als Soldaten sehen und aufeinander schießen können.

Falls die Verbindung mal woanders hin soll, kannst du sie in der Adresszeile
erzwingen, z. B. `http://DEINE-IP/?server=ws://DEINE-IP:2567`.

---

## 7. Updates einspielen (wenn du am Spiel weiterbaust)

Lokal committen & pushen, dann auf dem Server:

```bash
cd /root/3d-shooter
git pull
npm install            # nur nötig, wenn sich Abhängigkeiten geändert haben
npm run build          # Client neu bauen
cd server && npm install && cd ..
pm2 restart game web   # beide Prozesse neu starten
```

---

## Optional: Domain + HTTPS (wss) mit Caddy

Sobald du eine (Sub-)Domain auf die VPS-IP zeigen lässt (A-Record), bekommst du
mit **Caddy** automatisch ein HTTPS-Zertifikat — dann läuft alles über `https`
und `wss`, ohne „Nicht sicher"-Warnung.

```bash
# Caddy installieren
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

`/etc/caddy/Caddyfile` (ersetze `deine-domain.de`):

```
deine-domain.de {
    handle /colyseus/* {
        reverse_proxy localhost:2567
    }
    handle {
        root * /root/3d-shooter/dist/3d-shooter/browser
        try_files {path} /index.html
        file_server
    }
}
```

Danach `systemctl reload caddy`. Der Client verbindet dann über
`https://deine-domain.de/?server=wss://deine-domain.de/colyseus` — sag mir
Bescheid, dann passe ich das im Client als Standard an, damit du den Parameter
nicht mehr brauchst.

---

## Kleine Problemhilfe
- **Seite lädt nicht:** `pm2 status` — läuft `web`? Firewall Port 80 offen?
- **„Server nicht erreichbar" beim Mehrspieler-Klick:** läuft `game`
  (`pm2 logs game`)? Firewall Port 2567 offen?
- **Build bricht mit „out of memory" ab:** Swap aktiv? `swapon --show` sollte
  2 GB zeigen (siehe Schritt 2).
- **Prozesse nach Reboot weg:** `pm2 startup` samt ausgegebenem Befehl + `pm2 save`
  wiederholen.
```
