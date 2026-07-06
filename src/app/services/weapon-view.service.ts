import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

/**
 * First-Person-Waffenmodell in 3D — ersetzt das alte 2D-PNG.
 * Das Modell hängt als Kind an der Kamera und bekommt Waffen-Bob,
 * Feder-Rückstoß, Nachlade-Absenkung und ein 3D-Mündungsfeuer
 * (additiver Sprite + kurzes Punktlicht, glüht dank Bloom richtig).
 */
@Injectable({
  providedIn: 'root'
})
export class WeaponViewService {
  private group = new THREE.Group();
  private clock = new THREE.Clock();
  private flashSprite?: THREE.Sprite;
  private flashLight?: THREE.PointLight;

  private recoil = 0;      // 1 direkt nach dem Schuss, federt auf 0 zurück
  private reloadAnim = 0;  // 0 = normal, 1 = ganz abgesenkt (Nachladen)
  private reloading = false;
  private flashTime = 0;
  private bobTime = 0;

  /** Ruheposition in Kamera-Koordinaten: rechts unten, leicht nach vorn. */
  private readonly basePos = new THREE.Vector3(0.3, -0.28, -0.6);
  private readonly flashDuration = 0.07;

  // Die MTL-Farben des Packs sind fast schwarz — eigenes Gunmetal-Schema
  // pro Material-Name, damit die Waffe in der Nachtszene lesbar bleibt.
  private readonly gunPalette: Record<string, number> = {
    Black: 0x1a1d22,
    DarkMetal: 0x2e343d,
    Grey: 0x4a525e,
    LightMetal: 0x7a828f,
    Glass: 0x224455,
  };

  /** Lädt das Sniper-Modell und hängt es an die Kamera. */
  public async init(camera: THREE.Camera): Promise<void> {
    const mtl = await new MTLLoader().setPath('assets/OBJ/').loadAsync('SniperRifle_2.mtl');
    mtl.preload();
    const model = await new OBJLoader()
      .setMaterials(mtl)
      .setPath('assets/OBJ/')
      .loadAsync('SniperRifle_2.obj');

    // Zentrieren + normalisieren: der Lauf zeigt im OBJ nach +X (per Geometrie-
    // Analyse ermittelt) -> um 90° drehen, damit er nach -Z (Blickrichtung) zeigt,
    // und auf ~1.05m Gesamtlänge skalieren.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);

    const holder = new THREE.Group();
    holder.add(model);
    holder.rotation.y = Math.PI / 2; // +X -> -Z
    holder.scale.setScalar(1.05 / size.x);

    this.applyGunMaterials(model);
    this.createMuzzleFlash();

    this.group.add(holder);
    this.group.position.copy(this.basePos);
    camera.add(this.group);
  }

  /**
   * Pro Frame aufrufen: Sichtbarkeit, Bob, Rückstoß-Feder, Reload-Absenkung
   * und Mündungsfeuer-Ausklingen.
   */
  public update(state: { visible: boolean; moving: boolean; sprinting: boolean }): void {
    const delta = Math.min(this.clock.getDelta(), 0.1);

    this.group.visible = state.visible;
    if (!state.visible) return;

    // Rückstoß federt zurück, Reload-Absenkung lerpt Richtung Ziel.
    this.recoil = Math.max(0, this.recoil - delta * 6);
    const reloadTarget = this.reloading ? 1 : 0;
    this.reloadAnim += (reloadTarget - this.reloadAnim) * Math.min(1, delta * 7);

    // Waffen-Bob nur bei Bewegung (Sprint = schneller + tiefer getragen).
    if (state.moving) this.bobTime += delta * (state.sprinting ? 11 : 6);
    const bobX = Math.sin(this.bobTime) * 0.015;
    const bobY = Math.abs(Math.cos(this.bobTime)) * 0.02;
    const sprintDrop = state.sprinting && state.moving ? 0.07 : 0;

    this.group.position.set(
      this.basePos.x + bobX,
      this.basePos.y - bobY - sprintDrop - this.reloadAnim * 0.32,
      this.basePos.z + this.recoil * 0.14
    );
    this.group.rotation.x = this.recoil * 0.12 - this.reloadAnim * 0.7;
    this.group.rotation.z = this.reloadAnim * 0.3;

    // Mündungsfeuer schnell ausblenden.
    this.flashTime = Math.max(0, this.flashTime - delta);
    const flash = this.flashTime / this.flashDuration;
    if (this.flashSprite) this.flashSprite.visible = this.flashTime > 0;
    if (this.flashLight) {
      this.flashLight.visible = this.flashTime > 0;
      this.flashLight.intensity = 60 * flash;
    }
  }

  /** Schuss: Rückstoß anstoßen + Mündungsfeuer zünden (zufällig rotiert). */
  public triggerShot(): void {
    this.recoil = 1;
    this.flashTime = this.flashDuration;
    if (this.flashSprite) {
      (this.flashSprite.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
      this.flashSprite.scale.setScalar(0.3 + Math.random() * 0.15);
    }
  }

  public setReloading(reloading: boolean): void {
    this.reloading = reloading;
  }

  /** Materialien nach Namen auf das Gunmetal-Schema umziehen (PBR statt Phong). */
  private applyGunMaterials(model: THREE.Object3D): void {
    model.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;

      // Viewmodel nie wegcullen (sitzt direkt an der Kamera).
      mesh.frustumCulled = false;

      const convert = (mat: THREE.Material): THREE.Material => {
        const color = this.gunPalette[mat.name] ?? 0x3a4048;
        const std = new THREE.MeshStandardMaterial({
          color,
          metalness: 0.65,
          roughness: 0.35,
        });
        // Zieloptik-Glas leuchtet cyan (passt zum Neon-Look, bloomt leicht).
        if (mat.name === 'Glass') {
          std.emissive = new THREE.Color(0x00ccff);
          std.emissiveIntensity = 1.2;
        }
        std.name = mat.name;
        return std;
      };

      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(convert)
        : convert(mesh.material);
    });
  }

  /** Mündungsfeuer an der Laufspitze: heißer radialer Sprite + Punktlicht. */
  private createMuzzleFlash(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,220,120,0.9)');
    grad.addColorStop(0.6, 'rgba(255,140,40,0.35)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      color: 0xffddaa,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.flashSprite.position.set(0, 0.03, -0.58); // Laufspitze
    this.flashSprite.visible = false;

    this.flashLight = new THREE.PointLight(0xffb366, 0, 6);
    this.flashLight.position.copy(this.flashSprite.position);
    this.flashLight.visible = false;

    this.group.add(this.flashSprite, this.flashLight);
  }
}
