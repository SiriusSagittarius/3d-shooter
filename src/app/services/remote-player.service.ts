import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { NetPlayer } from './network.service';

/** Ein sichtbarer Mitspieler-Avatar (geklonter Soldat + Trefferbox + Animation). */
interface Avatar {
  root: THREE.Group;
  /** Unsichtbare, raycastbare Trefferbox (das eigentliche Schuss-Ziel). */
  hitbox: THREE.Mesh;
  mixer?: THREE.AnimationMixer;
  idle?: THREE.AnimationAction;
  walk?: THREE.AnimationAction;
  /** Ziel-Zustand aus dem Netzwerk (Position wird weich interpoliert). */
  target: THREE.Vector3;
  targetRy: number;
  moving: boolean;
  dead: boolean;
  current: 'idle' | 'walk' | null;
}

/** Skalierung/Fusspunkt passend zum Soldier.glb (wie im EnemyService fuer 'jaeger'). */
const MODEL_SCALE = 1.3;
/** Augenhoehe des Spielers: die Kamera sitzt 1.6m ueber den Fuessen des Avatars. */
const EYE_HEIGHT = 1.6;

/**
 * Stellt die anderen Spieler als animierte Soldaten dar. Bekommt pro Frame den
 * Netzwerk-State und gleicht die Avatare an: neue anlegen, verschwundene entfernen,
 * Position interpolieren, Lauf-/Ruhe-Animation je nach Bewegung.
 */
@Injectable({ providedIn: 'root' })
export class RemotePlayerService {
  private scene?: THREE.Scene;
  private model?: { scene: THREE.Object3D; clips: THREE.AnimationClip[] };
  private avatars = new Map<string, Avatar>();
  private clock = new THREE.Clock();

  public init(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /** Uebergibt das (bereits geladene) Soldaten-Modell zum Klonen. */
  public setModel(scene: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    this.model = { scene, clips };
  }

  public get ready(): boolean {
    return !!this.scene && !!this.model;
  }

  /**
   * Gleicht die Avatare an den Netzwerk-State an: legt fehlende an, entfernt
   * verschwundene und uebernimmt die Ziel-Position/Blickrichtung (ohne den
   * eigenen Spieler ownId). Aufruf pro Frame.
   */
  public sync(players: Map<string, NetPlayer> | undefined, ownId: string): void {
    if (!players || !this.ready) return;

    players.forEach((p, id) => {
      if (id === ownId) return;
      let a = this.avatars.get(id);
      if (!a) a = this.spawnAvatar(id);
      if (!a) return;
      // Kamera-Position (Augenhoehe) -> Avatar-Fusspunkt.
      a.target.set(p.x, p.y - EYE_HEIGHT, p.z);
      a.targetRy = p.ry;
      a.moving = p.moving;
      a.dead = p.dead;
    });

    // Nicht mehr vorhandene Spieler entfernen.
    for (const id of [...this.avatars.keys()]) {
      if (!players.has(id)) this.removeAvatar(id);
    }
  }

  /** Interpoliert Positionen, dreht die Avatare und treibt ihre Animationen. */
  public update(): void {
    const delta = this.clock.getDelta();
    for (const a of this.avatars.values()) {
      // Weiche Annaeherung an die Netzwerk-Position (kaschiert Latenz/Ruckeln).
      a.root.position.lerp(a.target, Math.min(1, delta * 12));
      a.root.rotation.y = a.targetRy + Math.PI; // Soldat schaut in Blickrichtung
      a.root.visible = !a.dead;

      // Lauf-Animation bei Bewegung, sonst Ruhe.
      const want: 'idle' | 'walk' = a.moving && !a.dead ? 'walk' : 'idle';
      if (want !== a.current) this.setAnimation(a, want);

      a.mixer?.update(delta);
    }
  }

  /** Trefferboxen aller Avatare (fuer die Schuss-Ziel-Liste im GameComponent). */
  public getHitboxes(): THREE.Object3D[] {
    return [...this.avatars.values()].map(a => a.hitbox);
  }

  /** Weltpositionen aller Avatare (fuer die Minimap — Mitspieler finden). */
  public getPositions(): { x: number; z: number }[] {
    return [...this.avatars.values()]
      .filter(a => !a.dead)
      .map(a => ({ x: a.root.position.x, z: a.root.position.z }));
  }

  /**
   * Ermittelt, welchem Spieler ein getroffenes Objekt gehoert (Parent-Kette hoch).
   * Liefert die Session-ID oder null, wenn kein Avatar getroffen wurde.
   */
  public resolveHit(object: THREE.Object3D): string | null {
    let node: THREE.Object3D | null = object;
    while (node) {
      const id = node.userData?.['playerId'];
      if (typeof id === 'string') return id;
      node = node.parent;
    }
    return null;
  }

  /** Entfernt alle Avatare (beim Verlassen des Multiplayers). */
  public clear(): void {
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
  }

  // ------------------------------------------------------------------

  private spawnAvatar(id: string): Avatar | undefined {
    if (!this.scene || !this.model) return undefined;

    const root = new THREE.Group();
    root.name = 'remotePlayer';
    root.userData['playerId'] = id;

    const inst = cloneSkinned(this.model.scene);
    inst.scale.setScalar(MODEL_SCALE);
    root.add(inst);

    // Raycast auf den animierten SkinnedMeshes abschalten (wuerde gegen die
    // statische Bind-Pose testen) — getroffen wird die Hitbox unten.
    inst.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.frustumCulled = false;
        mesh.raycast = () => {};
      }
    });

    // Animation: Idle (Ruhe) + Walk (Bewegung).
    let mixer: THREE.AnimationMixer | undefined;
    let idle: THREE.AnimationAction | undefined;
    let walk: THREE.AnimationAction | undefined;
    if (this.model.clips.length > 0) {
      mixer = new THREE.AnimationMixer(inst);
      const find = (name: string, re: RegExp) =>
        THREE.AnimationClip.findByName(this.model!.clips, name) ??
        this.model!.clips.find(c => re.test(c.name)) ?? this.model!.clips[0];
      idle = mixer.clipAction(find('Idle', /idle|stand/i));
      walk = mixer.clipAction(find('Walk', /walk/i));
      idle.play();
    }

    // Unsichtbare Trefferbox, die dem Soldaten folgt (~ Breite 1.0, Hoehe 2.3).
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 2.3, 0.8),
      new THREE.MeshBasicMaterial()
    );
    hitbox.position.y = 1.15;
    hitbox.visible = false;
    hitbox.userData['playerId'] = id;
    root.add(hitbox);

    this.scene.add(root);
    const avatar: Avatar = {
      root, hitbox, mixer, idle, walk,
      target: new THREE.Vector3(), targetRy: 0, moving: false, dead: false, current: 'idle',
    };
    this.avatars.set(id, avatar);
    return avatar;
  }

  private setAnimation(a: Avatar, to: 'idle' | 'walk'): void {
    const next = to === 'walk' ? a.walk : a.idle;
    const prev = a.current === 'walk' ? a.walk : a.idle;
    a.current = to;
    if (!next || next === prev) return;
    next.reset().play();
    if (prev) prev.crossFadeTo(next, 0.25, false);
    else next.fadeIn(0.25);
  }

  private removeAvatar(id: string): void {
    const a = this.avatars.get(id);
    if (!a) return;
    a.mixer?.stopAllAction();
    this.scene?.remove(a.root);
    a.root.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat?.dispose?.();
    });
    this.avatars.delete(id);
  }
}
