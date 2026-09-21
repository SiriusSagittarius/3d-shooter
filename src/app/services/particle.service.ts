import { Injectable } from '@angular/core';
import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

/** Kurzer Mündungsblitz: additiver Glow-Sprite, der schnell aufblitzt und verschwindet. */
interface Flash {
  sprite: THREE.Sprite;
  life: number;
  max: number;
}

/**
 * Treffer-Explosionen (portiert aus createExplosion / Partikel-Update der alten main.js).
 * Erzeugt kleine Würfel, die auseinanderfliegen und schrumpfen.
 */
@Injectable({
  providedIn: 'root'
})
export class ParticleService {
  private scene?: THREE.Scene;
  private particles: Particle[] = [];
  private flashes: Flash[] = [];
  private glowTexture?: THREE.Texture;

  public init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Mündungsblitz an einer Weltposition: heller, additiver Glow-Sprite, der in
   * ~70ms aufblitzt und verschwindet. Für eigene Schüsse (vor der Kamera) und
   * die Schüsse der Mitspieler (an deren Waffe).
   */
  public muzzleFlash(position: THREE.Vector3, color = new THREE.Color(0xffdd88)): void {
    if (!this.scene) return;
    if (!this.glowTexture) this.glowTexture = this.makeGlowTexture();

    const mat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: color.clone().multiplyScalar(3), // HDR-Boost -> glüht dank Bloom
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    sprite.scale.setScalar(0.7 + Math.random() * 0.3);
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: 0.07, max: 0.07 });
  }

  /** Radialer Verlauf als geteilte Glow-Textur (einmal erzeugt). */
  private makeGlowTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,220,140,0.85)');
    grad.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }

  /** Erzeugt eine Explosion aus 15 Würfeln an der Trefferposition. */
  public createExplosion(position: THREE.Vector3, color: THREE.Color): void {
    if (!this.scene) return;

    // HDR-Boost (> 1.0): die Splitter glühen dank Bloom richtig auf.
    const glowColor = color.clone().multiplyScalar(2);

    for (let i = 0; i < 15; i++) {
      const size = Math.random() * 0.2 + 0.1;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshBasicMaterial({ color: glowColor });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(position);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      );

      this.scene.add(mesh);
      this.particles.push({ mesh, velocity, life: 0.5 + Math.random() * 0.5 });
    }
  }

  /** Pro Frame aufrufen: bewegt, schrumpft und entfernt abgelaufene Partikel. */
  public update(delta: number): void {
    if (!this.scene) return;

    // Mündungsblitze: kurz aufblitzen, dabei aufblähen + ausblenden.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= delta;
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        (f.sprite.material as THREE.SpriteMaterial).dispose();
        this.flashes.splice(i, 1);
      } else {
        const t = f.life / f.max; // 1 -> 0
        (f.sprite.material as THREE.SpriteMaterial).opacity = t;
        f.sprite.scale.setScalar(0.7 + (1 - t) * 1.6);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta;

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      } else {
        p.mesh.position.addScaledVector(p.velocity, delta);
        p.mesh.scale.setScalar(p.life); // Schrumpfen
      }
    }
  }
}
