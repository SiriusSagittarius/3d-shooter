import * as THREE from "three";

function createBuildingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  // Fassade (Dunkel)
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, 128, 256);

  // Fenster (zufällige Lichter)
  const hue = Math.floor(Math.random() * 40 + 30); // Warme Gelb/Orange Töne

  for (let y = 10; y < 256; y += 16) {
    if (Math.random() > 0.9) continue; // Ein dunkles Stockwerk
    for (let x = 8; x < 128; x += 16) {
      if (Math.random() > 0.4) {
        ctx.fillStyle = `hsl(${hue}, 100%, ${Math.random() * 50 + 50}%)`;
        ctx.fillRect(x, y, 8, 12);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createLevel(scene, targets, rings) {
  // Einfache Wolkenkratzer
  for (let i = 0; i < 50; i++) {
    const width = Math.random() * 10 + 5;
    const depth = Math.random() * 10 + 5;
    const height = Math.random() * 50 + 20; // Höhe zwischen 20 und 70

    const geometry = new THREE.BoxGeometry(width, height, depth);

    const texture = createBuildingTexture();
    texture.repeat.set(width / 10, height / 20); // Textur an Gebäudegröße anpassen

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: 0.8, // Wie hell die Fenster leuchten
      roughness: 0.2,
      metalness: 0.5,
    });

    const building = new THREE.Mesh(geometry, material);
    // Verteilt im Bereich -90 bis 90 (passend zur Arena-Größe)
    building.position.set(
      Math.random() * 180 - 90,
      height / 2,
      Math.random() * 180 - 90,
    );
    scene.add(building);
    targets.push(building);
  }

  // --- STRASSENLATERNEN ---
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 180 - 90;
    const z = Math.random() * 180 - 90;

    // Pfosten
    const poleHeight = 8;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, poleHeight),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
    );
    pole.position.set(x, poleHeight / 2, z);
    scene.add(pole);
    targets.push(pole); // Damit man dagegen laufen/schießen kann

    // Lichtquelle (Punktlicht) - Warmes Gelb/Orange
    const light = new THREE.PointLight(0xffaa00, 300, 25);
    light.position.set(x, poleHeight, z);
    scene.add(light);

    // Glühender Kopf (Mesh) für den visuellen Effekt
    const bulb = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xffaa00 }),
    );
    bulb.position.set(x, poleHeight, z);
    scene.add(bulb);
  }

  // --- FLUG-RINGE ---
  if (rings) {
    const ringGeo = new THREE.TorusGeometry(4, 0.4, 16, 100);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffff }); // Leuchtendes Cyan

    for (let i = 0; i < 20; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat);

      // Zufällige Position in der Luft (Höhe 30 bis 80)
      ring.position.set(
        Math.random() * 180 - 90,
        Math.random() * 50 + 30,
        Math.random() * 180 - 90,
      );
      ring.rotation.y = Math.random() * Math.PI; // Zufällige Ausrichtung
      scene.add(ring);
      rings.push(ring);
    }
  }
}
