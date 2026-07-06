import * as THREE from 'three';

export class Car {
  public mesh: THREE.Group;
  private speed = 0;
  private maxSpeed = 30.0;
  private acceleration = 20.0;
  private friction = 2.0;
  private rotationSpeed = 2.0;

  constructor(model: THREE.Group) {
    // Skalierung/Drehung wie im Original (car.js): Modell ist in cm -> auf Meter.
    model.scale.set(0.015, 0.015, 0.015);
    model.rotation.y = Math.PI / 2;
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    this.mesh = model;
  }

  public update(input: { delta: number, forward: boolean, backward: boolean, left: boolean, right: boolean }) {
    const delta = input.delta;
    // Vorwärts / Rückwärts
    if (input.forward) this.speed += this.acceleration * delta;
    if (input.backward) this.speed -= this.acceleration * delta;

    // Reibung / Ausrollen
    this.speed *= (1 - this.friction * delta);
    if (Math.abs(this.speed) < 0.001) this.speed = 0;

    // Geschwindigkeit begrenzen
    this.speed = THREE.MathUtils.clamp(this.speed, -this.maxSpeed * 0.5, this.maxSpeed);

    // Bewegen
    this.mesh.translateZ(this.speed * delta);

    // Lenken (nur wenn wir uns bewegen)
    if (Math.abs(this.speed) > 0.01) {
      const direction = this.speed > 0 ? 1 : -1;
      const rotDelta = this.rotationSpeed * delta * direction;
      if (input.left) this.mesh.rotation.y += rotDelta;
      if (input.right) this.mesh.rotation.y -= rotDelta;
    }
  }

  public setPosition(x: number, y: number, z: number) {
    this.mesh.position.set(x, y, z);
  }

  /** Aktuelle Geschwindigkeit in m/s (für Tacho & Motor-Sound). */
  public getSpeed(): number {
    return this.speed;
  }

  public stop() {
    this.speed = 0;
  }
}