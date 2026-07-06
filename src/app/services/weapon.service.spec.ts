import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { WeaponService } from './weapon.service';
import { GameEngineService } from './game-engine.service';
import * as THREE from 'three';

describe('WeaponService', () => {
  let service: WeaponService;
  let gameEngineSpy: jasmine.SpyObj<GameEngineService>;

  beforeEach(() => {
    const spy = jasmine.createSpyObj('GameEngineService', ['playSound']);
    TestBed.configureTestingModule({
      providers: [
        WeaponService,
        { provide: GameEngineService, useValue: spy }
      ]
    });
    service = TestBed.inject(WeaponService);
    gameEngineSpy = TestBed.inject(GameEngineService) as jasmine.SpyObj<GameEngineService>;
  });

  it('sollte mit voller Munition starten', (done) => {
    service.ammo$.subscribe(ammo => {
      expect(ammo).toBe(30);
      done();
    });
  });

  it('sollte Munition beim Schießen verringern', () => {
    const camera = new THREE.PerspectiveCamera();
    service.shoot(camera, []);
    
    service.ammo$.subscribe(ammo => {
      expect(ammo).toBe(29);
    });
    expect(gameEngineSpy.playSound).toHaveBeenCalledWith('shoot');
  });

  it('sollte nach 1.5 Sekunden nachladen', fakeAsync(() => {
    service.shoot(new THREE.PerspectiveCamera(), []);
    service.reload();
    
    tick(1500); // Simuliert den Zeitablauf von 1.5s
    service.ammo$.subscribe(ammo => {
      expect(ammo).toBe(30);
    });
  }));
});