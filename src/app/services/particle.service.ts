import { Injectable } from '@angular/core';
import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
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

  public init(scene: THREE.Scene): void {
    this.scene = scene;
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
