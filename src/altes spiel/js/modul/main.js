import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { createLevel } from "game-level";
import { createCar } from "car-class";
import { Broom } from "broom-class";

// --- SETUP SCENE ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);
scene.fog = new THREE.Fog(0x111111, 0, 100);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById("gameCanvas"),
  antialias: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);

// --- AUDIO SETUP ---
const listener = new THREE.AudioListener();
camera.add(listener);

const backgroundMusic = new THREE.Audio(listener);
const walkSound = new THREE.Audio(listener);
const sprintSound = new THREE.Audio(listener);
const duckSound = new THREE.Audio(listener);
const jumpSound = new THREE.Audio(listener);
const gunSound = new THREE.Audio(listener);
const reloadSound = new THREE.Audio(listener);
const doorSound = new THREE.Audio(listener);
const rainSound = new THREE.Audio(listener);
const audioLoader = new THREE.AudioLoader();
const bugSound = new THREE.Audio(listener);
const carSound = new THREE.Audio(listener);
const carDoorSound = new THREE.Audio(listener);
const windSound = new THREE.Audio(listener);
const healSound = new THREE.Audio(listener);
const ringSound = new THREE.Audio(listener);

// Sounds laden
audioLoader.load("assets/audio/sound.mp3", (buffer) => {
  backgroundMusic.setBuffer(buffer);
  backgroundMusic.setLoop(true);
  backgroundMusic.setVolume(0.3);
});
// Auto-Sounds laden
audioLoader.load("assets/audio/dodge.mp3", (buffer) => {
  carSound.setBuffer(buffer);
  carSound.setLoop(true);
  carSound.setVolume(0.5);
});
audioLoader.load("assets/audio/cardoorinout.mp3", (buffer) => {
  carDoorSound.setBuffer(buffer);
  carDoorSound.setVolume(1.0);
});

// Schrittgeräusche laden
audioLoader.load("assets/audio/walk.mp3", (buffer) => {
  walkSound.setBuffer(buffer);
  walkSound.setLoop(true);
  walkSound.setVolume(0.5);
});

// Sprintgeräusche laden
audioLoader.load("assets/audio/sprint.mp3", (buffer) => {
  sprintSound.setBuffer(buffer);
  sprintSound.setLoop(true);
  sprintSound.setVolume(0.6);
});

// Duckgeräusche laden
audioLoader.load("assets/audio/duck.mp3", (buffer) => {
  duckSound.setBuffer(buffer);
  duckSound.setLoop(true);
  duckSound.setVolume(0.4);
});

// Sprunggeräusch laden
audioLoader.load("assets/audio/jump.mp3", (buffer) => {
  jumpSound.setBuffer(buffer);
  jumpSound.setVolume(0.6);
});

// Waffensound laden
audioLoader.load("assets/audio/gun3.mp3", (buffer) => {
  gunSound.setBuffer(buffer);
  gunSound.setVolume(0.5);
});

// Nachladesound laden
audioLoader.load("assets/audio/reload.mp3", (buffer) => {
  reloadSound.setBuffer(buffer);
  reloadSound.setVolume(0.5);
});

// Tür-Sound (Intro) laden
audioLoader.load("assets/audio/door open.mp3", (buffer) => {
  doorSound.setBuffer(buffer);
  doorSound.setVolume(1.0);
});

// Regensound laden
audioLoader.load("assets/audio/rain.mp3", (buffer) => {
  rainSound.setBuffer(buffer);
  rainSound.setLoop(true);
  rainSound.setVolume(0.5);
});

// Bug-Sound laden
audioLoader.load("assets/audio/bug.mp3", (buffer) => {
  bugSound.setBuffer(buffer);
  bugSound.setVolume(0.8);
});

// Flug-Sound laden (blow.mp3)
audioLoader.load("assets/audio/blow.mp3", (buffer) => {
  windSound.setBuffer(buffer);
  windSound.setLoop(true);
  windSound.setVolume(0);
});
// Heal-Sound laden (du musst eine 'heal.mp3' in 'assets/audio' ablegen)
audioLoader.load("assets/audio/heal.mp3", (buffer) => {
  healSound.setBuffer(buffer);
  healSound.setVolume(0.8);
});
// Ring-Sound laden
audioLoader.load("assets/audio/ding.mp3", (buffer) => {
  ringSound.setBuffer(buffer);
  ringSound.setVolume(0.5);
});

// --- LICHT ---
const light = new THREE.PointLight(0xffffff, 500, 100);
light.position.set(0, 10, 0);
scene.add(light);
scene.add(new THREE.AmbientLight(0x404040));

// --- RAUM (ARENA) ---
const roomSize = 100; // Größe der Arena (Radius)
const wallHeight = 20;

// Boden
const floorGeo = new THREE.PlaneGeometry(roomSize * 2, roomSize * 2);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x050505,
  roughness: 0.5,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// Raster auf dem Boden (Tron-Style)
const grid = new THREE.GridHelper(roomSize * 2, 50, 0x00aa00, 0x111111);
scene.add(grid);

// Wände erzeugen
const wallMat = new THREE.MeshStandardMaterial({ color: 0x333333 });

const wall1 = new THREE.Mesh(
  new THREE.BoxGeometry(roomSize * 2, wallHeight, 2),
  wallMat,
);
wall1.position.set(0, wallHeight / 2, -roomSize); // Hinten
scene.add(wall1);

const wall2 = new THREE.Mesh(
  new THREE.BoxGeometry(roomSize * 2, wallHeight, 2),
  wallMat,
);
wall2.position.set(0, wallHeight / 2, roomSize); // Vorne
scene.add(wall2);

const wall3 = new THREE.Mesh(
  new THREE.BoxGeometry(2, wallHeight, roomSize * 2),
  wallMat,
);
wall3.position.set(-roomSize, wallHeight / 2, 0); // Links
scene.add(wall3);

const wall4 = new THREE.Mesh(
  new THREE.BoxGeometry(2, wallHeight, roomSize * 2),
  wallMat,
);
wall4.position.set(roomSize, wallHeight / 2, 0); // Rechts
scene.add(wall4);

// --- PFÜTZEN (PUDDLES) ---
const puddles = [];
const puddleGeo = new THREE.CircleGeometry(1, 32);
const puddleMat = new THREE.MeshStandardMaterial({
  color: 0x111111,
  roughness: 0.0,
  metalness: 0.8,
  transparent: true,
  opacity: 0.6,
});
for (let i = 0; i < 30; i++) {
  const puddle = new THREE.Mesh(puddleGeo, puddleMat);
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(Math.random() * 180 - 90, 0.03, Math.random() * 180 - 90);
  puddle.scale.set(0, 0, 0); // Anfangs unsichtbar
  scene.add(puddle);
  puddles.push(puddle);
}

// --- ZIELE / WÄNDE ---
const targets = [];
const rings = []; // Liste für die Flugringe
createLevel(scene, targets, rings);

// --- GEGNER SYSTEM (CUSTOM ENEMIES) ---
const enemies = [];
const enemyUpload = document.getElementById("enemyUpload");
const enemyStatus = document.getElementById("enemyStatus");

enemyUpload.addEventListener("change", (e) => {
  const files = e.target.files;
  if (!files.length) return;

  const textureLoader = new THREE.TextureLoader();

  for (let i = 0; i < files.length; i++) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const imgData = event.target.result;
      const texture = textureLoader.load(imgData);
      createEnemy(texture);
    };
    reader.readAsDataURL(files[i]);
  }
  // Reset Input
  e.target.value = "";
});

function createEnemy(texture) {
  const material = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(material);

  // Größe anpassen (Proportionen bleiben erhalten, aber ca. 2m hoch)
  sprite.scale.set(1.5, 1.5, 1);

  // Zufällige Position
  const angle = Math.random() * Math.PI * 2;
  const dist = 20 + Math.random() * 30; // 20-50m entfernt
  sprite.position.set(Math.cos(angle) * dist, 1, Math.sin(angle) * dist);

  scene.add(sprite);
  enemies.push(sprite);
  targets.push(sprite); // Damit man sie treffen kann

  // Status Update
  enemyStatus.innerText = `${enemies.length} Gegner aktiv`;
  enemyStatus.style.color = "cyan";
}

// --- MEDIKIT ---
let medikit;
function createMedikit() {
  const medikitGeo = new THREE.BoxGeometry(1, 1, 1);

  // Texture mit rotem Kreuz
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "red";
  ctx.fillRect(24, 8, 16, 48); // Vertikaler Balken
  ctx.fillRect(8, 24, 48, 16); // Horizontaler Balken
  const texture = new THREE.CanvasTexture(canvas);

  const medikitMat = new THREE.MeshStandardMaterial({ map: texture });
  medikit = new THREE.Mesh(medikitGeo, medikitMat);

  spawnMedikit(); // Erste Position setzen
  scene.add(medikit);
}

function spawnMedikit() {
  medikit.position.set(Math.random() * 160 - 80, 0.5, Math.random() * 160 - 80);
  medikit.visible = true;
}

// --- FLUGBESEN ---
const broom = new Broom();

const carGroup = createCar(scene, targets);

// --- RÜCKSPIEGEL KAMERA ---
// Blick nach hinten (da Auto +Z fährt, ist hinten -Z)
const rearCamera = new THREE.PerspectiveCamera(80, 300 / 100, 0.1, 500);
rearCamera.position.set(0, 1.8, -0.5); // Leicht erhöht, Blick nach hinten
rearCamera.rotation.y = Math.PI; // Um 180 Grad drehen, um nach hinten zu schauen
carGroup.add(rearCamera); // An Auto kleben

// --- REGEN SYSTEM ---
const rainGeo = new THREE.BufferGeometry();
const rainCount = 4000;
const rainPos = new Float32Array(rainCount * 3);
for (let i = 0; i < rainCount * 3; i += 3) {
  rainPos[i] = Math.random() * 200 - 100;
  rainPos[i + 1] = Math.random() * 80;
  rainPos[i + 2] = Math.random() * 200 - 100;
}
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.PointsMaterial({
  color: 0xaaaaaa,
  size: 0.15,
  transparent: true,
});
const rainSystem = new THREE.Points(rainGeo, rainMat);
rainSystem.visible = false;
scene.add(rainSystem);

// --- PARTIKEL SYSTEM (Treffer-Effekte) ---
const particles = [];
function createExplosion(position, color) {
  for (let i = 0; i < 15; i++) {
    const size = Math.random() * 0.2 + 0.1;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshBasicMaterial({ color: color });
    const particle = new THREE.Mesh(geo, mat);
    particle.position.copy(position);
    particle.userData.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
    );
    particle.userData.life = 0.5 + Math.random() * 0.5; // 0.5 bis 1.0 Sekunden
    scene.add(particle);
    particles.push(particle);
  }
}

createMedikit();

// Waffe entfernen (jetzt via 2D Bilder im HTML)
scene.add(camera);

// --- STEUERUNG ---
const controls = new PointerLockControls(camera, document.body);

document.addEventListener("contextmenu", (event) => event.preventDefault()); // Rechtsklick-Menü deaktivieren

let gameStarted = false;

// --- MENÜ & GAME STATE LOGIK ---
const menuOverlay = document.getElementById("menuOverlay");
const startBtn = document.getElementById("startBtn");
const resumeBtn = document.getElementById("resumeBtn");
const muteBtn = document.getElementById("muteBtn");
const menuTitle = document.getElementById("menuTitle");

let isMuted = false;
let playerHealth = 100;
let lastDamageTime = 0;

// Mute Funktion
muteBtn.addEventListener("click", () => {
  isMuted = !isMuted;
  listener.setMasterVolume(isMuted ? 0 : 1);
  muteBtn.innerText = isMuted ? "🔇 Ton: AUS" : "🔊 Ton: AN";
});

function resetGame() {
  playerHealth = 100;
  const healthEl = document.getElementById("health");
  healthEl.innerText = 100;
  healthEl.style.color = "#0f0";
  
  // Spieler zurück zum Start setzen (optional)
  controls.getObject().position.set(0, 1.6, 0);
  velocity.set(0, 0, 0);

  // Medikit auch zurücksetzen
  spawnMedikit();
}

function startGameLogic() {
  controls.lock();
}

startBtn.addEventListener("click", () => {
  if (playerHealth <= 0) {
    resetGame();
  }
  // Menü anpassen für Neustart
  menuTitle.innerText = "3D SHOOTER";
  menuTitle.style.color = "#ff0000";
  startBtn.innerText = "Spiel Starten";

  startGameLogic();
  // Intro-Sound abspielen (nur beim allerersten Klick)
  if (!gameStarted && doorSound.buffer) {
    doorSound.play();
    gameStarted = true;
  }
  if (backgroundMusic.buffer && !backgroundMusic.isPlaying) {
    backgroundMusic.play();
  }
});

resumeBtn.addEventListener("click", () => {
  startGameLogic();
});

// Event: Wenn Maus gefangen wird (Spiel läuft)
controls.addEventListener("lock", () => {
  menuOverlay.style.display = "none";
  // Zeit zurücksetzen, damit kein riesiger Zeitsprung passiert
  prevTime = performance.now();
});

// Event: Wenn Maus losgelassen wird (Pause / Menü)
controls.addEventListener("unlock", () => {
  // Nur Pause-Menü zeigen, wenn Spieler noch lebt
  if (playerHealth > 0) {
    menuOverlay.style.display = "flex";
    menuTitle.innerText = "PAUSE";
    startBtn.style.display = "none";
    resumeBtn.style.display = "block";
  }
});

// Maus-Aktionen im Spiel (Schießen etc.)
document.addEventListener("mousedown", (e) => {
  if (!controls.isLocked) return; // Nur schießen wenn im Spiel

  if (isFlying) {
    if (e.button === 0) {
      isAccelerating = true; // Beschleunigen mit Linksklick
    }
    return; // Blockiert Schießen etc. beim Fliegen
  }
  if (isDriving) return; // Keine Maus-Aktionen im Auto

  if (e.button === 0) shoot(); // Linksklick
  if (e.button === 1) toggleScope(); // Mausrad-Klick (Zielen)
  if (e.button === 2) reload(); // Rechtsklick (Nachladen)
});

// --- SCHIESS-LOGIK ---
let ammo = 30;
let score = 0;
const maxAmmo = 30;
let isReloading = false;
let isScoped = false;
let isDriving = false;
let currentCarSpeed = 0;
let cameraYawOffset = 0;
let cameraPitchOffset = 0;
let isAccelerating = false;
let broomRollVelocity = 0;

function reload() {
  if (isReloading || ammo === maxAmmo || isDriving || isFlying) return;
  isReloading = true;

  if (reloadSound.buffer) {
    if (reloadSound.isPlaying) reloadSound.stop();
    reloadSound.play();
  }

  // Animation: Waffe senken (via CSS)
  const weaponImg = document.getElementById("weapon");
  weaponImg.style.transform = "translateX(calc(-50% + 350px)) translateY(200px) rotateY(-15deg)";

  // Zeit warten bis nachgeladen ist (1.5 Sekunden)
  setTimeout(() => {
    ammo = maxAmmo;
    document.getElementById("ammo").innerText = ammo;
    isReloading = false;
    weaponImg.style.transform = "translateX(calc(-50% + 350px)) translateY(0) rotateY(-15deg)";
  }, 1500);
}

function toggleScope() {
  const scopeImg = document.getElementById("scope");
  const weaponImg = document.getElementById("weapon");
  const crosshair = document.getElementById("crosshair");

  isScoped = !isScoped;

  if (isScoped) {
    scopeImg.style.display = "block";
    weaponImg.style.display = "none";
    crosshair.style.display = "none";
    camera.fov = 20; // Zoom-Effekt
  } else {
    scopeImg.style.display = "none";
    weaponImg.style.display = "block";
    crosshair.style.display = "block";
    camera.fov = 75; // Reset Zoom
  }
  camera.updateProjectionMatrix();
}

const raycaster = new THREE.Raycaster();
const crosshair = document.getElementById("crosshair");
function shoot() {
  if (isReloading || ammo <= 0 || isDriving || isFlying) return;
  ammo--;
  document.getElementById("ammo").innerText = ammo;

  if (gunSound.buffer) {
    if (gunSound.isPlaying) gunSound.stop();
    gunSound.play();
  }

  // Waffen-Animation (Sprites wechseln)
  if (!isScoped) {
    const weaponImg = document.getElementById("weapon");
    weaponImg.src = "assets/img/sniper/3.png";
    setTimeout(() => {
      weaponImg.src = "assets/img/sniper/4.png";
    }, 60);
    setTimeout(() => {
      weaponImg.src = "assets/img/sniper/5.png";
    }, 120);
    setTimeout(() => {
      weaponImg.src = "assets/img/sniper/6.png";
    }, 180);
    setTimeout(() => {
      weaponImg.src = "assets/img/sniper/7.png";
    }, 240);
    setTimeout(() => {
      weaponImg.src = "assets/img/sniper/2.png";
    }, 300);
  }

  // Offset berechnen, wenn nicht im Scope (da Fadenkreuz verschoben ist)
  let rayX = 0;
  let rayY = 0;
  if (!isScoped) {
    rayX = -80 / window.innerWidth; // Entspricht -40px Verschiebung
    rayY = -80 / window.innerHeight; // Entspricht +40px Verschiebung (y ist invertiert)
  }
  raycaster.setFromCamera(new THREE.Vector2(rayX, rayY), camera);
  const intersects = raycaster.intersectObjects(targets);

  if (intersects.length > 0) {
    score += 10;
    document.getElementById("score").innerText = score;

    const hitObj = intersects[0].object;
    createExplosion(intersects[0].point, hitObj.material.color); // Partikel erzeugen
    const oldColor = hitObj.material.color.clone();
    hitObj.material.color.set(0xff0000);

    // Prüfen ob es ein Gegner ist
    const enemyIndex = enemies.indexOf(hitObj);
    if (enemyIndex > -1) {
      // Gegner getroffen -> Löschen!
      setTimeout(() => {
        scene.remove(hitObj);
        enemies.splice(enemyIndex, 1);

        // Auch aus targets entfernen, sonst treffen wir Geister
        const targetIndex = targets.indexOf(hitObj);
        if (targetIndex > -1) targets.splice(targetIndex, 1);

        enemyStatus.innerText = `${enemies.length} Gegner aktiv`;
      }, 100); // Kurze Verzögerung für den roten Treffer-Effekt
    } else {
      setTimeout(() => hitObj.material.color.copy(oldColor), 200);
    }
  }
}

// --- BEWEGUNG ---
let moveForward = false,
  moveBackward = false,
  moveLeft = false,
  moveRight = false,
  moveSprint = false,
  moveCrouch = false,
  canJump = false;
let isFlying = false;
let driveForward = false,
  driveBackward = false,
  steerLeft = false,
  steerRight = false;

const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

document.addEventListener("keydown", (e) => {
  if (e.code === "KeyW") moveForward = true;
  if (e.code === "KeyS") moveBackward = true;
  if (e.code === "KeyA") moveLeft = true;
  if (e.code === "KeyD") moveRight = true;
  if (e.code === "KeyQ") moveSprint = true;
  if (e.code === "KeyC") moveCrouch = true;
  if (e.code === "KeyR") reload();
  if (e.code === "ArrowUp") driveForward = true;
  if (e.code === "ArrowDown") driveBackward = true;
  if (e.code === "ArrowLeft") steerLeft = true;
  if (e.code === "ArrowRight") steerRight = true;
  if (e.code === "KeyB") {
    if (!isDriving) {
      // Nur wenn man nicht Auto fährt
      isFlying = broom.toggle();

      isAccelerating = false;
      broomRollVelocity = 0;

      // Sichtbarkeit anderer Elemente steuern
      if (isFlying) {
        document.getElementById("weapon").style.display = "none";
        document.getElementById("crosshair").style.display = "none";
        if (isScoped) toggleScope(); // Zoom ausmachen
        // Optional: Etwas Schwung nach oben beim Start
        velocity.y = 10;
      } else {
        document.getElementById("weapon").style.display = "block";
        document.getElementById("crosshair").style.display = "block";
        // Fall-Schaden vermeiden beim Deaktivieren in der Luft?
        // velocity.y = 0;
      }
    }
  }
  if (e.code === "KeyE") {
    if (isDriving) {
      // Aussteigen
      isDriving = false;

      cameraYawOffset = 0; // Kamera-Blick zurücksetzen
      cameraPitchOffset = 0;

      // Falls man im Auto saß und den Besen noch anhatte (unwahrscheinlich aber sicher ist sicher)
      if (isFlying) {
        isFlying = false;
        if (broom.isActive) broom.toggle();
        document.getElementById("weapon").style.display = "block";
      }

      // Sounds: Motor aus, Tür auf/zu
      if (carSound.isPlaying) carSound.stop();
      if (carDoorSound.buffer) {
        if (carDoorSound.isPlaying) carDoorSound.stop();
        carDoorSound.play();
      }

      // Spieler links neben das Auto setzen
      const exitPos = carGroup.position.clone();
      exitPos.x -= 3;
      controls.getObject().position.copy(exitPos);
      controls.getObject().position.y = 1.6;

      // Waffe wieder anzeigen
      document.getElementById("weapon").style.display = "block";
      document.getElementById("crosshair").style.display = "block";
      document.getElementById("dashboard").style.display = "none";
      document.getElementById("mirrorBorder").style.display = "none";
    } else {
      // Einsteigen (nur wenn nah genug)
      if (controls.getObject().position.distanceTo(carGroup.position) < 5) {
        isDriving = true;

        // Sounds: Tür auf/zu, Motor an
        if (carDoorSound.buffer) {
          if (carDoorSound.isPlaying) carDoorSound.stop();
          carDoorSound.play();
        }
        if (carSound.buffer) carSound.play();

        if (isScoped) toggleScope(); // Zoom beenden beim Einsteigen
        document.getElementById("weapon").style.display = "none";
        document.getElementById("crosshair").style.display = "none";
        document.getElementById("dashboard").style.display = "flex";
        document.getElementById("mirrorBorder").style.display = "block";
      }
    }
  }
  if (e.code === "Space") {
    if (canJump) {
      velocity.y += 12.0; // Sprungkraft
      canJump = false;
      if (jumpSound.buffer) {
        if (jumpSound.isPlaying) jumpSound.stop();
        jumpSound.play();
      }
    }
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "KeyW") moveForward = false;
  if (e.code === "KeyS") moveBackward = false;
  if (e.code === "KeyA") moveLeft = false;
  if (e.code === "KeyD") moveRight = false;
  if (e.code === "KeyQ") moveSprint = false;
  if (e.code === "KeyC") moveCrouch = false;
  if (e.code === "ArrowUp") driveForward = false;
  if (e.code === "ArrowDown") driveBackward = false;
  if (e.code === "ArrowLeft") steerLeft = false;
  if (e.code === "ArrowRight") steerRight = false;
});
document.addEventListener("mouseup", (e) => {
  if (isFlying && e.button === 0) {
    isAccelerating = false;
  }
});

// --- ZOOM (Mausrad) ---
document.addEventListener("wheel", (event) => {
  if (isFlying) {
    broomRollVelocity -= event.deltaY * 0.05; // Schraube mit Mausrad (viel schneller)
    return;
  }
  camera.fov += event.deltaY * 0.05;
  camera.fov = Math.max(30, Math.min(100, camera.fov)); // Begrenzung des Zooms
  camera.updateProjectionMatrix();
});

camera.position.y = 1.6;

// --- LOOP ---
let isRaining = false;
let nextRainEvent = performance.now() + 5000; // Erstes Wetter-Event nach 5 Sek
let nextBugEvent = performance.now() + 15000; // Erster Bug nach 15 Sek
let prevTime = performance.now();
function animate() {
  requestAnimationFrame(animate);

  // Wenn Pause ist (Menü offen), Physik anhalten
  if (!controls.isLocked) return;

  if (isDriving) {
    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    prevTime = time;

    // --- AUTO PHYSIK (Pfeiltasten) ---
    // Beschleunigen / Bremsen
    if (driveForward) currentCarSpeed += 40.0 * delta;
    if (driveBackward) currentCarSpeed -= 40.0 * delta;

    // Reibung (Auto wird langsamer, wenn man kein Gas gibt)
    currentCarSpeed -= currentCarSpeed * 2.0 * delta;

    // Dashboard Update
    document.getElementById("speedDisplay").innerText = Math.abs(
      Math.round(currentCarSpeed * 3.6),
    );

    // Position und Rotation speichern (für Kollisions-Reset)
    const oldPos = carGroup.position.clone();
    const oldRot = carGroup.rotation.y;

    // Lenken (nur wenn das Auto rollt)
    if (Math.abs(currentCarSpeed) > 0.5) {
      if (steerLeft)
        carGroup.rotation.y += 1.5 * delta * (currentCarSpeed > 0 ? 1 : -1);
      if (steerRight)
        carGroup.rotation.y -= 1.5 * delta * (currentCarSpeed > 0 ? 1 : -1);
    }

    // Bewegung anwenden (lokale Z-Achse des Autos)
    carGroup.translateZ(currentCarSpeed * delta);

    // --- KOLLISIONSABFRAGE ---
    carGroup.updateMatrixWorld(); // Wichtig für korrekte Box-Berechnung
    const carBox = new THREE.Box3().setFromObject(carGroup);
    carBox.expandByScalar(-0.3); // Box etwas verkleinern (Toleranz), damit man nicht an Luft hängen bleibt

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];

      // FIX: Ignoriere Teile, die zum Auto selbst gehören (Selbstkollision vermeiden)
      if (carGroup.getObjectById(target.id)) continue;

      // Performance: Nur Objekte in der Nähe prüfen (< 40 Einheiten)
      if (carGroup.position.distanceTo(target.position) > 40) continue;

      const targetBox = new THREE.Box3().setFromObject(target);
      if (carBox.intersectsBox(targetBox)) {
        // Kollision erkannt! Alles zurücksetzen
        carGroup.position.copy(oldPos);
        carGroup.rotation.y = oldRot;
        currentCarSpeed = -currentCarSpeed * 0.5; // Abprallen (Bounce)
        break; // Keine weiteren Checks nötig
      }
    }

    // --- KAMERASTEUERUNG IM AUTO (WASD) ---
    const lookSpeed = 2.0 * delta;
    if (moveLeft) cameraYawOffset += lookSpeed;
    if (moveRight) cameraYawOffset -= lookSpeed;
    if (moveForward) cameraPitchOffset -= lookSpeed;
    if (moveBackward) cameraPitchOffset += lookSpeed;

    // Pitch begrenzen (hoch/runter schauen)
    cameraPitchOffset = Math.max(
      -Math.PI / 4,
      Math.min(Math.PI / 8, cameraPitchOffset),
    );

    // Kamera höher (1.7) und weiter vorne (0.4), damit man die Straße sieht
    const relativeCameraOffset = new THREE.Vector3(-0.35, 1.7, 0.4);
    const cameraOffset = relativeCameraOffset.applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      carGroup.rotation.y,
    );
    controls.getObject().position.copy(carGroup.position).add(cameraOffset);
    controls.getObject().rotation.y =
      carGroup.rotation.y + Math.PI + cameraYawOffset;
    controls.getObject().rotation.x = cameraPitchOffset;
  } else if (controls.isLocked) {
    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    const isMoving = moveForward || moveBackward || moveLeft || moveRight;

    if (isFlying) {
      // --- FLUG PHYSIK (Maussteuerung) ---
      // Luftwiderstand, damit man nicht ewig weiterfliegt
      velocity.multiplyScalar(1.0 - 2.0 * delta);

      const flyDir = new THREE.Vector3();
      controls.getDirection(flyDir); // 3D-Blickrichtung holen

      // Beschleunigen mit gedrückter Maustaste
      if (isAccelerating) {
        const flySpeed = 50.0; // Fluggeschwindigkeit
        velocity.addScaledVector(flyDir, flySpeed * delta);
      }

      // Schraube (Rollen) mit dem Mausrad
      broomRollVelocity *= 0.95; // Dämpfung, damit die Drehung von allein aufhört
      const rollDelta = broomRollVelocity;

      // Kamera um die eigene Vorwärtsachse rollen
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
        camera.quaternion,
      );
      camera.quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(forward, rollDelta * delta),
      );

      // Position basierend auf der Geschwindigkeit aktualisieren
      controls.getObject().position.addScaledVector(velocity, delta);

      // Boden-Check, damit man nicht durchfällt
      if (controls.getObject().position.y < 2.0) {
        controls.getObject().position.y = 2.0;
        velocity.y = Math.max(0, velocity.y); // Stoppt nur das Fallen, erlaubt aber das Steigen
      }

      // --- WIND SOUND ---
      const speed = velocity.length();
      if (windSound.buffer) {
        if (!windSound.isPlaying) windSound.play();
        // Lautstärke basierend auf Geschwindigkeit (0 bis 30 Speed = 0.0 bis 1.0 Volume)
        const volume = Math.min(1.0, speed / 30.0);
        windSound.setVolume(volume);
      }

      // --- RING CHECK (Durchfliegen) ---
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        if (
          ring.visible &&
          controls.getObject().position.distanceTo(ring.position) < 5
        ) {
          // Ring getroffen!
          ring.visible = false; // Verschwinden lassen
          score += 500; // Viele Punkte!
          document.getElementById("score").innerText = score;
          
          // Sound abspielen
          if (ringSound.buffer) {
            if (ringSound.isPlaying) ringSound.stop();
            ringSound.play();
          }
        }
      }
    } else {
      if (windSound.isPlaying) windSound.stop();
      // --- NORMALE LAUF PHYSIK ---
      velocity.x -= velocity.x * 10.0 * delta;
      velocity.z -= velocity.z * 10.0 * delta;
      velocity.y -= 9.8 * 3.0 * delta; // Gravitation

      direction.z = Number(moveForward) - Number(moveBackward);
      direction.x = Number(moveRight) - Number(moveLeft);
      direction.normalize();

      // Geschwindigkeit basierend auf Status (Sprint/Ducken)
      let speed = 150.0;
      if (moveSprint) speed = 300.0;
      if (moveCrouch) speed = 50.0;

      if (moveForward || moveBackward)
        velocity.z -= direction.z * speed * delta;
      if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

      controls.moveRight(-velocity.x * delta);
      controls.moveForward(-velocity.z * delta);

      // Vertikale Bewegung (Springen/Fallen)
      controls.getObject().position.y += velocity.y * delta;

      // Bodenkollision
      let playerHeight = 1.6;
      if (moveCrouch) playerHeight = 0.8;

      if (controls.getObject().position.y < playerHeight) {
        velocity.y = 0;
        controls.getObject().position.y = playerHeight;
        canJump = true;
      }
    }

    // --- MEDIKIT AUFSAMMELN ---
    if (medikit.visible && playerHealth > 0) {
      const playerPos = controls.getObject().position;
      if (playerPos.distanceTo(medikit.position) < 1.5) {
        // Leben heilen (maximal bis 100)
        playerHealth = Math.min(100, playerHealth + 50);
        
        updateHealthUI();

        // Sound abspielen
        if (healSound.buffer) {
          if (healSound.isPlaying) healSound.stop();
          healSound.play();
        }

        // Medikit verstecken und Respawn timen
        medikit.visible = false;
        setTimeout(spawnMedikit, 20000); // Nach 20 Sekunden neu spawnen
      }
    }

    // --- GEGNER BEWEGUNG ---
    enemies.forEach(enemy => {
      const playerPos = controls.getObject().position;
      const enemyPos = enemy.position;
      
      // Richtung zum Spieler
      const dir = new THREE.Vector3().subVectors(playerPos, enemyPos).normalize();
      
      // Bewegen (nur x und z, y bleibt konstant)
      const enemySpeed = 2.5; // Langsamer als Spieler
      enemy.position.x += dir.x * enemySpeed * delta;
      enemy.position.z += dir.z * enemySpeed * delta;

      // --- SCHADENS-LOGIK ---
      const dist = playerPos.distanceTo(enemyPos);
      if (dist < 1.5) { // Wenn Gegner sehr nah ist (1.5 Meter)
        const now = performance.now();
        // Nur einmal pro Sekunde Schaden (Cooldown)
        if (now - lastDamageTime > 1000) {
          playerHealth -= 10; // 10 Schaden
          lastDamageTime = now;

          updateHealthUI();

          if (playerHealth <= 0) {
            // GAME OVER
            controls.unlock(); // Maus freigeben -> Menü geht auf
            menuTitle.innerText = "GAME OVER";
            menuTitle.style.color = "red";
            menuOverlay.style.display = "flex";
            startBtn.innerText = "NEUSTART";
            startBtn.style.display = "block";
            resumeBtn.style.display = "none";
          }
        }
      }
    });

    // --- PARTIKEL UPDATE ---
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.userData.life -= delta;
      if (p.userData.life <= 0) {
        scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
        particles.splice(i, 1);
      } else {
        p.position.addScaledVector(p.userData.velocity, delta);
        p.scale.setScalar(p.userData.life); // Schrumpfen
      }
    }

    // --- REGEN LOGIK ---
    if (time > nextRainEvent) {
      isRaining = !isRaining;
      nextRainEvent = time + Math.random() * 20000 + 10000; // Wechsel alle 10-30 Sek

      rainSystem.visible = isRaining;
      if (isRaining) {
        if (rainSound.buffer) rainSound.play();
      } else {
        if (rainSound.isPlaying) rainSound.stop();
      }
    }

    // --- NEBEL ANPASSUNG (Wetterabhängig) ---
    const targetFogFar = isRaining ? 30 : 100; // 30 bei Regen, 100 bei "Sonne"
    scene.fog.far += (targetFogFar - scene.fog.far) * 0.5 * delta; // Sanfter Übergang

    if (isRaining) {
      const positions = rainSystem.geometry.attributes.position.array;
      // Y-Koordinaten aktualisieren (fallen lassen)
      for (let i = 1; i < positions.length; i += 3) {
        positions[i] -= 50 * delta; // Fallgeschwindigkeit
        if (positions[i] < 0) {
          positions[i] = 80; // Reset nach oben
        }
      }
      rainSystem.geometry.attributes.position.needsUpdate = true;
    }

    // --- MINIMAP ZEICHNEN ---
    const mapCanvas = document.getElementById("minimap");
    const ctx = mapCanvas.getContext("2d");
    // Karte löschen
    ctx.clearRect(0, 0, 200, 200);

    ctx.save();
    // 1. Ursprung in die Mitte des Canvas setzen
    ctx.translate(100, 100);

    // 2. Welt um den Spieler rotieren (damit "Oben" immer Blickrichtung ist)
    // Wir drehen das Canvas passend zur Kameradrehung
    ctx.rotate(camera.rotation.y);

    // 3. Welt verschieben, sodass der Spieler im Zentrum (0,0) steht
    const mapScale = 1;
    ctx.translate(-camera.position.x * mapScale, -camera.position.z * mapScale);

    // Gebäude zeichnen (Grau)
    ctx.fillStyle = "rgba(150, 150, 150, 0.6)";
    targets.forEach((obj) => {
      // Nur Boxen auf der Karte zeigen (Wände/Gebäude)
      if (obj.geometry.type === "BoxGeometry") {
        const w = obj.geometry.parameters.width * mapScale;
        const d = obj.geometry.parameters.depth * mapScale;
        // Zeichnen an absoluter Weltposition (durch translate jetzt relativ zum Spieler)
        ctx.fillRect(
          obj.position.x * mapScale - w / 2,
          obj.position.z * mapScale - d / 2,
          w,
          d,
        );
      }
    });

    // Auto zeichnen (Rot)
    ctx.fillStyle = "red";
    ctx.fillRect(
      carGroup.position.x * mapScale - 3,
      carGroup.position.z * mapScale - 3,
      6,
      6,
    );

    ctx.restore();

    // Spieler zeichnen (Fest in der Mitte) - Ein Pfeil
    ctx.fillStyle = "#00ff00";
    ctx.beginPath();
    // Ein kleines Dreieck, das nach oben zeigt (Blickrichtung)
    ctx.moveTo(100, 90); // Spitze
    ctx.lineTo(105, 105); // Rechts unten
    ctx.lineTo(95, 105); // Links unten
    ctx.fill();

    // --- WAFFEN-SCHWINGEN (Weapon Bob) ---
    if (!isReloading && !isScoped) {
      const weaponImg = document.getElementById("weapon");
      let swayX = 0;
      let swayY = 0;
      let dropAmount = 0; // Wie weit die Waffe abgesenkt wird

      if (isMoving && canJump) {
        const t = time * (moveSprint ? 0.02 : moveCrouch ? 0.005 : 0.01);
        swayX = Math.sin(t) * 30;
        swayY = Math.abs(Math.cos(t)) * 15;

        // Waffe absenken beim Bewegen
        if (moveSprint) {
          dropAmount = 150; // Stark absenken beim Sprinten (Q)
        } else {
          dropAmount = 30; // Leicht absenken beim normalen Laufen (WASD)
        }
      }

      // Gesamt-Transformation berechnen
      weaponImg.style.transform = `translateX(calc(-50% + 350px + ${swayX}px)) translateY(${swayY + dropAmount}px) rotateY(-15deg)`;
    }

    // --- BUG SOUND LOGIC ---
    if (time > nextBugEvent) {
      if (bugSound.buffer && !bugSound.isPlaying) {
        bugSound.play();
      }
      nextBugEvent = time + Math.random() * 30000 + 15000; // Alle 15-45 Sekunden passiert es wieder
    }

    // Audio-Logik für Laufen
    if (bugSound.isPlaying) {
      // Wenn der Bug-Sound läuft, höre ich KEINE Schritte
      if (walkSound.isPlaying) walkSound.pause();
      if (sprintSound.isPlaying) sprintSound.pause();
      if (duckSound.isPlaying) duckSound.pause();
    } else if (isMoving && canJump) {
      // Nur Sound abspielen, wenn am Boden (und kein Bug da ist)
      if (moveSprint) {
        // SPRINTEN
        if (sprintSound.buffer && !sprintSound.isPlaying) sprintSound.play();
        if (walkSound.isPlaying) walkSound.pause();
        if (duckSound.isPlaying) duckSound.pause();
      } else if (moveCrouch) {
        // DUCKEN / SCHLEICHEN
        if (duckSound.buffer && !duckSound.isPlaying) duckSound.play();
        if (walkSound.isPlaying) walkSound.pause();
        if (sprintSound.isPlaying) sprintSound.pause();
      } else {
        // NORMALES LAUFEN
        if (walkSound.buffer && !walkSound.isPlaying) walkSound.play();
        if (sprintSound.isPlaying) sprintSound.pause();
        if (duckSound.isPlaying) duckSound.pause();
      }
    } else {
      // Keine Bewegung oder in der Luft -> Sounds stoppen
      if (walkSound.isPlaying) walkSound.pause();
      if (sprintSound.isPlaying) sprintSound.pause();
      if (duckSound.isPlaying) duckSound.pause();
    }

    prevTime = time;
  } else {
    // Sound stoppen, wenn Spiel pausiert ist (Esc gedrückt)
    if (walkSound.isPlaying) walkSound.pause();
    if (sprintSound.isPlaying) sprintSound.pause();
    if (duckSound.isPlaying) duckSound.pause();
  }

  // --- FADENKREUZ LOGIK ---
  // Auch hier Offset beachten für die rote Färbung
  let rayX = 0;
  let rayY = 0;
  if (!isScoped) {
    rayX = -80 / window.innerWidth;
    rayY = -80 / window.innerHeight;
  }
  raycaster.setFromCamera(new THREE.Vector2(rayX, rayY), camera);
  const hits = raycaster.intersectObjects(targets);
  if (hits.length > 0) {
    crosshair.style.backgroundColor = "red";
  } else {
    crosshair.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
  }

  // 1. Haupt-Szene rendern (Vollbild)
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);

  // 2. Rückspiegel rendern (Oben Mitte) - Nur wenn man fährt
  if (isDriving) {
    const mw = 300; // Spiegel Breite
    const mh = 100; // Spiegel Höhe
    const mx = (window.innerWidth - mw) / 2; // Mitte X
    const my = window.innerHeight - mh - 10; // Oben Y (Achtung: WebGL Koordinaten sind von unten!)

    renderer.setScissor(mx, my, mw, mh);
    renderer.setViewport(mx, my, mw, mh);
    renderer.setScissorTest(true); // Aktiviert den "Fenster-Modus" für den Spiegel
    renderer.render(scene, rearCamera);
    renderer.setScissorTest(false);
  }
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();
