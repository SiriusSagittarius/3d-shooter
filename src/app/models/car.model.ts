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

  /** Rücklicht-Material (rot; leuchtet beim Bremsen heller). */
  private taillightMats: THREE.MeshStandardMaterial[] = [];
  /** Auspuffflammen (nur beim Gasgeben sichtbar). */
  private flames: THREE.Mesh[] = [];

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

    this.setupLights(model);
    this.setupFlames(model);

    this.mesh = model;
  }

  /** Scheinwerfer (weiß, an) + Rücklicht (rot) aus den Modell-Meshes, plus ein Lichtkegel. */
  private setupLights(model: THREE.Group): void {
    // Scheinwerfer-Glas leuchtet (Bloom macht daraus echtes Licht).
    this.setEmissive(model.getObjectByName('lights'), 0xfff4e0, 2.2);
    // Rücklicht-Glas: rote Grundhelligkeit, Referenzen fürs Bremslicht merken.
    this.taillightMats = this.setEmissive(model.getObjectByName('lights_red'), 0xff1100, 0.8);

    // Echter Scheinwerferkegel, der die Straße/das Terrain vorne ausleuchtet (-Z).
    const beam = new THREE.SpotLight(0xfff2d0, 120, 60, Math.PI / 5, 0.4, 1.5);
    beam.position.set(0, 0.6, -1.9);
    beam.target.position.set(0, -0.2, -14);
    model.add(beam, beam.target);
  }

  /** Setzt Emissiv-Farbe/Stärke auf allen Materialien eines Mesh; gibt sie zurück. */
  private setEmissive(obj: THREE.Object3D | undefined, color: number, intensity: number): THREE.MeshStandardMaterial[] {
    const out: THREE.MeshStandardMaterial[] = [];
    if (!obj) return out;
    const mesh = obj as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (std && std.emissive) {
        std.emissive.setHex(color);
        std.emissiveIntensity = intensity;
        out.push(std);
      }
    }
    return out;
  }

  /** Zwei additive Flammen-Kegel am Heck-Auspuff (+Z), anfangs versteckt. */
  private setupFlames(model: THREE.Group): void {
    for (const fx of [-0.16, 0.16]) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff7722, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.6, 12), mat);
      cone.rotation.x = Math.PI / 2;         // Spitze zeigt nach hinten (+Z)
      cone.position.set(fx, 0.33, 2.35);     // an den Auspuffenden
      cone.visible = false;
      model.add(cone);
      this.flames.push(cone);
    }
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

    // Bremslicht: beim Bremsen (Rückwärtstaste) heller rot.
    const braking = input.backward;
    for (const m of this.taillightMats) m.emissiveIntensity = braking ? 4.5 : 0.8;

    // Auspuffflammen nur beim Gasgeben (Vorwärts) — flackern in Größe/Deckkraft.
    const firing = input.forward;
    for (const f of this.flames) {
      f.visible = firing;
      if (firing) {
        const s = 0.7 + Math.random() * 0.6;
        f.scale.set(s, s, 0.8 + Math.random() * 1.3);
        (f.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.random() * 0.4;
      }
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