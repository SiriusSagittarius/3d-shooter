import * as THREE from 'three';

export class Car {
  public mesh: THREE.Group;
  private speed = 0;
  private maxSpeed = 30.0;
  private acceleration = 20.0;
  private friction = 2.0;
  private rotationSpeed = 2.0;

  /** Die vier Räder des Ferrari (drehen sich beim Fahren mit). */
  private wheels: THREE.Object3D[] = [];
  /** Radumfang-Faktor: aus Tempo -> Raddrehung pro Sekunde. */
  private readonly wheelRadius = 0.34;
  /** Fahrtrichtung (Gier-Winkel). Quelle der Wahrheit fürs Lenken/Kamera. */
  private heading = 0;

  constructor(model: THREE.Group) {
    // ferrari.glb ist bereits in Metern (~4.5m lang). Die FRONT zeigt nach -Z
    // (Vorderräder bei z<0), das Heck nach +Z. Keine Drehung nötig: "vorwärts"
    // = -Z (siehe update -> translateZ(-speed)), die Kamera sitzt am Heck (+Z).
    model.rotation.y = 0;
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Räder greifen (Namen aus dem three.js-Ferrari-Beispiel).
    for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const wheel = model.getObjectByName(name);
      if (wheel) this.wheels.push(wheel);
    }

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

    // Lenken (nur wenn wir uns bewegen) — ändert die Fahrtrichtung (heading).
    if (Math.abs(this.speed) > 0.01) {
      const direction = this.speed > 0 ? 1 : -1;
      const rotDelta = this.rotationSpeed * delta * direction;
      if (input.left) this.heading += rotDelta;
      if (input.right) this.heading -= rotDelta;
    }

    // Bewegen: Front zeigt bei heading=0 nach -Z. Horizontal fahren (hangunabhängig).
    this.mesh.position.x += -Math.sin(this.heading) * this.speed * delta;
    this.mesh.position.z += -Math.cos(this.heading) * this.speed * delta;
    this.mesh.rotation.y = this.heading; // flache Ausrichtung (Neigung setzt die Engine im Offroad)

    // Räder mitdrehen (Winkelgeschwindigkeit = v / r).
    if (this.wheels.length > 0 && Math.abs(this.speed) > 0.001) {
      const spin = (this.speed / this.wheelRadius) * delta;
      for (const wheel of this.wheels) wheel.rotation.x -= spin;
    }
  }

  public setPosition(x: number, y: number, z: number) {
    this.mesh.position.set(x, y, z);
  }

  /** Aktuelle Fahrtrichtung (Gier-Winkel) — für Kamera & Hang-Ausrichtung. */
  public getHeading(): number {
    return this.heading;
  }

  /** Aktuelle Geschwindigkeit in m/s (für Tacho & Motor-Sound). */
  public getSpeed(): number {
    return this.speed;
  }

  public stop() {
    this.speed = 0;
  }
}