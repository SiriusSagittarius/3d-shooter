import { Injectable } from '@angular/core';
import * as THREE from 'three';

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

  constructor() {}

  /**
   * Erstellt die gesamte Spielumgebung und fügt sie der Szene hinzu.
   */
  public createEnvironment(scene: THREE.Scene): void {
    this.environmentGroup = new THREE.Group();
    this.environmentGroup.name = 'Environment';

    this.addLights();
    this.addFloor();
    this.addArena();
    this.addPuddles();
    this.addSky(scene);
    this.addObstacles();
    this.addRings();

    scene.add(this.environmentGroup);
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
    const textureLoader = new THREE.TextureLoader();
    // Falls du Texturen in assets hast:
    // const grassTexture = textureLoader.load('assets/textures/grass.jpg');
    
    const roomSize = 100;
    const floorGeo = new THREE.PlaneGeometry(roomSize * 2, roomSize * 2);
    // Leicht spiegelnder "nasser Asphalt" — wirkt mit Environment-Map + Bloom.
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x08080d,
      roughness: 0.45,
      metalness: 0.35
    });

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.environmentGroup.add(floor);

    // Raster (Tron-Style) — Cyan glüht dank Bloom leicht.
    const grid = new THREE.GridHelper(roomSize * 2, 50, 0x00ffcc, 0x0c2a22);
    grid.position.y = 0.01;
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
    // Tiefblaue Nacht statt Grau — die Neon-Farben stechen dadurch viel mehr.
    scene.background = new THREE.Color(0x05060f);
    scene.fog = new THREE.Fog(0x05060f, 5, 120);

    this.addStars();
    this.addMoon();
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

    // Cyberpunk-Mix: meist warme Fenster, dazwischen Cyan/Magenta/Violett-Türme.
    const palettes = [40, 40, 180, 300, 260];
    const baseHue = palettes[Math.floor(Math.random() * palettes.length)];
    for (let y = 10; y < 256; y += 16) {
      if (Math.random() > 0.9) continue; // dunkles Stockwerk
      for (let x = 8; x < 128; x += 16) {
        if (Math.random() > 0.4) {
          const hue = baseHue + Math.floor(Math.random() * 20 - 10);
          ctx.fillStyle = `hsl(${hue}, 100%, ${Math.random() * 45 + 50}%)`;
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
        emissiveIntensity: 1.2, // > Bloom-Schwelle: Fenster glühen richtig
        roughness: 0.2,
        metalness: 0.5,
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