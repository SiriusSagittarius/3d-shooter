export class Broom {
  constructor() {
    this.isActive = false;

    // Das Bild-Element für den Besen erstellen
    this.element = document.createElement("img");
    this.element.src = "assets/img/besen.png"; // Korrekter Pfad zum Bild
    this.element.alt = "Broom";
    this.element.id = "broom";

    // Styling (ähnlich wie die Waffe, aber angepasst)
    this.element.style.cssText = `
      position: absolute;
      bottom: -15vh; /* Etwas tiefer, damit es aussieht, als sitzt man drauf oder hält ihn tief */
      left: 50%;
      transform: translateX(-50%);
      height: 60vh;
      display: none; /* Anfangs unsichtbar */
      pointer-events: none;
      z-index: 6;
    `;

    document.body.appendChild(this.element);
  }

  toggle() {
    this.isActive = !this.isActive;
    this.element.style.display = this.isActive ? "block" : "none";
    return this.isActive;
  }
}
