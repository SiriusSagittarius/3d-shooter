import * as THREE from 'three';

export class Broom {
  public isActive = false;
  
  // Konstanten aus der ursprünglichen Logik
  private readonly flySpeed = 50.0;
  private readonly airResistance = 2.0;
  private readonly rollDamping = 0.95;
  private readonly floorHeight = 2.0;

  constructor() {}

  /**
   * Schaltet den Flugmodus um (entspricht broom.toggle() aus main.js).
   */
  public toggle(): boolean {
    this.isActive = !this.isActive;
    return this.isActive;
  }

  /**
   * Berechnet die Flugbewegung und gibt die neue Roll-Geschwindigkeit zurück.
   * @param delta Zeit seit dem letzten Frame
   * @param velocity Der aktuelle Geschwindigkeitsvektor des Spielers
   * @param camera Die Kamera (für die Blickrichtung)
   * @param isAccelerating Ob die linke Maustaste gedrückt wird
   * @param currentRollVelocity Die aktuelle Roll-Geschwindigkeit (Mausrad)
   */
  public update(
    delta: number,
    velocity: THREE.Vector3,
    camera: THREE.Camera,
    isAccelerating: boolean,
    currentRollVelocity: number
  ): number {
    if (!this.isActive) return 0;

    // 1. Luftwiderstand anwenden (velocity.multiplyScalar(1.0 - 2.0 * delta))
    velocity.multiplyScalar(1.0 - this.airResistance * delta);

    // 2. Beschleunigung in Blickrichtung
    if (isAccelerating) {
      const flyDir = new THREE.Vector3();
      camera.getWorldDirection(flyDir);
      velocity.addScaledVector(flyDir, this.flySpeed * delta);
    }

    // 3. Roll-Dämpfung berechnen
    return currentRollVelocity * this.rollDamping;
  }

  /**
   * Überprüft die Kollision mit dem Boden.
   */
  public checkFloorCollision(position: THREE.Vector3, velocity: THREE.Vector3): void {
    if (position.y < this.floorHeight) {
      position.y = this.floorHeight;
      velocity.y = Math.max(0, velocity.y);
    }
  }

  public getWindVolume(speed: number): number {
    return Math.min(1.0, speed / 30.0);
  }
}