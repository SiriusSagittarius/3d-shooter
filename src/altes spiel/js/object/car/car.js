import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export function createCar(scene, targets) {
  const carGroup = new THREE.Group();

  // GLTF Loader initialisieren
  const loader = new GLTFLoader();

  // Dein 3D-Modell laden (Datei muss 'car.gltf' heißen)
  loader.load(
    "js/object/car/car.gltf",
    (gltf) => {
      const model = gltf.scene;

      // Skalierung anpassen (falls das Modell zu riesig oder winzig ist)
      model.scale.set(0.015, 0.015, 0.015); // Kleiner skalieren (cm zu m)
      model.rotation.y = Math.PI / 2; // Um 90 Grad drehen

      // Schatten und Kollision aktivieren
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          // WICHTIG: Teile des Autos zur Treffer-Liste hinzufügen
          targets.push(child);
        }
      });

      carGroup.add(model);
    },
    undefined,
    (error) => {
      console.error("Fehler beim Laden des Autos:", error);
    },
  );

  // Echte Lichtquellen (SpotLights)
  const spotL = new THREE.SpotLight(0xffffaa, 400, 60, 0.5, 0.4, 1);
  spotL.position.set(-0.8, 0.7, 2.9);
  spotL.target.position.set(-0.8, 0.2, 15); // Leuchtet nach vorne und leicht nach unten
  carGroup.add(spotL);
  carGroup.add(spotL.target);

  const spotR = new THREE.SpotLight(0xffffaa, 400, 60, 0.5, 0.4, 1);
  spotR.position.set(0.8, 0.7, 2.9);
  spotR.target.position.set(0.8, 0.2, 15);
  carGroup.add(spotR);
  carGroup.add(spotR.target);

  // Rücklichter
  const taillightGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const taillightL = new THREE.Mesh(taillightGeo, taillightMat);
  taillightL.position.set(-0.8, 0.9, -2.75);
  carGroup.add(taillightL);
  const taillightR = new THREE.Mesh(taillightGeo, taillightMat);
  taillightR.position.set(0.8, 0.9, -2.75);
  carGroup.add(taillightR);

  carGroup.position.set(15, 0, 15); // Position im Raum
  carGroup.rotation.y = -Math.PI / 4; // Schräg stellen
  scene.add(carGroup);

  return carGroup;
}
