import * as THREE from "three";

export function createLevel(scene, targets) {
  for (let i = 0; i < 30; i++) {
    const radius = Math.random() * 1.5 + 0.5;
    const sphereGeo = new THREE.SphereGeometry(radius, 32, 16);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0x888888,
      transparent: true,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.set(
      Math.random() * 60 - 30,
      radius, // Position y ist der Radius, damit die Kugel auf dem Boden aufliegt
      Math.random() * 60 - 30,
    );
    scene.add(sphere);
    targets.push(sphere);
  }
}
