import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

/** Die drei Spielwelten. */
export type GameWorld = 'arena' | 'world2' | 'offroad';

/** Ein Portal-Objekt: leuchtender Rahmen, dessen Betreten die Welt wechselt. */
export interface Portal {
  mesh: THREE.Object3D;
  /** Welt, in der das Portal steht. */
  from: GameWorld;
  /** Welt, in die dieses Portal führt. */
  target: GameWorld;
}

@Injectable({
  providedIn: 'root'
})
export class LevelService {
  private environmentGroup = new THREE.Group();
  private obstacleBounds: THREE.Box3[] = [];
  /** Treffbare Objekte (Ziele), die der WeaponService per Raycast prüft. */
  private targets: THREE.Object3D[] = [];
  /** Flug-Ringe (Torus) für den Besen-Modus. */
  private rings: THREE.Mesh[] = [];

  /** Zweite Welt (prozedurale Lagerhalle) — eigene Gruppe, anfangs unsichtbar. */
  private world2Group = new THREE.Group();
  /** Dritte Welt (Offroad-Terrain) — eigene Gruppe, anfangs unsichtbar. */
  private offroadGroup = new THREE.Group();
  /** Höhen-Sampler des Offroad-Terrains (x,z -> y). */
  private terrainHeightFn?: (x: number, z: number) => number;
  /** Halbe Kantenlänge des Terrains (Bewegungsgrenze). */
  private terrainHalf = 0;
  /** Portale aller Welten (Betreten = Weltwechsel). */
  private portals: Portal[] = [];
  /** Szenen-Referenz für welt-abhängige Atmosphäre (Nebel/Hintergrund). */
  private sceneRef?: THREE.Scene;

  constructor() {}

  /**
   * Erstellt die gesamte Spielumgebung (Welt 1, die Arena) und fügt sie der Szene hinzu.
   */
  public createEnvironment(scene: THREE.Scene): void {
    this.sceneRef = scene;
    this.environmentGroup = new THREE.Group();
    this.environmentGroup.name = 'Environment';

    this.addLights();
    this.addFloor();
    this.addArena();
    this.addPuddles();
    this.addSky(scene);
    this.addObstacles();
    this.addRings();
    this.addArenaPortal();

    scene.add(this.environmentGroup);
    this.applyAtmosphere('arena'); // Start-Nebel/Hintergrund der Arena
  }

  /**
   * Baut die zweite Welt (prozedurale Lagerhalle) und hängt sie (unsichtbar)
   * in die Szene. Gibt die Gruppe mit der Kollisionsgeometrie zurück, aus der
   * der GameEngineService seinen Octree baut.
   */
  public buildWorldTwo(scene: THREE.Scene): THREE.Object3D {
    this.world2Group = new THREE.Group();
    this.world2Group.name = 'World2';
    this.world2Group.visible = false;

    // Kollidierbare Geometrie (Boden, Wände, Kisten, Laufsteg) — daraus der Octree.
    const solids = new THREE.Group();
    solids.name = 'World2Solids';

    this.buildHall(solids);
    this.buildCrates(solids);
    this.buildBarrels(solids);
    this.buildShelves(solids);
    this.buildCatwalk(solids);
    this.world2Group.add(solids);

    this.addWorldTwoLights();

    // Rück-Portal am Eingang der Halle (führt zurück zur Arena).
    const back = this.makePortal(0x00ffcc);
    back.position.set(0, 1.6, this.hallDepth / 2 - 3);
    this.world2Group.add(back);
    this.portals.push({ mesh: back, from: 'world2', target: 'arena' });

    scene.add(this.world2Group);
    return solids;
  }

  /**
   * Baut die dritte Welt: eine hügelige Offroad-Landschaft (Noise-Heightmap)
   * unter einem Sonnenuntergangs-Himmel (Sky). Hängt sie (unsichtbar) in die Szene.
   */
  public buildOffroad(scene: THREE.Scene): void {
    this.offroadGroup = new THREE.Group();
    this.offroadGroup.name = 'Offroad';
    this.offroadGroup.visible = false;

    const size = 600;           // Kantenlänge des Terrains
    this.terrainHalf = size / 2 - 10;

    // --- Höhenfunktion (mehrere Noise-Oktaven) — auch zur Laufzeit gesampelt ---
    const noise = new ImprovedNoise();
    const seed = Math.random() * 100;
    const heightAt = (x: number, z: number): number => {
      let h = 0, amp = 1, freq = 0.0035, norm = 0;
      for (let o = 0; o < 4; o++) {
        h += noise.noise(x * freq, z * freq, seed) * amp;
        norm += amp; amp *= 0.5; freq *= 2.15;
      }
      h /= norm; // ~ -1..1
      // Zentrum (Spawn) etwas flacher, außen höhere Hügel.
      const d = Math.min(1, Math.hypot(x, z) / 140);
      return h * (6 + 26 * d);
    };
    this.terrainHeightFn = heightAt;

    // --- Terrain-Mesh ---
    const seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const groundTex = this.makeGroundTexture();
    groundTex.repeat.set(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 });
    const terrain = new THREE.Mesh(geo, groundMat);
    terrain.receiveShadow = true;
    this.offroadGroup.add(terrain);

    // --- Himmel (Sky) im Sonnenuntergang ---
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const sun = new THREE.Vector3();
    const u = sky.material.uniforms;
    u['turbidity'].value = 10;
    u['rayleigh'].value = 2.2;
    u['mieCoefficient'].value = 0.005;
    u['mieDirectionalG'].value = 0.8;
    const elevation = 3.5, azimuth = 165; // Sonne tief am Horizont
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    sun.setFromSphericalCoords(1, phi, theta);
    u['sunPosition'].value.copy(sun);
    this.offroadGroup.add(sky);

    // --- Licht passend zur tiefen Sonne ---
    const sunLight = new THREE.DirectionalLight(0xffd2a1, 2.2);
    sunLight.position.copy(sun).multiplyScalar(200);
    const hemi = new THREE.HemisphereLight(0xffd9b0, 0x4a3b2a, 0.7);
    this.offroadGroup.add(sunLight, hemi);

    // --- Ein paar Felsen als Landmarken/Hindernisse ---
    this.scatterRocks(heightAt);

    // Rück-Portal zur Arena (leicht erhöht auf dem Terrain).
    const back = this.makePortal(0x00ffcc);
    back.position.set(0, heightAt(0, 12) + 1.6, 12);
    this.offroadGroup.add(back);
    this.portals.push({ mesh: back, from: 'offroad', target: 'arena' });

    scene.add(this.offroadGroup);
  }

  /** Streut Felsblöcke aufs Terrain (auf Terrainhöhe abgesetzt). */
  private scatterRocks(heightAt: (x: number, z: number) => number): void {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b6257, roughness: 1, metalness: 0, flatShading: true });
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() * 2 - 1) * this.terrainHalf;
      const z = (Math.random() * 2 - 1) * this.terrainHalf;
      if (Math.hypot(x, z) < 20) continue; // Spawn frei halten
      const s = 1.5 + Math.random() * 4;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
      rock.position.set(x, heightAt(x, z) + s * 0.4, z);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.scale.y = 0.7 + Math.random() * 0.5;
      this.offroadGroup.add(rock);
    }
  }

  /** Canvas-Textur: sandiger Wüstenboden mit Körnung und Farbflecken. */
  private makeGroundTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d')!;
    x.fillStyle = '#b5945f'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = Math.random() * 50 - 25;
      x.fillStyle = `rgba(${181 + v},${148 + v},${95 + v},0.5)`;
      x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    // Ein paar dunklere Geröll-Flecken.
    for (let i = 0; i < 60; i++) {
      x.fillStyle = `rgba(90,74,48,${Math.random() * 0.3})`;
      x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, Math.random() * 6 + 2, 0, Math.PI * 2); x.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // Maße der Lagerhalle (Welt 2).
  private readonly hallWidth = 60;
  private readonly hallDepth = 60;
  private readonly hallHeight = 14;

  /** Beleuchtung der Lagerhalle: warmes Grundlicht + Decken-Spots. */
  private addWorldTwoLights(): void {
    const amb = new THREE.HemisphereLight(0xdfe6ff, 0x20242c, 1.0);
    this.world2Group.add(amb);

    // Ein paar warme Deckenlampen als Punktlichter (begrenzte Reichweite = billig).
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const light = new THREE.PointLight(0xffe6c0, 120, 34, 2);
        light.position.set(gx * this.hallWidth / 3, this.hallHeight - 1.5, gz * this.hallDepth / 3);
        this.world2Group.add(light);
      }
    }
  }

  /** Boden, vier Wände und Decke mit leuchtenden Lichtpaneelen. */
  private buildHall(parent: THREE.Group): void {
    const W = this.hallWidth, D = this.hallDepth, H = this.hallHeight;

    const concrete = this.makeConcreteTexture();
    const floorTex = concrete.clone(); floorTex.needsUpdate = true; floorTex.repeat.set(8, 8);
    const wallTex = concrete.clone(); wallTex.needsUpdate = true; wallTex.repeat.set(6, 2);

    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, color: 0x8a8f96, roughness: 0.9, metalness: 0.05 });
    const wallMat  = new THREE.MeshStandardMaterial({ map: wallTex,  color: 0x6f747c, roughness: 0.95, metalness: 0.05 });
    const ceilMat  = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 1 });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 1, D), floorMat);
    floor.position.y = -0.5;
    parent.add(floor);

    const ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 1, D), ceilMat);
    ceil.position.y = H + 0.5;
    parent.add(ceil);

    // Leuchtende Deckenpaneele (emissiv -> Bloom).
    const panelMat = new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xffe6b0, emissiveIntensity: 1.4 });
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 6), panelMat);
        panel.position.set(gx * W / 3, H - 0.4, gz * D / 3);
        this.world2Group.add(panel); // nicht kollidierbar
      }
    }

    // Vier Wände (als Kollisionsboxen).
    const t = 1;
    const walls: [number, number, number, number, number, number][] = [
      [0, H / 2, -D / 2, W, H, t],  // hinten
      [0, H / 2,  D / 2, W, H, t],  // vorne (Eingang)
      [-W / 2, H / 2, 0, t, H, D],  // links
      [ W / 2, H / 2, 0, t, H, D],  // rechts
    ];
    for (const [x, y, z, sx, sy, sz] of walls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
      wall.position.set(x, y, z);
      parent.add(wall);
    }

    // Stützpfeiler.
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x55585f, roughness: 0.8, metalness: 0.3 });
    for (const px of [-W / 4, W / 4]) {
      for (const pz of [-D / 4, D / 4]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, H, 12), pillarMat);
        pillar.position.set(px, H / 2, pz);
        parent.add(pillar);
      }
    }
  }

  /** Gestapelte Kisten als Deckung, in Reihen verteilt. */
  private buildCrates(parent: THREE.Group): void {
    const crateTex = this.makeCrateTexture();
    const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.8, metalness: 0.1 });

    const place = (x: number, z: number, s: number, y = s / 2) => {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      crate.position.set(x, y, z);
      crate.rotation.y = Math.random() * 0.3 - 0.15;
      parent.add(crate);
    };

    // Ein paar Stapel und Einzelkisten, symmetrisch verteilt (nicht am Eingang).
    const spots: [number, number][] = [
      [-16, -14], [-12, -14], [-14, -10],
      [15, -12], [18, -12], [16.5, -15.5],
      [-18, 8], [-15, 8], [12, 10], [15, 10], [13.5, 6],
      [0, -18], [4, -18],
    ];
    for (const [x, z] of spots) {
      place(x, z, 2);
      if (Math.random() > 0.5) place(x, z, 1.4, 2 + 0.7); // Kiste obendrauf
    }
  }

  /** Öltonnen/Fässer in Gruppen — Industrie-Deko und Deckung. */
  private buildBarrels(parent: THREE.Group): void {
    const colors = [0xb23a2a, 0x2a5db2, 0x3a8a3a, 0xc9a227]; // rot, blau, grün, gelb
    const barrel = (x: number, z: number, color: number) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.6 });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 16), mat);
      b.position.set(x, 0.75, z);
      // Zwei Sicken (Ringe) andeuten.
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.7 });
      for (const ry of [-0.35, 0.35]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 20), ringMat);
        ring.rotation.x = Math.PI / 2; ring.position.y = ry; b.add(ring);
      }
      parent.add(b);
    };
    // Ein paar Fässer-Gruppen verteilt.
    const groups: [number, number][] = [[-22, 0], [22, -2], [-6, -20], [8, 18], [20, 16]];
    for (const [gx, gz] of groups) {
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        barrel(gx + (Math.random() * 2 - 1) * 1.2, gz + (Math.random() * 2 - 1) * 1.2,
                colors[Math.floor(Math.random() * colors.length)]);
      }
    }
  }

  /** Metall-Regale an den Seitenwänden (mit Böden zum Dahinter-Verstecken). */
  private buildShelves(parent: THREE.Group): void {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.7 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x6a5230, roughness: 0.8, metalness: 0.1 });

    const rack = (x: number, z: number, rotY: number) => {
      const g = new THREE.Group();
      const W = 6, H = 5, Dp = 1.4;
      // Vier Eckpfosten
      for (const sx of [-W / 2, W / 2]) for (const sz of [-Dp / 2, Dp / 2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, H, 0.15), frameMat);
        post.position.set(sx, H / 2, sz); g.add(post);
      }
      // Drei Böden
      for (const sy of [1, 2.5, 4]) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, Dp), shelfMat);
        shelf.position.set(0, sy, 0); g.add(shelf);
      }
      g.position.set(x, 0, z); g.rotation.y = rotY;
      parent.add(g);
    };
    // An linker und rechter Wand ein paar Regale.
    rack(-this.hallWidth / 2 + 1.2, -6, 0);
    rack(-this.hallWidth / 2 + 1.2, 6, 0);
    rack(this.hallWidth / 2 - 1.2, -8, 0);
    rack(this.hallWidth / 2 - 1.2, 10, 0);
  }

  /** Erhöhter Laufsteg an der hinteren Wand mit Rampe hoch. */
  private buildCatwalk(parent: THREE.Group): void {
    const W = this.hallWidth, D = this.hallDepth;
    const mat = new THREE.MeshStandardMaterial({ color: 0x767b82, roughness: 0.7, metalness: 0.4 });
    const y = 4;

    // Podest entlang der hinteren Wand.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W - 6, 0.5, 8), mat);
    deck.position.set(0, y, -D / 2 + 5);
    parent.add(deck);

    // Rampe hoch (schräge Box).
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 14), mat);
    ramp.position.set(-W / 2 + 8, y / 2, -D / 2 + 13);
    ramp.rotation.x = Math.atan2(y, 14);
    parent.add(ramp);

    // Geländer-Andeutung (dünne Boxen) — reine Deko.
    const railMat = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.6, metalness: 0.6 });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(W - 6, 1, 0.15), railMat);
    rail.position.set(0, y + 0.9, -D / 2 + 9);
    this.world2Group.add(rail);
  }

  /** Canvas-Textur: rauer Beton mit Flecken und Fugen. */
  private makeConcreteTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#7c8088'; ctx.fillRect(0, 0, 256, 256);
    // Körnung
    for (let i = 0; i < 5000; i++) {
      const v = Math.random() * 40 - 20;
      ctx.fillStyle = `rgba(${128 + v},${132 + v},${140 + v},0.4)`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    // Fugen-Raster
    ctx.strokeStyle = 'rgba(40,42,48,0.6)'; ctx.lineWidth = 2;
    for (let p = 0; p <= 256; p += 64) {
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(256, p); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /** Canvas-Textur: Holzkiste mit Rahmen und Warnstreifen. */
  private makeCrateTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#9c6b34'; ctx.fillRect(0, 0, 128, 128);
    // Bretter-Fugen
    for (let y = 8; y < 128; y += 24) { ctx.fillStyle = 'rgba(80,52,22,0.5)'; ctx.fillRect(0, y, 128, 3); }
    // Rahmen
    ctx.strokeStyle = '#5c3d1c'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 120, 120);
    // Diagonale Warnstreifen-Ecke
    ctx.fillStyle = '#d8b545';
    ctx.beginPath(); ctx.moveTo(88, 0); ctx.lineTo(128, 0); ctx.lineTo(128, 40); ctx.closePath(); ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  /** Schaltet die sichtbare Welt um (die anderen bleiben zum Zurückwechseln erhalten). */
  public setWorld(which: GameWorld): void {
    this.environmentGroup.visible = which === 'arena';
    this.world2Group.visible = which === 'world2';
    this.offroadGroup.visible = which === 'offroad';
    this.applyAtmosphere(which);
  }

  /** Terrainhöhe an (x,z) — außerhalb des Offroad-Terrains 0. */
  public getTerrainHeight(x: number, z: number): number {
    return this.terrainHeightFn ? this.terrainHeightFn(x, z) : 0;
  }

  /** Halbe Kantenlänge des Offroad-Terrains (für Bewegungsgrenzen). */
  public getTerrainHalf(): number {
    return this.terrainHalf;
  }

  public getPortals(): Portal[] {
    return this.portals;
  }

  /** Zwei leuchtende Portale in der Arena: Lagerhalle (magenta) + Offroad (orange). */
  private addArenaPortal(): void {
    const toHall = this.makePortal(0xff44ff);
    toHall.position.set(-5, 1.6, 8);
    this.environmentGroup.add(toHall);
    this.portals.push({ mesh: toHall, from: 'arena', target: 'world2' });

    const toOffroad = this.makePortal(0xff8822);
    toOffroad.position.set(5, 1.6, 8);
    this.environmentGroup.add(toOffroad);
    this.portals.push({ mesh: toOffroad, from: 'arena', target: 'offroad' });
  }

  /** Baut einen leuchtenden Torus-Türrahmen als Portal. */
  private makePortal(color: number): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'portal';

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.18, 16, 48),
      new THREE.MeshBasicMaterial({ color })
    );
    // Innenscheibe als leicht schimmernde "Membran".
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    group.add(ring, disc);
    return group;
  }

  public getObstacleBounds(): THREE.Box3[] {
    return this.obstacleBounds;
  }

  /** Liste der beschießbaren Ziele (Gebäude, Laternen). */
  public getTargets(): THREE.Object3D[] {
    return this.targets;
  }

  /** Sichtbare Flug-Ringe (für den Durchflug-Check im Besen-Modus). */
  public getRings(): THREE.Mesh[] {
    return this.rings;
  }

  private addLights(): void {
    // Nachtszene: kühles, bläuliches Grundlicht + Mondlicht. Keine Schatten (Performance).
    const ambientLight = new THREE.AmbientLight(0x334466, 1.6);
    const moonLight = new THREE.DirectionalLight(0x99aaff, 0.7);
    moonLight.position.set(50, 100, 50);

    this.environmentGroup.add(ambientLight, moonLight);
  }

  private addFloor(): void {
    const roomSize = 100;

    // Dunkler Basisboden ganz unten (fällt der Reflektor mal aus, ist trotzdem Boden da).
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.6, metalness: 0.2 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomSize * 2, roomSize * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.environmentGroup.add(floor);

    // NASSER ASPHALT: echter Spiegel (Reflector) für Neon-Reflexionen der Stadt.
    // Dunkel getönt -> wirkt wie eine regennasse Straße, kein perfekter Spiegel.
    const mirror = new Reflector(new THREE.PlaneGeometry(roomSize * 2, roomSize * 2), {
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x2a3340, // dunkle Tönung = gedämpfte, realistisch nasse Reflexion
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = 0.02;
    this.environmentGroup.add(mirror);

    // Raster (Tron-Style) — Cyan glüht dank Bloom leicht, schwebt knapp über dem Spiegel.
    const grid = new THREE.GridHelper(roomSize * 2, 50, 0x00ffcc, 0x0c2a22);
    grid.position.y = 0.04;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.environmentGroup.add(grid);
  }

  private addArena(): void {
    const roomSize = 100;
    const wallHeight = 20;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x333333 });

    const walls = [
      { pos: [0, wallHeight / 2, -roomSize], size: [roomSize * 2, wallHeight, 2] }, // Hinten
      { pos: [0, wallHeight / 2, roomSize], size: [roomSize * 2, wallHeight, 2] },  // Vorne
      { pos: [-roomSize, wallHeight / 2, 0], size: [2, wallHeight, roomSize * 2] }, // Links
      { pos: [roomSize, wallHeight / 2, 0], size: [2, wallHeight, roomSize * 2] }   // Rechts
    ];

    walls.forEach(w => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(...w.size), wallMat);
      wall.position.set(w.pos[0], w.pos[1], w.pos[2]);
      this.environmentGroup.add(wall);
      this.obstacleBounds.push(new THREE.Box3().setFromObject(wall));
    });
  }

  private addPuddles(): void {
    const puddleGeo = new THREE.CircleGeometry(1, 32);
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.0,
      metalness: 0.8,
      transparent: true,
      opacity: 0.6,
    });

    for (let i = 0; i < 30; i++) {
      const puddle = new THREE.Mesh(puddleGeo, puddleMat);
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(Math.random() * 180 - 90, 0.03, Math.random() * 180 - 90);
      this.environmentGroup.add(puddle);
    }
  }

  private addSky(scene: THREE.Scene): void {
    // Sterne + Mond gehören zur Arena-Gruppe (blenden mit ihr aus).
    // Hintergrund/Nebel setzt applyAtmosphere() pro Welt.
    this.addStars();
    this.addMoon();
  }

  /** Setzt Hintergrund + Nebel passend zur aktiven Welt. */
  private applyAtmosphere(world: GameWorld): void {
    const scene = this.sceneRef;
    if (!scene) return;
    if (world === 'arena') {
      scene.background = new THREE.Color(0x05060f);
      scene.fog = new THREE.Fog(0x05060f, 5, 120);
    } else if (world === 'world2') {
      // Geschlossene Halle: nur ganz dezenter Tiefen-Nebel.
      scene.background = new THREE.Color(0x0a0c10);
      scene.fog = new THREE.Fog(0x0a0c10, 25, 150);
    } else {
      // Offroad: warmer Dunst bei Sonnenuntergang, weite Sicht. Himmel = Sky-Mesh.
      scene.fog = new THREE.Fog(0xdCA06a, 60, 520);
      // background bleibt vom Sky-Mesh verdeckt.
    }
  }

  /** Sternenhimmel: Punkte auf einer Halbkugel, vom Nebel ausgenommen. */
  private addStars(): void {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Zufällige Richtung auf der oberen Halbkugel, Radius ~350–450.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random()); // obere Hälfte
      const r = 350 + Math.random() * 100;
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.max(15, r * Math.cos(phi));
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xaaccff,
      size: 1.5,
      sizeAttenuation: false, // Pixelgröße konstant
      fog: false,             // Sterne nicht im Nebel verschlucken
      transparent: true,
      opacity: 0.85,
    });
    this.environmentGroup.add(new THREE.Points(geo, mat));
  }

  /** Großer, weich glühender Mond am Himmel (additiver Glow-Sprite). */
  private addMoon(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(220,230,255,0.9)');
    grad.addColorStop(0.5, 'rgba(160,180,255,0.25)');
    grad.addColorStop(1, 'rgba(160,180,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const mat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      color: 0xd8e2ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const moon = new THREE.Sprite(mat);
    moon.scale.setScalar(90);
    moon.position.set(180, 170, -260);
    this.environmentGroup.add(moon);
  }

  /** Erzeugt eine Canvas-Textur für eine Hochhaus-Fassade mit leuchtenden Fenstern. */
  private createBuildingTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, 128, 256);

    // Ruhige Nacht-Fassade: überwiegend warmes Fensterlicht, gedämpfte Sättigung.
    // Die meisten Fenster sind an oder aus (nicht bunt blinkend); nur wenige kühl.
    const warm = Math.random() < 0.8;         // Gebäude ist entweder warm oder kühl getönt
    const baseHue = warm ? 38 : 210;          // 38 = warmweiß/amber, 210 = kühles Blau
    for (let y = 10; y < 256; y += 16) {
      if (Math.random() > 0.82) continue;     // dunkles Stockwerk (mehr Kontrast, weniger Wand-aus-Licht)
      for (let x = 8; x < 128; x += 16) {
        if (Math.random() > 0.5) {
          const hue = baseHue + Math.floor(Math.random() * 8 - 4);
          const sat = 30 + Math.random() * 20; // dezent statt neongrell (war 100%)
          const light = 45 + Math.random() * 25;
          ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
          ctx.fillRect(x, y, 8, 12);
        }
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  /**
   * Liefert eine zufällige Bodenposition, die NICHT in den Spawn-Freizonen liegt
   * (Spieler-Start ~0/20, Auto-Park ~15/15), damit man nicht sofort feststeckt.
   */
  private randomFreeSpot(clearRadius: number): { x: number; z: number } {
    const clearZones = [
      { x: 0, z: 20 },  // Spieler-Spawn
      { x: 15, z: 15 }, // Auto-Park
    ];
    for (let tries = 0; tries < 30; tries++) {
      const x = Math.random() * 180 - 90;
      const z = Math.random() * 180 - 90;
      const blocked = clearZones.some(c => Math.hypot(x - c.x, z - c.z) < clearRadius);
      if (!blocked) return { x, z };
    }
    // Fallback: weit außen platzieren.
    return { x: 80, z: -80 };
  }

  /** Stadt: leuchtende Hochhäuser + Straßenlaternen (portiert aus level-boxes.js). */
  private addObstacles(): void {
    this.targets = [];

    // --- HOCHHÄUSER ---
    for (let i = 0; i < 50; i++) {
      const width = Math.random() * 10 + 5;
      const depth = Math.random() * 10 + 5;
      const height = Math.random() * 50 + 20;

      const texture = this.createBuildingTexture();
      texture.repeat.set(width / 10, height / 20);

      const material = new THREE.MeshStandardMaterial({
        map: texture,
        emissive: 0xffffff,
        emissiveMap: texture,
        emissiveIntensity: 0.65, // dezentes Fensterleuchten statt Disco-Glühen
        roughness: 0.35,
        metalness: 0.4,
      });

      const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      const spot = this.randomFreeSpot(18);
      building.position.set(spot.x, height / 2, spot.z);
      building.name = 'target';
      building.updateMatrixWorld();

      this.environmentGroup.add(building);
      this.obstacleBounds.push(new THREE.Box3().setFromObject(building));
      this.targets.push(building);
    }

    // --- STRASSENLATERNEN ---
    // Der glühende Kopf (MeshBasic) ist billig -> bei allen Laternen.
    // Echte Punktlichter sind teuer -> nur bei wenigen, mit kleiner Reichweite.
    const poleHeight = 8;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, poleHeight);
    const bulbGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

    const lanternCount = 20;
    const litLanterns = 8; // nur so viele bekommen ein echtes Punktlicht
    for (let i = 0; i < lanternCount; i++) {
      const { x, z } = this.randomFreeSpot(12);

      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, poleHeight / 2, z);
      pole.name = 'target';
      pole.updateMatrixWorld();
      this.environmentGroup.add(pole);
      this.targets.push(pole);

      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(x, poleHeight, z);
      this.environmentGroup.add(bulb);

      if (i < litLanterns) {
        const light = new THREE.PointLight(0xffaa00, 200, 18);
        light.position.set(x, poleHeight, z);
        this.environmentGroup.add(light);
      }
    }
  }

  /** Leuchtende Flug-Ringe hoch in der Luft (durchfliegen mit dem Besen = Punkte). */
  private addRings(): void {
    this.rings = [];
    const ringGeo = new THREE.TorusGeometry(4, 0.4, 16, 100);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });

    for (let i = 0; i < 20; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(
        Math.random() * 180 - 90,
        Math.random() * 50 + 30, // Höhe 30–80
        Math.random() * 180 - 90
      );
      ring.rotation.y = Math.random() * Math.PI;
      this.environmentGroup.add(ring);
      this.rings.push(ring);
    }
  }
}