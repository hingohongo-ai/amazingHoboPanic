import Phaser from 'phaser';
import {
  COLORS,
  DOG,
  DUMPSTER,
  ENVY,
  ITEMS,
  NEWSPAPER,
  PANIC,
  PLAYER,
  SHOPKEEPER,
  SPAWN,
  STINK,
  TOUCH,
  VIEW,
  WARMTH,
  WORLD,
  type ItemType,
} from '../config';
import { Envy } from '../envy';
import { Sky } from '../sky';
import * as sfx from '../audio';
import { showHome } from '../home';

type Rect = Phaser.GameObjects.Rectangle;
type Body = Phaser.Physics.Arcade.Body;
type Point = { x: number; y: number };

const bodyOf = (rect: Rect): Body => rect.body as Body;
const dist = (a: Point, b: Point): number => Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

export interface RunStats {
  seconds: number;
  days: number;
  panics: number;
  bonked: number;
  eaten: number;
}

interface GroundItem {
  rect: Rect;
  type: ItemType;
  /** Dropped food is what the horde and the dog go for. */
  dropped: boolean;
  noPickupUntil: number;
}

type Target =
  | { kind: 'player' }
  /** Crowd in around the player and loom, without swinging. */
  | { kind: 'crowd' }
  | { kind: 'hobo'; hobo: Hobo }
  | { kind: 'item'; item: GroundItem }
  | null;

interface Hobo {
  rect: Rect;
  hp: number;
  ko: boolean;
  fleeing: boolean;
  speed: number;
  cooldown: number;
  stun: number;
  thinkIn: number;
  target: Target;
  /** Whoever bonked this hobo last. Grudges are what turn the horde on itself. */
  grudge: Hobo | null;
  /** While positive, he has just eaten dropped food and the others want a word. */
  looter: number;
  /** What the food he grabbed was worth. A big enough prize gets him mobbed at once. */
  lootValue: number;
  /** While positive, the player bonked him and he remembers. */
  madAtPlayer: number;
}

interface Townsperson {
  rect: Rect;
  turnIn: number;
}

interface Dumpster {
  rect: Rect;
  /** Fills left to right while the player stands against it. */
  progress: Rect;
  full: boolean;
  dwell: number;
  refillIn: number;
}

interface Fire {
  x: number;
  y: number;
  flame: Rect;
  glow: Phaser.GameObjects.Arc;
}

interface Shopkeeper {
  rect: Rect;
  /** Which way he is pacing: 1 right, -1 left. */
  dir: number;
  /** Seconds of chase left; zero or less means he is minding the shop. */
  chasing: number;
  broomIn: number;
}

type PanicState = 'calm' | 'approach' | 'melee' | 'exit';

const YARD_TOP = 960;
const STREET_BOTTOM = 330;
const TRAIN_EXIT: Point = { x: WORLD.w + 60, y: 1100 };

// Six storefronts along main street. One of them has a shopkeeper and a pie on the sill.
const SHOP = { firstX: 190, gap: 300, y: 110, w: 190, h: 120 };
const KEEPER_SHOP_X = SHOP.firstX + SHOPKEEPER.shop * SHOP.gap;
const KEEPER_WALK_Y = SHOP.y + SHOP.h / 2 + 30;
const SILL: Point = { x: KEEPER_SHOP_X + 70, y: SHOP.y + SHOP.h / 2 + 12 };
const FIRE_SPOTS: Point[] = [
  { x: 350, y: 640 }, // the hobo camp
  { x: 1700, y: 620 }, // the outskirts
  { x: 300, y: 1240 }, // the far end of the yard, away from the dog
];
const DUMPSTER_SPOTS: Point[] = [
  { x: 340, y: 90 }, // alleys between the shops
  { x: 940, y: 90 },
  { x: 1540, y: 90 },
  { x: 760, y: 1250 }, // the yard
];
const TROUGH: Point = { x: 640, y: 292 };

export class GameScene extends Phaser.Scene {
  private player!: Rect;
  private health = PLAYER.maxHealth;
  private hunger = PLAYER.maxHunger;
  private warmth = WARMTH.max;
  /** Cold the newspaper in your shirt can still soak up. */
  private padding = 0;
  private stink = 0;
  private bathing = false;
  private sack: ItemType[] = [];
  private swingIn = 0;
  private playerStun = 0;
  private hurtFlash = 0;
  private safeFor = 0;

  private envy = new Envy();
  private state: PanicState = 'calm';
  private shownStage = -1;

  private items: GroundItem[] = [];
  private hobos: Hobo[] = [];
  private townsfolk: Townsperson[] = [];
  private dog!: { rect: Rect; home: Point; stun: number; biteIn: number; busy: number };

  private sky!: Sky;
  private fires: Fire[] = [];
  private dumpsters: Dumpster[] = [];
  private keeper!: Shopkeeper;
  private pie!: Rect;
  private pieBar!: Rect;
  private pieOut = false;
  private pieIn = 0;
  private pieDwell = 0;
  /** False while the mob is still gathering round the player; true once they turn on each other. */
  private brawling = false;
  private meleeAge = 0;
  private hordeSize = 0;
  private stinkCloud!: Phaser.GameObjects.Arc;
  private flies: Rect[] = [];

  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private hoboGroup!: Phaser.Physics.Arcade.Group;
  private crows: Rect[] = [];
  private gloom!: Rect;
  private hud!: Phaser.GameObjects.Text;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  // Mouse and touch: one pointer steers, the on-screen buttons act.
  private steer: Phaser.Input.Pointer | null = null;
  private steerOrigin: Point = { x: 0, y: 0 };
  private stickBase!: Phaser.GameObjects.Arc;
  private stickKnob!: Phaser.GameObjects.Arc;
  private swingHeld = false;
  private wantEat = false;
  private wantDrop = false;

  private respawnIn = SPAWN.respawnEverySec;
  private stillToArrive = 0;
  private stats: RunStats = { seconds: 0, days: 0, panics: 0, bonked: 0, eaten: 0 };

  constructor() {
    super('Game');
  }

  /** Phaser reuses the scene object between runs, so every field is reset here. */
  init(): void {
    this.health = PLAYER.maxHealth;
    this.hunger = PLAYER.maxHunger;
    this.warmth = WARMTH.max;
    this.padding = 0;
    this.stink = 0;
    this.bathing = false;
    this.fires = [];
    this.dumpsters = [];
    this.pieOut = false;
    this.pieIn = 0;
    this.pieDwell = 0;
    this.brawling = false;
    this.meleeAge = 0;
    this.hordeSize = 0;
    this.flies = [];
    this.sack = [];
    this.swingIn = 0;
    this.playerStun = 0;
    this.hurtFlash = 0;
    this.safeFor = 0;
    this.envy = new Envy();
    this.state = 'calm';
    this.shownStage = -1;
    this.items = [];
    this.hobos = [];
    this.townsfolk = [];
    this.crows = [];
    this.respawnIn = SPAWN.respawnEverySec;
    this.stats = { seconds: 0, days: 0, panics: 0, bonked: 0, eaten: 0 };
    this.stillToArrive = 0;
    this.steer = null;
    this.swingHeld = false;
    this.wantEat = false;
    this.wantDrop = false;
  }

  create(): void {
    showHome(false);
    this.physics.world.setBounds(0, 0, WORLD.w, WORLD.h);
    this.cameras.main.setBounds(0, 0, WORLD.w, WORLD.h);

    this.buildTown();
    this.buildActors();
    this.sky = new Sky(this);
    this.buildHud();
    this.buildPointerControls();

    for (let i = 0; i < SPAWN.itemsOnMap; i++) this.spawnItem();

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE,E,Q') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
  }

  // ---------------------------------------------------------------- setup

  private buildTown(): void {
    const block = (x: number, y: number, w: number, h: number, color: number): Rect =>
      this.add.rectangle(x, y, w, h, color).setOrigin(0, 0);

    block(0, 0, WORLD.w, WORLD.h, COLORS.ground);
    block(0, 0, WORLD.w, STREET_BOTTOM, COLORS.street); // main street
    block(0, YARD_TOP, WORLD.w, WORLD.h - YARD_TOP, COLORS.yard); // railyard
    block(180, 520, 340, 240, COLORS.camp); // hobo camp
    for (const y of [1080, 1120]) block(0, y, WORLD.w, 6, COLORS.rail);

    this.walls = this.physics.add.staticGroup();
    for (let i = 0; i < 6; i++) {
      const color = i === SHOPKEEPER.shop ? COLORS.keeperShop : COLORS.shop;
      const shop = this.add.rectangle(SHOP.firstX + i * SHOP.gap, SHOP.y, SHOP.w, SHOP.h, color);
      this.walls.add(shop);
    }
    this.add.rectangle(SILL.x, SILL.y - 9, 34, 6, COLORS.sill); // the windowsill where the pie cools
    this.pie = this.add.rectangle(SILL.x, SILL.y - 18, 14, 10, ITEMS[1].color).setDepth(2).setVisible(false);
    this.pieBar = this.add
      .rectangle(SILL.x - 17, SILL.y - 30, 34, 5, COLORS.buttonEdge)
      .setOrigin(0, 0.5)
      .setDepth(5)
      .setScale(0, 1);
    // A few boxcars parked in the yard.
    for (const x of [420, 980, 1500]) {
      const car = this.add.rectangle(x, 1010, 220, 60, COLORS.rail);
      this.walls.add(car);
    }

    for (const spot of DUMPSTER_SPOTS) {
      const rect = this.add.rectangle(spot.x, spot.y, 64, 40, COLORS.dumpster);
      this.walls.add(rect);
      const progress = this.add
        .rectangle(spot.x - 32, spot.y - 30, 64, 5, COLORS.buttonEdge)
        .setOrigin(0, 0.5)
        .setDepth(5)
        .setScale(0, 1);
      this.dumpsters.push({ rect, progress, full: true, dwell: 0, refillIn: 0 });
    }

    this.add.rectangle(TROUGH.x, TROUGH.y, 84, 30, COLORS.trough).setStrokeStyle(3, COLORS.rail);

    for (const spot of FIRE_SPOTS) {
      const barrel = this.add.rectangle(spot.x, spot.y, 26, 30, COLORS.barrel).setDepth(2);
      this.walls.add(barrel);
      const flame = this.add.rectangle(spot.x, spot.y - 20, 16, 14, COLORS.flame).setDepth(2);
      // The glow sits above the night tint, so a fire is the one bright thing after dark.
      const glow = this.add
        .circle(spot.x, spot.y, WARMTH.fireRadius, COLORS.flame, 0.08)
        .setDepth(7.5)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.fires.push({ x: spot.x, y: spot.y, flame, glow });
    }
  }

  private buildActors(): void {
    this.player = this.add.rectangle(WORLD.w / 2, 640, 24, 24, COLORS.player).setDepth(4);
    this.physics.add.existing(this.player);
    bodyOf(this.player).setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    for (let i = 0; i < 6; i++) {
      const rect = this.add
        .rectangle(Phaser.Math.Between(80, WORLD.w - 80), Phaser.Math.Between(220, 310), 20, 24, COLORS.townsfolk)
        .setDepth(3);
      this.physics.add.existing(rect);
      bodyOf(rect).setCollideWorldBounds(true);
      this.townsfolk.push({ rect, turnIn: 0 });
    }

    const home = { x: 1200, y: 1180 };
    const dogRect = this.add.rectangle(home.x, home.y, 22, 16, COLORS.dog).setDepth(3);
    this.physics.add.existing(dogRect);
    bodyOf(dogRect).setCollideWorldBounds(true);
    this.physics.add.collider(dogRect, this.walls);
    this.dog = { rect: dogRect, home, stun: 0, biteIn: 0, busy: 0 };

    this.hoboGroup = this.physics.add.group();
    this.physics.add.collider(this.hoboGroup, this.walls);
    this.physics.add.collider(this.hoboGroup, this.hoboGroup);

    const keeperRect = this.add.rectangle(KEEPER_SHOP_X, KEEPER_WALK_Y, 22, 26, COLORS.keeper).setDepth(3);
    this.physics.add.existing(keeperRect);
    this.physics.add.collider(keeperRect, this.walls);
    this.keeper = { rect: keeperRect, dir: 1, chasing: 0, broomIn: 0 };

    // Stink has no meter. It shows as a green haze and a few flies that follow you about.
    this.stinkCloud = this.add.circle(0, 0, 20, COLORS.stink, 0).setDepth(3.5);
    for (let i = 0; i < 6; i++) {
      this.flies.push(this.add.rectangle(0, 0, 3, 3, COLORS.fly).setDepth(5).setVisible(false));
    }
  }

  private buildHud(): void {
    // Everything here is pinned to the screen, not the world.
    this.gloom = this.add.rectangle(0, 0, VIEW.w, VIEW.h, 0x000000, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(8);
    this.add.rectangle(0, 26, VIEW.w, 2, COLORS.wire).setOrigin(0, 0).setScrollFactor(0).setDepth(9);
    for (const x of [90, 132, 214, 330, 372, 501, 640, 722, 868]) {
      const crow = this.add.rectangle(x, 20, 10, 10, COLORS.crow).setScrollFactor(0).setDepth(9).setVisible(false);
      this.crows.push(crow);
    }
    this.hud = this.add
      .text(14, 38, '', { fontFamily: 'monospace', fontSize: '15px', color: '#f0e6cc' })
      .setScrollFactor(0)
      .setDepth(10);
  }

  /**
   * Mouse: hold the left button and the hobo walks toward the cursor; right-click swings.
   * Touch: the first finger on the play field becomes a thumb stick wherever it lands.
   * Both: the three buttons in the corner swing, eat and drop.
   */
  private buildPointerControls(): void {
    this.input.addPointer(2); // enough fingers to steer and press a button at once
    this.input.mouse?.disableContextMenu();

    this.stickBase = this.add.circle(0, 0, TOUCH.stickRadius, 0xffffff, 0.08).setScrollFactor(0).setDepth(10);
    this.stickBase.setStrokeStyle(2, COLORS.buttonEdge, 0.5).setVisible(false);
    this.stickKnob = this.add.circle(0, 0, 20, COLORS.buttonEdge, 0.45).setScrollFactor(0).setDepth(10).setVisible(false);

    const button = (x: number, y: number, label: string, onDown: () => void, onUp?: () => void): void => {
      const disc = this.add.circle(x, y, TOUCH.buttonRadius, COLORS.button, 0.6).setScrollFactor(0).setDepth(10);
      disc.setStrokeStyle(2, COLORS.buttonEdge, 0.8).setInteractive({ useHandCursor: true });
      this.add
        .text(x, y, label, { fontFamily: 'Georgia, serif', fontSize: '16px', color: '#e8c07a' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(11);
      disc.on('pointerdown', () => {
        disc.setFillStyle(COLORS.buttonEdge, 0.5);
        onDown();
      });
      const release = (): void => {
        disc.setFillStyle(COLORS.button, 0.6);
        onUp?.();
      };
      disc.on('pointerup', release);
      disc.on('pointerout', release);
    };
    const right = VIEW.w - 62;
    const low = VIEW.h - 96;
    button(right, low, 'SWING', () => (this.swingHeld = true), () => (this.swingHeld = false));
    button(right - 104, low + 28, 'EAT', () => (this.wantEat = true));
    button(right - 208, low + 28, 'DROP', () => (this.wantDrop = true));

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length > 0) return; // that press belongs to a button
      if (pointer.rightButtonDown()) {
        this.swingHeld = true;
        return;
      }
      this.steer = pointer;
      this.steerOrigin = { x: pointer.x, y: pointer.y };
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer === this.steer) this.steer = null;
      if (!pointer.wasTouch && !pointer.rightButtonDown()) this.swingHeld = false;
    });
  }

  /** The direction the mouse or thumb is asking for, or null when neither is steering. */
  private pointerDirection(): Point | null {
    const pointer = this.steer;
    const steering = pointer !== null && pointer.isDown;
    const usingStick = steering && pointer.wasTouch;
    this.stickBase.setVisible(usingStick);
    this.stickKnob.setVisible(usingStick);
    if (!steering) return null;

    if (pointer.wasTouch) {
      const dx = pointer.x - this.steerOrigin.x;
      const dy = pointer.y - this.steerOrigin.y;
      const len = Math.hypot(dx, dy);
      const reach = Math.min(len, TOUCH.stickRadius);
      this.stickBase.setPosition(this.steerOrigin.x, this.steerOrigin.y);
      this.stickKnob.setPosition(
        this.steerOrigin.x + (len ? (dx / len) * reach : 0),
        this.steerOrigin.y + (len ? (dy / len) * reach : 0),
      );
      return len < TOUCH.deadZone ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
    }

    // Mouse: walk toward the cursor and stop on reaching it.
    const at = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const dx = at.x - this.player.x;
    const dy = at.y - this.player.y;
    const len = Math.hypot(dx, dy);
    return len < 10 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
  }

  // ---------------------------------------------------------------- loop

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000;
    this.stats.seconds += dt;

    this.sky.update(dt);
    this.updatePlayer(dt);
    this.updateNeeds(dt);
    this.updateStinkLook();
    this.updateFires();
    this.updateDumpsters(dt);
    this.updateEnvy(dt);
    this.updateTownsfolk(dt);
    this.updateKeeper(dt);
    this.updateDog(dt);
    this.updateHobos(dt);
    this.updateSpawns(dt);
    this.updateHud();

    if (this.health <= 0) {
      this.stats.days = this.sky.daysSurvived;
      this.scene.start('GameOver', this.stats);
    }
  }

  // ---------------------------------------------------------------- player

  private updatePlayer(dt: number): void {
    const k = this.keys;
    const body = bodyOf(this.player);
    this.swingIn -= dt;
    this.playerStun -= dt;
    this.hurtFlash -= dt;
    this.safeFor -= dt;
    this.player.setFillStyle(this.hurtFlash > 0 ? 0xff5040 : COLORS.player);

    if (this.playerStun <= 0) {
      let dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
      let dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
      const pointing = this.pointerDirection();
      if (dx === 0 && dy === 0 && pointing) {
        dx = pointing.x;
        dy = pointing.y;
      }
      const len = Math.hypot(dx, dy) || 1;
      // A full sack is a heavy bindle: each item carried slows you a little. So does the cold.
      const chill =
        this.warmth >= WARMTH.slowBelow
          ? 1
          : WARMTH.slowTo + (1 - WARMTH.slowTo) * (this.warmth / WARMTH.slowBelow);
      const speed = PLAYER.speed * (1 - 0.04 * this.sack.length) * chill;
      body.setVelocity((dx / len) * speed, (dy / len) * speed);
    }

    // Pick up whatever you walk over, if the sack has room.
    const now = this.time.now;
    for (const item of [...this.items]) {
      if (now < item.noPickupUntil || dist(this.player, item.rect) > 24) continue;
      if (item.type === NEWSPAPER) {
        // Newspaper goes inside the shirt, not in the sack. Wet newspaper is no use to anyone.
        if (this.sky.raining || this.padding >= WARMTH.paperMax) continue;
        this.padding = Math.min(WARMTH.paperMax, this.padding + WARMTH.paperWorth);
        this.removeItem(item);
        sfx.pickup();
        this.say(this.player.x, this.player.y - 24, 'Rustle.');
        continue;
      }
      if (this.sack.length >= PLAYER.sackSlots) continue;
      this.sack.push(item.type);
      this.envy.add(item.type.value);
      this.removeItem(item);
      sfx.pickup();
    }

    if (Phaser.Input.Keyboard.JustDown(k.E) || this.wantEat) this.eat();
    if (Phaser.Input.Keyboard.JustDown(k.Q) || this.wantDrop) this.dropFood();
    this.wantEat = false;
    this.wantDrop = false;
    if ((k.SPACE.isDown || this.swingHeld) && this.swingIn <= 0) this.swing();
  }

  private eat(): void {
    const food = this.sack.pop();
    if (!food) return;
    this.hunger = Math.min(PLAYER.maxHunger, this.hunger + food.food);
    this.stats.eaten++;
    sfx.munch();
    if (food.stink) {
      this.stink = Math.min(STINK.max, this.stink + food.stink);
      this.say(this.player.x, this.player.y - 24, pick(['Toot.', 'The musical fruit.', 'Pardon.']));
    }
    // Eating in private takes the item's value off Envy. Eating where anyone can see adds to it.
    this.envy.add(this.isSeen() ? food.value : -food.value);
  }

  private isSeen(): boolean {
    const near = (rect: Rect): boolean => dist(this.player, rect) < PLAYER.seenRadius;
    return (
      this.townsfolk.some((t) => t.rect.visible && near(t.rect)) ||
      (this.keeper.rect.visible && near(this.keeper.rect)) ||
      this.hobos.some((h) => !h.ko && near(h.rect))
    );
  }

  private dropFood(): void {
    const food = this.sack.pop();
    if (!food) return;
    this.envy.add(-food.value);
    this.placeItem(food, this.player.x, this.player.y, true);
  }

  private swing(): void {
    this.swingIn = PLAYER.swingCooldown * (1 + 0.08 * this.sack.length); // heavier bindle, slower swing
    const arc = this.add.circle(this.player.x, this.player.y, PLAYER.swingRadius, 0xffffff, 0.22).setDepth(5);
    this.tweens.add({ targets: arc, alpha: 0, duration: 140, onComplete: () => arc.destroy() });

    let hit = false;
    for (const hobo of this.hobos) {
      if (hobo.ko || dist(this.player, hobo.rect) > PLAYER.swingRadius) continue;
      this.hitHobo(hobo, this.player, null);
      hit = true;
    }
    if (dist(this.player, this.dog.rect) <= PLAYER.swingRadius) {
      this.shove(this.dog.rect, this.player, 320);
      this.dog.stun = 0.7;
      hit = true;
    }
    if (hit) sfx.bonk();
  }

  private hurtPlayer(amount: number, from: Point): void {
    // A moment of mercy after each hit, so a crowd can't land ten blows in one frame.
    if (this.safeFor > 0) return;
    this.safeFor = PLAYER.mercySec;
    this.health -= amount;
    this.hurtFlash = 0.12;
    this.playerStun = 0.18;
    this.shove(this.player, from, 240);
    sfx.bonk();
  }

  private updateNeeds(dt: number): void {
    this.hunger = Math.max(0, this.hunger - PLAYER.hungerPerSec * dt);
    if (this.hunger <= 0) this.health -= PLAYER.starvePerSec * dt;

    // Warmth: a fire always wins; otherwise night and rain take it and dry daylight gives it back.
    const cold = (this.sky.isNight ? WARMTH.nightPerSec : 0) + (this.sky.raining ? WARMTH.rainPerSec : 0);
    if (this.sky.raining && this.padding > 0) {
      this.padding = 0;
      this.say(this.player.x, this.player.y - 24, 'Soggy newspaper.');
    }
    if (this.fires.some((fire) => dist(this.player, fire) < WARMTH.fireRadius)) {
      this.warmth = Math.min(WARMTH.max, this.warmth + WARMTH.firePerSec * dt);
    } else if (cold > 0) {
      // The newspaper takes the cold first.
      const soaked = Math.min(this.padding, cold * dt);
      this.padding -= soaked;
      this.warmth = Math.max(0, this.warmth - (cold * dt - soaked));
    } else {
      this.warmth = Math.min(WARMTH.max, this.warmth + WARMTH.sunPerSec * dt);
    }
    if (this.warmth <= 0) this.health -= WARMTH.freezePerSec * dt;

    // Stink: it only ever goes up, unless it rains or you get in the horse trough.
    this.stink += STINK.perSec * dt;
    if (this.sky.raining) this.stink -= STINK.rainWashPerSec * dt;
    const inTrough = Math.abs(this.player.x - TROUGH.x) < 46 && Math.abs(this.player.y - TROUGH.y) < 22;
    if (inTrough) {
      if (!this.bathing && this.stink > 10) {
        sfx.splash();
        this.say(this.player.x, this.player.y - 24, pick(['Ahh.', 'Bracing.', 'The horses will forgive me.']));
      }
      this.stink -= STINK.troughWashPerSec * dt;
    }
    this.bathing = inTrough;
    this.stink = Phaser.Math.Clamp(this.stink, 0, STINK.max);
  }

  /** How rank the hobo is, from 0 to 1. */
  private get stinkRatio(): number {
    return this.stink / STINK.max;
  }

  private updateStinkLook(): void {
    const ratio = this.stinkRatio;
    this.stinkCloud.setPosition(this.player.x, this.player.y);
    this.stinkCloud.setRadius(18 + ratio * 24);
    this.stinkCloud.setFillStyle(COLORS.stink, ratio * 0.4);
    const buzzing = Math.floor(ratio * this.flies.length + 0.001);
    const t = this.time.now / 1000;
    this.flies.forEach((fly, i) => {
      fly.setVisible(i < buzzing);
      const angle = t * (3 + i * 0.7) + i * 2.1;
      const radius = 16 + (i % 3) * 6 + Math.sin(t * 5 + i) * 3;
      fly.setPosition(this.player.x + Math.cos(angle) * radius, this.player.y - 6 + Math.sin(angle) * radius * 0.6);
    });
  }

  private updateFires(): void {
    const t = this.time.now / 1000;
    const dark = this.sky.darkness;
    this.fires.forEach((fire, i) => {
      const flicker = 0.8 + 0.2 * Math.sin(t * 9 + i * 1.7);
      fire.flame.setScale(1, flicker);
      fire.glow.setFillStyle(COLORS.flame, (0.06 + 0.2 * dark) * flicker);
    });
  }

  // ---------------------------------------------------------------- dumpsters

  /** There is no search button: stand against a dumpster for a moment and in you go. */
  private updateDumpsters(dt: number): void {
    for (const bin of this.dumpsters) {
      if (!bin.full) {
        bin.refillIn -= dt;
        if (bin.refillIn <= 0) {
          bin.full = true;
          bin.rect.setFillStyle(COLORS.dumpster);
        }
        continue;
      }
      const dx = Math.max(Math.abs(this.player.x - bin.rect.x) - bin.rect.width / 2, 0);
      const dy = Math.max(Math.abs(this.player.y - bin.rect.y) - bin.rect.height / 2, 0);
      const against = Math.hypot(dx, dy) < DUMPSTER.reach;
      bin.dwell = against ? bin.dwell + dt : 0;
      bin.progress.setScale(Math.min(bin.dwell / DUMPSTER.diveSec, 1), 1);
      if (bin.dwell >= DUMPSTER.diveSec) this.dive(bin);
    }
  }

  private dive(bin: Dumpster): void {
    bin.full = false;
    bin.dwell = 0;
    bin.refillIn = DUMPSTER.refillSec;
    bin.rect.setFillStyle(COLORS.dumpsterEmpty);
    bin.progress.setScale(0, 1);
    this.stink = Math.min(STINK.max, this.stink + STINK.perDive);
    sfx.rummage();
    this.say(bin.rect.x, bin.rect.y - 40, pick(['Fragrant.', 'Still warm.', 'Somebody threw this out?', 'Jackpot.']));
    // What you find lands on the ground on the side you are standing.
    const below = this.player.y >= bin.rect.y ? 1 : -1;
    for (let i = 0; i < DUMPSTER.loot; i++) {
      const type = Math.random() < DUMPSTER.paperChance ? NEWSPAPER : this.randomItemType();
      const x = bin.rect.x + Phaser.Math.Between(-30, 30);
      const y = bin.rect.y + below * Phaser.Math.Between(48, 64);
      const item = this.placeItem(type, x, y, false);
      item.noPickupUntil = this.time.now + 400; // long enough to see what came out
    }
  }

  // ---------------------------------------------------------------- envy and the Panic

  private get carriedValue(): number {
    return this.sack.reduce((sum, item) => sum + item.value, 0);
  }

  private updateEnvy(dt: number): void {
    if (this.state !== 'calm') return;
    this.envy.update(dt, this.carriedValue);
    this.showHints(this.envy.stage);
    if (this.envy.tripped) this.startPanic();
  }

  /** The only warning the player gets: crows gather on the wire and the light goes flat. */
  private showHints(stage: number): void {
    if (stage === this.shownStage) return;
    this.shownStage = stage;
    const crowCount = ENVY.crows[stage] ?? 0;
    this.crows.forEach((crow, i) => crow.setVisible(i < crowCount));
    this.tweens.add({ targets: this.gloom, fillAlpha: [0, 0, 0.07, 0.16][stage] ?? 0, duration: 1500 });
  }

  private startPanic(): void {
    this.state = 'approach';
    sfx.whistle();
    sfx.footsteps(PANIC.approachSec);
    // The crows know. They leave.
    this.crows.forEach((crow) => crow.setVisible(false));
    for (const t of this.townsfolk) {
      t.rect.setVisible(false);
      bodyOf(t.rect).setVelocity(0, 0);
    }
    this.time.delayedCall((PANIC.approachSec - 3) * 1000, () => this.cameras.main.shake(3000, 0.004));
    this.time.delayedCall(PANIC.approachSec * 1000, () => this.spawnHorde());
  }

  private spawnHorde(): void {
    this.state = 'melee';
    const count = PANIC.firstHorde + PANIC.hordeGrowth * this.stats.panics;
    this.hordeSize = count;
    this.brawling = false;
    this.meleeAge = 0;
    // They arrive in a stream, not all at once, so the brawl keeps getting fed.
    const gapMs = (PANIC.arrivalSec * 1000) / count;
    this.stillToArrive = count;
    for (let i = 0; i < count; i++) this.time.delayedCall(i * gapMs, () => this.spawnHobo());
    this.time.delayedCall(PANIC.meleeSec * 1000, () => this.endPanic());
  }

  private spawnHobo(): void {
    // They come out of the woodwork: any edge of the screen the player is looking at.
    const view = this.cameras.main.worldView;
    const side = Phaser.Math.Between(0, 3);
    const x = side === 0 ? view.left - 40 : side === 1 ? view.right + 40 : Phaser.Math.Between(view.left, view.right);
    const y = side === 2 ? view.top - 40 : side === 3 ? view.bottom + 40 : Phaser.Math.Between(view.top, view.bottom);

    this.stillToArrive--;
    const rect = this.add.rectangle(x, y, 22, 22, COLORS.hobo).setDepth(3);
    this.physics.add.existing(rect);
    this.hoboGroup.add(rect);
    this.hobos.push({
      rect,
      hp: PANIC.hoboHp,
      ko: false,
      fleeing: false,
      speed: PANIC.hoboSpeed * Phaser.Math.FloatBetween(0.8, 1.2),
      cooldown: Math.random(),
      stun: 0,
      thinkIn: 0,
      target: null,
      grudge: null,
      looter: 0,
      lootValue: 0,
      madAtPlayer: 0,
    });
  }

  /** The second whistle: whoever is still standing runs for the train. */
  private endPanic(): void {
    if (this.state !== 'melee') return; // the whistle only blows once
    this.state = 'exit';
    sfx.whistle();
    for (const hobo of this.hobos) hobo.fleeing = !hobo.ko;
    this.time.delayedCall(PANIC.exitSec * 1000, () => {
      for (const hobo of this.hobos) hobo.rect.destroy();
      this.hobos = [];
      this.stats.panics++;
      this.envy.reset();
      this.shownStage = -1;
      this.state = 'calm';
      for (const t of this.townsfolk) t.rect.setVisible(true);
    });
  }

  // ---------------------------------------------------------------- hobos

  private updateHobos(dt: number): void {
    // When the brawl has burned itself out, don't make the player wait for the clock.
    if (this.state === 'melee' && this.stillToArrive <= 0) {
      const standing = this.hobos.reduce((n, hobo) => n + (hobo.ko ? 0 : 1), 0);
      if (standing <= PANIC.lastStanding) this.endPanic();
    }

    // The mob gathers round the player first. Only once it has does it turn on itself.
    if (this.state === 'melee' && !this.brawling) {
      this.meleeAge += dt;
      const gathered = this.hobos.filter((h) => !h.ko && dist(h.rect, this.player) < PANIC.mobRadius);
      if (gathered.length >= this.hordeSize * PANIC.mobShare || this.meleeAge >= PANIC.brawlAfterSec) {
        this.brawling = true;
        const loudmouth = gathered.length > 0 ? pick(gathered) : null;
        if (loudmouth) {
          this.say(loudmouth.rect.x, loudmouth.rect.y - 20, pick(['Quit shovin!', 'I saw him first!', 'That is MY spot!']));
        }
      }
    }

    for (const hobo of this.hobos) {
      if (hobo.ko) continue;
      hobo.cooldown -= dt;
      hobo.stun -= dt;
      hobo.madAtPlayer -= dt;
      if (hobo.looter > 0) {
        hobo.looter -= dt;
        if (hobo.looter <= 0) hobo.rect.setFillStyle(COLORS.hobo);
      }
      if (hobo.stun > 0) continue;

      if (hobo.fleeing) {
        this.moveToward(hobo.rect, TRAIN_EXIT, hobo.speed * 1.5);
        continue;
      }

      hobo.thinkIn -= dt;
      if (hobo.thinkIn <= 0) {
        hobo.thinkIn = 0.35 + Math.random() * 0.2;
        hobo.target = this.pickTarget(hobo);
      }
      this.actOnTarget(hobo);
    }
  }

  private pickTarget(hobo: Hobo): Target {
    // 1. Settle a score with whoever bonked you.
    if (hobo.grudge && !hobo.grudge.ko) return { kind: 'hobo', hobo: hobo.grudge };
    hobo.grudge = null;

    // 2. Dropped food beats everything else.
    let bestItem: GroundItem | null = null;
    let bestDist = 340;
    for (const item of this.items) {
      const d = dist(hobo.rect, item.rect);
      if (item.dropped && d < bestDist) {
        bestItem = item;
        bestDist = d;
      }
    }
    if (bestItem) return { kind: 'item', item: bestItem };

    // 3. A hobo who just grabbed dropped food. Nobody likes a hobo with beans, but before the
    //    brawl starts it takes a real prize, a whole chicken say, to turn the mob on him.
    const looter = this.nearestHobo(
      hobo,
      320,
      (other) => other.looter > 0 && (this.brawling || other.lootValue >= PANIC.prizeValue),
    );
    if (looter) return { kind: 'hobo', hobo: looter };

    // 4. The player: always if he bonked you, otherwise only some of the time and only for his food.
    if (hobo.madAtPlayer > 0) return { kind: 'player' };
    const focus = this.brawling ? PANIC.playerFocus : PANIC.mobFocus;
    if (this.sack.length > 0 && Math.random() < focus) return { kind: 'player' };

    // 5. While the mob is gathering, everyone else crowds in round the player and looms.
    if (!this.brawling) return { kind: 'crowd' };

    // 6. Once the brawl is on, pick a fight with the nearest hobo, or go back to looming.
    const nearest = this.nearestHobo(hobo, Infinity, () => true);
    if (!nearest) return { kind: 'player' };
    return Math.random() < PANIC.brawlChance ? { kind: 'hobo', hobo: nearest } : { kind: 'crowd' };
  }

  private nearestHobo(from: Hobo, within: number, wanted: (other: Hobo) => boolean): Hobo | null {
    let nearest: Hobo | null = null;
    let nearestDist = within;
    for (const other of this.hobos) {
      if (other === from || other.ko || !wanted(other)) continue;
      const d = dist(from.rect, other.rect);
      if (d < nearestDist) {
        nearest = other;
        nearestDist = d;
      }
    }
    return nearest;
  }

  private actOnTarget(hobo: Hobo): void {
    const target = hobo.target;
    if (!target) return;

    if (target.kind === 'item') {
      if (!this.items.includes(target.item)) {
        hobo.target = null;
        return;
      }
      this.moveToward(hobo.rect, target.item.rect, hobo.speed);
      if (dist(hobo.rect, target.item.rect) < 18) {
        this.removeItem(target.item); // gone in one bite
        sfx.munch();
        hobo.looter = PANIC.lootEnvySec;
        hobo.lootValue = target.item.type.value;
        hobo.rect.setFillStyle(COLORS.hoboLooter);
      }
      return;
    }

    if (target.kind === 'crowd') {
      if (dist(hobo.rect, this.player) > PANIC.crowdRing) this.moveToward(hobo.rect, this.player, hobo.speed);
      else bodyOf(hobo.rect).setVelocity(0, 0);
      return;
    }

    const victim = target.kind === 'player' ? this.player : target.hobo.rect;
    this.moveToward(hobo.rect, victim, hobo.speed);
    if (dist(hobo.rect, victim) >= PANIC.hoboReach - 4 || hobo.cooldown > 0) return;

    // A truly rank opponent gives even a hobo pause.
    if (target.kind === 'player' && Math.random() < this.stinkShield) {
      hobo.cooldown = STINK.hesitateSec;
      hobo.stun = STINK.hesitateSec * 0.5;
      this.shove(hobo.rect, this.player, 90);
      if (Math.random() < 0.5) this.say(hobo.rect.x, hobo.rect.y - 20, pick(['Phew!', 'Good LORD.', 'Not that one.']));
      return;
    }
    this.hoboSwing(hobo);
  }

  /** The chance that a hobo about to hit the player thinks better of it. */
  private get stinkShield(): number {
    const over = (this.stink - STINK.hesitateFrom) / (STINK.max - STINK.hesitateFrom);
    return Phaser.Math.Clamp(over, 0, 1) * STINK.hesitateChance;
  }

  /**
   * Once the brawl is on, a hobo's swing hits everyone in reach, friend or not, and that is how
   * it spreads. Before then he is more careful: only the player, or the one hobo he is after.
   */
  private hoboSwing(hobo: Hobo): void {
    hobo.cooldown = PANIC.hoboSwingCooldown * Phaser.Math.FloatBetween(0.8, 1.3);
    if (dist(hobo.rect, this.player) < PANIC.hoboReach) this.hurtPlayer(PANIC.hoboDamage, hobo.rect);
    const aimedAt = hobo.target?.kind === 'hobo' ? hobo.target.hobo : null;
    for (const other of this.hobos) {
      if (other === hobo || other.ko || dist(hobo.rect, other.rect) > PANIC.hoboReach) continue;
      if (!this.brawling && other !== aimedAt) continue;
      this.hitHobo(other, hobo.rect, hobo);
    }
  }

  private hitHobo(victim: Hobo, from: Point, attacker: Hobo | null): void {
    victim.hp--;
    victim.stun = 0.25;
    victim.grudge = attacker;
    if (attacker) victim.target = { kind: 'hobo', hobo: attacker };
    else {
      victim.madAtPlayer = PANIC.madAtPlayerSec;
      victim.target = { kind: 'player' };
    }
    this.shove(victim.rect, from, 260);
    if (victim.hp > 0) return;

    victim.ko = true;
    victim.rect.setFillStyle(COLORS.hoboKo).setDepth(2);
    bodyOf(victim.rect).setVelocity(0, 0);
    bodyOf(victim.rect).enable = false;
    if (!attacker) this.stats.bonked++;
    // A flattened hobo sometimes spills what he was carrying: the aftermath loot.
    if (Math.random() < 0.45) this.placeItem(this.randomItemType(), victim.rect.x, victim.rect.y, false);
  }

  // ---------------------------------------------------------------- townsfolk and the dog

  private updateTownsfolk(dt: number): void {
    for (const t of this.townsfolk) {
      if (!t.rect.visible) continue;
      t.turnIn -= dt;
      if (t.turnIn > 0) continue;
      t.turnIn = Phaser.Math.FloatBetween(1.5, 4);
      const stroll = Phaser.Math.Between(-1, 1) * 45;
      bodyOf(t.rect).setVelocity(stroll, 0);
    }
  }

  /**
   * The shopkeeper paces his shopfront. If a hobo comes onto the property and close enough to
   * notice (and a ripe hobo is noticed from a long way off), out comes the broom.
   */
  private updateKeeper(dt: number): void {
    const keeper = this.keeper;
    const body = bodyOf(keeper.rect);
    keeper.broomIn -= dt;

    // The pie on the sill takes a moment to lift, and a broom in the ribs starts you over.
    if (!this.pieOut) {
      this.pieIn -= dt;
      if (this.pieIn <= 0) {
        this.pieOut = true;
        this.pie.setVisible(true);
      }
    } else {
      const lifting =
        dist(this.player, SILL) < SHOPKEEPER.sillReach && this.sack.length < PLAYER.sackSlots && this.playerStun <= 0;
      this.pieDwell = lifting ? this.pieDwell + dt : 0;
      this.pieBar.setScale(Math.min(this.pieDwell / SHOPKEEPER.liftSec, 1), 1);
      if (this.pieDwell >= SHOPKEEPER.liftSec) {
        this.pieOut = false;
        this.pieDwell = 0;
        this.pieIn = SHOPKEEPER.pieEverySec;
        this.pie.setVisible(false);
        this.pieBar.setScale(0, 1);
        this.sack.push(ITEMS[1]);
        this.envy.add(ITEMS[1].value);
        sfx.pickup();
        this.say(SILL.x, SILL.y - 40, pick(['Still warm.', 'Finders keepers.', 'It was just sitting there.']));
      }
    }

    // When the whistle blows he goes inside and bolts the door.
    if (this.state !== 'calm') {
      keeper.rect.setVisible(false);
      keeper.chasing = 0;
      body.enable = false;
      return;
    }
    if (!keeper.rect.visible) {
      keeper.rect.setVisible(true).setPosition(KEEPER_SHOP_X, KEEPER_WALK_Y);
      body.enable = true;
      body.reset(KEEPER_SHOP_X, KEEPER_WALK_Y);
    }

    const onProperty =
      Math.abs(this.player.x - KEEPER_SHOP_X) < SHOPKEEPER.propertyHalfWidth &&
      this.player.y < SHOPKEEPER.propertyBottom;
    // He sees a long way in front of him and not far behind. He smells in every direction.
    const ahead = (this.player.x - keeper.rect.x) * keeper.dir > 0;
    const notice =
      (ahead ? SHOPKEEPER.noticeAhead : SHOPKEEPER.noticeBehind) + SHOPKEEPER.stinkRadius * this.stinkRatio;
    if (keeper.chasing <= 0 && onProperty && dist(keeper.rect, this.player) < notice) {
      keeper.chasing = SHOPKEEPER.giveUpSec;
      this.say(keeper.rect.x, keeper.rect.y - 24, pick(['GIT!', 'SCRAM!', 'Not in MY doorway!', 'I just swept there!']));
    }

    if (keeper.chasing > 0) {
      keeper.chasing = onProperty ? keeper.chasing - dt : 0;
      this.moveToward(keeper.rect, this.player, SHOPKEEPER.chaseSpeed);
      if (dist(keeper.rect, this.player) < 30 && keeper.broomIn <= 0) {
        keeper.broomIn = 0.5;
        // Swept off the property: away from the shop door, with a stagger. No damage, only dignity.
        this.shove(this.player, { x: KEEPER_SHOP_X, y: SHOP.y }, SHOPKEEPER.shoveSpeed);
        this.playerStun = SHOPKEEPER.staggerSec;
        sfx.shoo();
      }
      return;
    }

    // Back to the shopfront, then up and down it.
    const left = KEEPER_SHOP_X - SHOP.w / 2;
    const right = KEEPER_SHOP_X + SHOP.w / 2;
    const offBeat =
      Math.abs(keeper.rect.y - KEEPER_WALK_Y) > 6 || keeper.rect.x < left - 6 || keeper.rect.x > right + 6;
    if (offBeat) {
      const backTo = { x: Phaser.Math.Clamp(keeper.rect.x, left, right), y: KEEPER_WALK_Y };
      this.moveToward(keeper.rect, backTo, SHOPKEEPER.paceSpeed * 2.5);
      return;
    }
    if (keeper.rect.x <= left) keeper.dir = 1;
    if (keeper.rect.x >= right) keeper.dir = -1;
    body.setVelocity(keeper.dir * SHOPKEEPER.paceSpeed, 0);
  }

  private updateDog(dt: number): void {
    const dog = this.dog;
    dog.stun -= dt;
    dog.biteIn -= dt;
    dog.busy -= dt;
    if (dog.stun > 0) return;
    if (dog.busy > 0) {
      bodyOf(dog.rect).setVelocity(0, 0);
      return;
    }

    // Dropped food distracts him.
    const snack = this.items.find((item) => item.dropped && dist(dog.rect, item.rect) < 170);
    if (snack) {
      this.moveToward(dog.rect, snack.rect, DOG.speed);
      if (dist(dog.rect, snack.rect) < 16) {
        this.removeItem(snack);
        dog.busy = 2.5;
      }
      return;
    }

    const playerInYard = this.player.y > YARD_TOP - 20;
    if (playerInYard && dist(dog.rect, this.player) < DOG.sightRadius) {
      this.moveToward(dog.rect, this.player, DOG.speed);
      if (dist(dog.rect, this.player) < 24 && dog.biteIn <= 0) {
        dog.biteIn = DOG.biteCooldown;
        this.hurtPlayer(DOG.biteDamage, dog.rect);
      }
    } else if (dist(dog.rect, dog.home) > 12) {
      this.moveToward(dog.rect, dog.home, DOG.speed * 0.5);
    } else {
      bodyOf(dog.rect).setVelocity(0, 0);
    }
  }

  // ---------------------------------------------------------------- items

  private updateSpawns(dt: number): void {
    if (this.state !== 'calm') return;
    this.respawnIn -= dt;
    if (this.respawnIn > 0) return;
    this.respawnIn = SPAWN.respawnEverySec;
    if (this.items.length < SPAWN.itemsOnMap) this.spawnItem();
  }

  private randomItemType(): ItemType {
    const total = ITEMS.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of ITEMS) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return ITEMS[0];
  }

  private spawnItem(): void {
    // Below the shop fronts, so nothing lands inside a building.
    const x = Phaser.Math.Between(40, WORLD.w - 40);
    let y = Phaser.Math.Between(210, WORLD.h - 40);
    if (y > 960 && y < 1060) y = 1160; // keep clear of the parked boxcars
    const type = Math.random() < SPAWN.paperChance ? NEWSPAPER : this.randomItemType();
    this.placeItem(type, x, y, false);
  }

  private placeItem(type: ItemType, x: number, y: number, dropped: boolean): GroundItem {
    const size = 10 + type.value / 3;
    const rect = this.add.rectangle(x, y, size, size, type.color).setDepth(2);
    const item: GroundItem = { rect, type, dropped, noPickupUntil: dropped ? this.time.now + 1500 : 0 };
    this.items.push(item);
    return item;
  }

  private removeItem(item: GroundItem): void {
    item.rect.destroy();
    this.items = this.items.filter((other) => other !== item);
  }

  // ---------------------------------------------------------------- helpers

  private moveToward(rect: Rect, to: Point, speed: number): void {
    const angle = Phaser.Math.Angle.Between(rect.x, rect.y, to.x, to.y);
    bodyOf(rect).setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  private shove(rect: Rect, from: Point, speed: number): void {
    const angle = Phaser.Math.Angle.Between(from.x, from.y, rect.x, rect.y);
    bodyOf(rect).setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  /** A few words that float up and fade. Most of the jokes arrive this way. */
  private say(x: number, y: number, words: string): void {
    const text = this.add
      .text(x, y, words, { fontFamily: 'Georgia, serif', fontSize: '16px', fontStyle: 'italic', color: '#f0e6cc' })
      .setOrigin(0.5)
      .setDepth(9);
    this.tweens.add({ targets: text, y: y - 34, alpha: 0, duration: 1500, onComplete: () => text.destroy() });
  }

  private updateHud(): void {
    const bar = (value: number, max: number): string => {
      const filled = Phaser.Math.Clamp(Math.round((value / max) * 10), 0, 10);
      return '#'.repeat(filled) + '-'.repeat(10 - filled);
    };
    const sack = this.sack.map((item) => item.name).join(', ') || 'empty';
    this.hud.setText(
      `Day ${this.sky.day}   Health ${bar(this.health, PLAYER.maxHealth)}   ` +
        `Hunger ${bar(this.hunger, PLAYER.maxHunger)}   Warmth ${bar(this.warmth, WARMTH.max)}` +
        `${this.padding > 0 ? ' +paper' : ''}\nSack ${this.sack.length}/${PLAYER.sackSlots}: ${sack}`,
    );
  }
}
