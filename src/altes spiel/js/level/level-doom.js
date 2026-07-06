import * as THREE from "three";

export function createLevel(scene, targets) {
  const colors = [0x880000, 0x222222, 0x442200]; // Rot, Dunkelgrau, Braun

  for (let i = 0; i < 50; i++) {
    // Zufällige Größe für Wände/Säulen
    const w = Math.random() * 5 + 2;
    const h = Math.random() * 12 + 4; // Höhere Wände für Doom-Feeling
    const d = Math.random() * 5 + 2;

    const geometry = new THREE.BoxGeometry(w, h, d);
    const material = new THREE.MeshStandardMaterial({
      color: colors[Math.floor(Math.random() * colors.length)],
      roughness: 0.8,
      metalness: 0.2,
    });

    const block = new THREE.Mesh(geometry, material);
    block.position.set(
      Math.random() * 100 - 50,
      h / 2,
      Math.random() * 100 - 50,
    );
    block.rotation.y = Math.random() * Math.PI;

    scene.add(block);
    targets.push(block);
  }
}
