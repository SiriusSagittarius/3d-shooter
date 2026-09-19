import * as THREE from 'three';

export class Car {
  public mesh: THREE.Group;
  private speed = 0;
  private maxSpeed = 44.0;       // ~158 km/h Spitze
  private acceleration = 42.0;   // kräftiger Antrieb (Endtempo ~ accel/friction)
  private friction = 1.0;        // wenig Rollreibung -> hohes Endtempo
  private rotationSpeed = 1.9;

  /** Alle vier Räder (rollen beim Fahren). */
  private wheels: THREE.Object3D[] = [];
  /** Vorderräder (lenken zusätzlich sichtbar ein). */
  private frontWheels: THREE.Object3D[] = [];
  /** Lenkrad im Cockpit (dreht um seine lokale Z-Achse). */
  private steeringWheel?: THREE.Object3D;
  /** Radumfang-Faktor: aus Tempo -> Raddrehung pro Sekunde. */
  private readonly wheelRadius = 0.34;
  /** Fahrtrichtung (Gier-Winkel). Quelle der Wahrheit fürs Lenken/Kamera. */
  private heading = 0;
  /** Aktueller Einschlag (weich nachgeführt), -1..1. */
  private steer = 0;
  private readonly maxWheelSteer = 0.5; // Rad-Einschlag in Rad (~28°)

  constructor(model: THREE.Group) {
    // ferrari.glb ist bereits in Metern (~4.5m lang). Die FRONT zeigt nach -Z
    // (Vorderräder bei z<0), das Heck nach +Z. "vorwärts" = -Z, Kamera am Heck (+Z).
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
    for (const name of ['wheel_fl', 'wheel_fr']) {
      const w = model.getObjectByName(name);
      if (w) this.frontWheels.push(w);
    }
    this.steeringWheel = model.getObjectByName('steering_wheel');

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

    // Lenk-Eingabe weich nachführen (für Rad-Einschlag + Lenkrad), -1..1.
    const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.steer += (steerInput - this.steer) * Math.min(1, delta * 8);

    // Lenken (nur wenn wir uns bewegen) — ändert die Fahrtrichtung (heading).
    if (Math.abs(this.speed) > 0.01) {
      const direction = this.speed > 0 ? 1 : -1;
      this.heading += this.steer * this.rotationSpeed * delta * direction;
    }

    // Bewegen: Front zeigt bei heading=0 nach -Z. Horizontal fahren (hangunabhängig).
    this.mesh.position.x += -Math.sin(this.heading) * this.speed * delta;
    this.mesh.position.z += -Math.cos(this.heading) * this.speed * delta;
    this.mesh.rotation.y = this.heading; // flache Ausrichtung (Neigung setzt die Engine im Offroad)

    // Alle Räder rollen (Winkelgeschwindigkeit = v / r) um ihre lokale X-Achse.
    const spin = (this.speed / this.wheelRadius) * delta;
    for (const wheel of this.wheels) wheel.rotation.x -= spin;

    // Vorderräder lenken sichtbar ein (lokale Y-Achse).
    for (const w of this.frontWheels) w.rotation.y = this.steer * this.maxWheelSteer;

    // Lenkrad dreht mit (lokale Z-Achse, stärker als die Räder).
    if (this.steeringWheel) this.steeringWheel.rotation.z = this.steer * 2.2;
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