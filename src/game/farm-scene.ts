// The homestead scene: draws the map, moves the farmer, and turns the
// "use" input into farm actions on the tile the farmer is facing.
import Phaser from 'phaser';
import { now, vnHour } from '../clock';
import { t } from '../i18n';
import { saveFarm } from '../save';
import { isWilted, progress } from '../sim/growth';
import {
  buySeeds,
  cropStage,
  harvest,
  key,
  payout,
  plant,
  plotState,
  ship,
  till,
  water,
  type ActionResult,
  type FarmState,
} from '../sim/farm';
import { SPECIES, SPECIES_IDS, type SpeciesId } from '../sim/species';
import { Hud, setIconSource } from '../ui/hud';
import { TILE, buildTextures } from './textures';
import { BLOCKING, MAP_H, MAP_W, PROPS, SPAWN, buildGround, isFieldTile, propAt, type Ground } from './world-map';

const SPEED = 70; // px per second in world units
type Facing = 'down' | 'up' | 'left' | 'right';
const DIRS: Record<Facing, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

export class FarmScene extends Phaser.Scene {
  private farm!: FarmState;
  private hud!: Hud;
  private player!: Phaser.Physics.Arcade.Sprite;
  private facing: Facing = 'down';
  private selected: SpeciesId = 'rau_muong';
  private ground!: Ground[][];
  private soil = new Map<string, Phaser.GameObjects.Image>();
  private crops = new Map<string, Phaser.GameObjects.Image>();
  private cursor!: Phaser.GameObjects.Rectangle;
  private night!: Phaser.GameObjects.Rectangle;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastClock = '';

  constructor(private boot: { farm: FarmState; isNew: boolean }) {
    super('farm');
  }

  create() {
    this.farm = this.boot.farm;
    buildTextures(this);
    setIconSource((id) => this.textures.get(`${id}_4`).getSourceImage() as HTMLCanvasElement);

    this.ground = buildGround();
    const walls = this.physics.add.staticGroup();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const g = this.ground[y][x];
        const px = x * TILE + TILE / 2;
        const py = y * TILE + TILE / 2;
        const base = g === 'path' || g === 'water' ? g : (x * 7 + y * 13) % 11 === 0 ? 'grass2' : 'grass';
        this.add.image(px, py, base);
        if (g === 'field') this.add.image(px, py, 'grass');
        if (g === 'fence' || g === 'tree') this.add.image(px, py, g).setDepth(py);
        if (BLOCKING.includes(g)) walls.add(this.add.zone(px, py, TILE, TILE));
      }
    }
    for (const p of PROPS) {
      const tex = p.id;
      const img = this.add.image(p.x * TILE, (p.y + p.h) * TILE, tex).setOrigin(0, 1);
      img.setDepth((p.y + p.h) * TILE);
      walls.add(this.add.zone(p.x * TILE + (p.w * TILE) / 2, p.y * TILE + (p.h * TILE) / 2, p.w * TILE, p.h * TILE));
    }

    this.player = this.physics.add.sprite(SPAWN.x * TILE + 8, SPAWN.y * TILE + 8, 'phu_down');
    this.player.body!.setSize(10, 6).setOffset(3, 10);
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.physics.add.collider(this.player, walls);

    this.cursor = this.add.rectangle(0, 0, TILE, TILE).setStrokeStyle(1, 0xffffff, 0.9).setDepth(9000);
    this.night = this.add
      .rectangle(0, 0, MAP_W * TILE, MAP_H * TILE, 0x1a2350, 0)
      .setOrigin(0)
      .setDepth(9500);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    cam.startFollow(this.player, true, 0.15, 0.15);
    cam.setRoundPixels(true);
    this.scale.on('resize', () => this.fitZoom());
    this.fitZoom();

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,E,ONE,TWO,THREE') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    kb.on('keydown-SPACE', () => this.act());
    kb.on('keydown-E', () => this.act());
    kb.on('keydown-ESC', () => this.hud.closeShop());
    (['ONE', 'TWO', 'THREE'] as const).forEach((k, i) =>
      kb.on(`keydown-${k}`, () => !this.hud.shopOpen && this.selectSeed(SPECIES_IDS[i])),
    );

    this.hud = new Hud({
      onSelectSeed: (id) => this.selectSeed(id),
      onAction: () => this.act(),
      onBuy: (id, n) => this.report(buySeeds(this.farm, id, n), true),
      onLangChange: () => this.refresh(),
    });

    const paid = payout(this.farm, now());
    this.refresh();
    if (paid) this.hud.toast(t('payout', { value: paid }));
    else if (this.boot.isNew) this.hud.toast(t('welcome'));

    // Growth is derived from time, so the field just redraws periodically.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
    this.time.addEvent({ delay: 15000, loop: true, callback: () => saveFarm(this.farm) });
    window.addEventListener('beforeunload', () => saveFarm(this.farm));
    if (location.hash === '#qa') Object.assign(window, { __qa: { scene: this, farm: () => this.farm } });
  }

  private fitZoom() {
    const { width, height } = this.scale.gameSize;
    // Integer zoom keeps pixels crisp; aim for ~14 tiles across on phones.
    const zoom = Math.max(2, Math.floor(Math.min(width / (14 * TILE), height / (10 * TILE))));
    this.cameras.main.setZoom(zoom);
  }

  update(_: number, dtMs: number) {
    const k = this.keys;
    let vx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    let vy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (!vx && !vy) ({ x: vx, y: vy } = this.hud.stick);
    if (this.hud.shopOpen) vx = vy = 0;
    const len = Math.hypot(vx, vy) || 1;
    this.player.setVelocity((vx / len) * SPEED, (vy / len) * SPEED);

    if (Math.abs(vx) > 0.3 || Math.abs(vy) > 0.3) {
      this.facing = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
      // Tiny bob while walking.
      this.player.setDisplayOrigin(8, 8 + (Math.floor(this.time.now / 150) % 2));
    } else this.player.setDisplayOrigin(8, 8);
    const tex = this.facing === 'left' || this.facing === 'right' ? 'phu_side' : `phu_${this.facing}`;
    this.player.setTexture(tex).setFlipX(this.facing === 'left');
    this.player.setDepth(this.player.y + 4);

    const [tx, ty] = this.target();
    this.cursor.setPosition(tx * TILE + 8, ty * TILE + 8);
    void dtMs;
  }

  /** Tile in front of the farmer. */
  private target(): [number, number] {
    const [dx, dy] = DIRS[this.facing];
    const cx = Math.floor(this.player.x / TILE);
    const cy = Math.floor((this.player.y + 4) / TILE);
    return [cx + dx, cy + dy];
  }

  private act() {
    if (this.hud.shopOpen) return;
    const [x, y] = this.target();
    const ts = now();
    const prop = propAt(x, y);
    if (prop?.id === 'bin') return this.report(ship(this.farm, ts), true);
    if (prop?.id === 'stall') return this.hud.openShop(this.farm);
    if (prop?.id === 'sapling') return this.hud.toast(t('tree'));
    if (!isFieldTile(x, y)) return this.hud.toast(t('cant_farm'));

    const plot = this.farm.plots[key(x, y)];
    if (!plot) return this.report(till(this.farm, x, y));
    const state = plotState(plot, ts);
    if (state === 'empty') return this.report(plant(this.farm, x, y, this.selected, ts), true);
    if (state === 'needs_water') return this.report(water(this.farm, x, y, ts));
    if (state === 'ready') return this.report(harvest(this.farm, x, y, ts), true);
    const crop = plot.crop!;
    const growMs =
      crop.harvests && SPECIES[crop.species].regrowMs ? SPECIES[crop.species].regrowMs! : SPECIES[crop.species].growMs;
    this.hud.toast(t('growing', { species: crop.species, pct: Math.floor(progress(crop, growMs, ts) * 100) }));
  }

  private report(r: ActionResult, rerenderHud = false) {
    this.hud.toast(t(r.msg, r.vars));
    if (!r.ok) return;
    this.drawField();
    if (rerenderHud) this.hud.render(this.farm, this.selected);
    if (this.hud.shopOpen) this.hud.openShop(this.farm);
    saveFarm(this.farm);
  }

  private selectSeed(id: SpeciesId) {
    this.selected = id;
    this.hud.render(this.farm, this.selected);
  }

  private refresh() {
    this.drawField();
    this.hud.render(this.farm, this.selected);
    this.tick();
  }

  private tick() {
    const ts = now();
    const paid = payout(this.farm, ts);
    if (paid) {
      this.hud.toast(t('payout', { value: paid }));
      this.hud.render(this.farm, this.selected);
      saveFarm(this.farm);
    }
    this.drawField();
    const h = vnHour(ts);
    // Darkness ramps 17–19h and 5–7h; fully dark overnight but never black.
    const dark = h >= 19 || h < 5 ? 1 : h >= 17 ? (h - 17) / 2 : h < 7 ? (7 - h) / 2 : 0;
    this.night.setAlpha(dark * 0.45);
    const clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    if (clock !== this.lastClock) this.hud.setClock((this.lastClock = clock));
  }

  /** Syncs soil and crop images with the farm state. */
  private drawField() {
    const ts = now();
    for (const [k, plot] of Object.entries(this.farm.plots)) {
      const [x, y] = k.split(',').map(Number);
      const px = x * TILE + 8;
      const py = y * TILE + 8;
      const wet = plot.crop && plotState(plot, ts) !== 'needs_water';
      const soilTex = wet ? 'soil_wet' : 'soil';
      const soil = this.soil.get(k) ?? this.soil.set(k, this.add.image(px, py, soilTex).setDepth(1)).get(k)!;
      soil.setTexture(soilTex);

      const existing = this.crops.get(k);
      if (!plot.crop) {
        existing?.destroy();
        this.crops.delete(k);
        continue;
      }
      const tex = `${plot.crop.species}_${cropStage(plot.crop, ts)}`;
      const img = existing ?? this.crops.set(k, this.add.image(px, py - 2, tex).setDepth(py)).get(k)!;
      img.setTexture(tex);
      if (cropStage(plot.crop, ts) < 4 && isWilted(plot.crop, ts)) img.setTint(0xc2a66a).setAngle(8);
      else img.clearTint().setAngle(0);
    }
  }
}
