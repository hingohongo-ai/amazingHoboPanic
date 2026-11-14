import Phaser from 'phaser';
import {
  ARMOR,
  COATS,
  COLORS,
  DOG,
  DUMPSTER,
  ENVY,
  GEAR,
  GEAR_FINDS,
  HARMONICA,
  HEALING,
  HINTS,
  ITEMS,
  NEWSPAPER,
  PANIC,
  PLAYER,
  REBAR,
  SACKS,
  SHOPKEEPER,
  SPAWN,
  STAGGER,
  STICKS,
  STINK,
  TOUCH,
  TOWNSFOLK,
  VIEW,
  WARMTH,
  WORLD,
  type Gear,
  type ItemType,
  type Wearable,
  type WearSlot,
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
  /** What finally did it, as a line for the game-over screen. */
  cause: string;
}

/** A stick, sack or coat lying on the ground, with its name written under it. */
interface GroundGear {
  rect: Rect;
  label: Phaser.GameObjects.Text;
  gear: Gear;
  /** True for a piece you just took off, until you step away from it. Stops it going straight back on. */
  underfoot: boolean;
  /** True if it fell out of a flattened hobo. His friends will want a word about that. */
  fromHobo: boolean;
}

interface GroundItem {
  rect: Rect;
  type: ItemType;
  /** Dropped food is what the horde and the dog go for. */
  dropped: boolean;
  noPickupUntil: number;
  /** Gadgets have their name written under them, like gear. */
  label?: Phaser.GameObjects.Text;
  /** True if it fell out of a flattened hobo. */
  fromHobo?: boolean;
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
  /** While positive, there is a harmonica playing and he cannot help himself. */
  dancing: number;
}

interface Townsperson {
  rect: Rect;
  turnIn: number;
  /** Which way along the street he is strolling, in pixels a second. */
  strollX: number;
  /** His own line on main street, where he drifts back to. */
  homeY: number;
  /** Until this runs out he has already said what he thinks of the smell. */
  waveIn: number;
  /** Seconds until he can land another blow in a swarm. */
  hitIn: number;
}

/** A lone hobo at the map's edge, watching. Shy: come close and he is gone. */
interface Watcher {
  rect: Rect;
  /** True while he is off the edge, waiting to turn up somewhere else. */
  out: boolean;
  backIn: number;
  /** Which way is off the map from where he stands. */
  away: Point;
}

type HurtBy = 'bindle' | 'dog' | 'townsfolk';

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
const BOXCAR_XS = [420, 980, 1500];
const BOXCAR_Y = 1010;
/** Where the extra campfire smoke rises, out past the outskirts. */
const SMOKE: Point = { x: WORLD.w - 50, y: 520 };

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

  // The bindle and what you are wearing.
  private stickTier = 0;
  private sackTier = 0;
  private wear: Record<WearSlot, Wearable | null> = { hat: null, coat: null, boots: null };
  /** Empty bean cans kept on a string. They are armor only while the bean-can armor is on. */
  private cans = 0;
  /** Seconds of stagger left: no swinging, and steering only half works. */
  private stagger = 0;
  private gear: GroundGear[] = [];
  private rebar: { rect: Rect; label: Phaser.GameObjects.Text; bar: Rect; dwell: number } | null = null;
  private nagIn = 0;
  private hatRect!: Rect;
  private bootRect!: Rect;
  /** Seconds of tune left to play, and seconds until there is breath for the next. */
  private playing = 0;
  private breathIn = 0;
  private wantPlay = false;
  private wantCheese = false;
  private playButton!: { disc: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text };
  private cheeseButton!: { disc: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text };
  private greetIn = 0;
  /** What you have taken off flattened hobos since the last horde arrived: STICK, COAT and so on. */
  private taken: string[] = [];
  /** What this horde is muttering about, and how long until the next mutter. */
  private mutters: string[] = [];
  private mutterIn = 0;
  /** Set only when a hit, not a slow drain, is what finished the player. */
  private killedBy: HurtBy | null = null;
  /** True while a full belly is mending you. */
  private healing = false;

  // The build-up: what the world does as Envy climbs.
  private watchers: Watcher[] = [];
  private chalk: Phaser.GameObjects.Graphics[] = [];
  private chalkShown = 0;
  private chalkIn = 0;
  private smoke: Phaser.GameObjects.Arc[] = [];
  private smokeOn = false;
  private shutter!: Phaser.GameObjects.Graphics;
  private shuttered = false;
  private farTuneIn = 0;
  private rattleIn = 0;
  private eyesIn = 0;
  private townMutterIn = 0;

  // The townsfolk swarm: too ripe for too long and decent folk take matters into their own hands.
  private ripeFor = 0;
  private swarm: 'none' | 'warn' | 'on' = 'none';
  private swarmIn = 0;
  private swarmTalkIn = 0;
  /** Stops the whole street saying "Pee-yew" in the same second. */
  private townTalkIn = 0;

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
  private stats: RunStats = { seconds: 0, days: 0, panics: 0, bonked: 0, eaten: 0, cause: '' };

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
    this.stats = { seconds: 0, days: 0, panics: 0, bonked: 0, eaten: 0, cause: '' };
    this.stickTier = 0;
    this.sackTier = 0;
    this.wear = { hat: null, coat: null, boots: null };
    this.cans = 0;
    this.stagger = 0;
    this.gear = [];
    this.rebar = null;
    this.nagIn = 0;
    this.playing = 0;
    this.breathIn = 0;
    this.wantPlay = false;
    this.wantCheese = false;
    this.greetIn = 0;
    this.taken = [];
    this.mutters = [];
    this.mutterIn = 0;
    this.killedBy = null;
    this.healing = false;
    this.watchers = [];
    this.chalk = [];
    this.chalkShown = 0;
    this.chalkIn = 0;
    this.smoke = [];
    this.smokeOn = false;
    this.shuttered = false;
    this.farTuneIn = 0;
    this.rattleIn = 0;
    this.eyesIn = 0;
    this.townMutterIn = 0;
    this.ripeFor = 0;
    this.swarm = 'none';
    this.swarmIn = 0;
    this.swarmTalkIn = 0;
    this.townTalkIn = 0;
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

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE,E,Q,F,C') as Record<
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
    // The shutter he pulls down when the town can feel trouble coming. It rolls down over the sill too.
    const shutterH = SHOP.h + 26;
    this.shutter = this.add
      .graphics({ x: KEEPER_SHOP_X - SHOP.w / 2, y: SHOP.y - SHOP.h / 2 })
      .fillStyle(COLORS.shutter)
      .fillRect(0, 0, SHOP.w, shutterH)
      .lineStyle(2, COLORS.rail)
      .strokeRect(0, 0, SHOP.w, shutterH)
      .setDepth(2.2)
      .setScale(1, 0);
    for (let y = 12; y < shutterH; y += 12) this.shutter.lineBetween(0, y, SHOP.w, y); // the slats
    // A few boxcars parked in the yard.
    for (const x of BOXCAR_XS) {
      const car = this.add.rectangle(x, BOXCAR_Y, 220, 60, COLORS.rail);
      this.walls.add(car);
    }

    // Chalk hobo signs, hidden until the High hint stage: on the shopfronts and the boxcars.
    const chalkSpots: Point[] = [];
    for (let i = 0; i < 6; i++) {
      if (i === SHOPKEEPER.shop) continue; // the shutter would cover them
      for (const dx of [-55, 55]) chalkSpots.push({ x: SHOP.firstX + i * SHOP.gap + dx, y: SHOP.y + 25 });
    }
    for (const x of BOXCAR_XS) for (const dx of [-70, 70]) chalkSpots.push({ x: x + dx, y: BOXCAR_Y });
    chalkSpots.forEach((spot, i) => {
      const sign = this.add.graphics({ x: spot.x, y: spot.y }).setDepth(1.5).setAlpha(0).setVisible(false);
      this.drawSign(sign, i);
      this.chalk.push(sign);
    });
    Phaser.Utils.Array.Shuffle(this.chalk);

    // Smoke from campfires that weren't there yesterday.
    for (let i = 0; i < 7; i++) {
      this.smoke.push(this.add.circle(SMOKE.x, SMOKE.y, 12, COLORS.smoke, 1).setDepth(2.5).setVisible(false));
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

    // The rebar: the best stick in town, wedged between the rails right where the dog lives.
    const top = STICKS[STICKS.length - 1];
    this.rebar = {
      rect: this.add.rectangle(REBAR.x, REBAR.y, 6, 30, top.color).setAngle(24).setDepth(2),
      label: this.gearLabel(REBAR.x, REBAR.y + 22, top.name),
      bar: this.add
        .rectangle(REBAR.x - 17, REBAR.y - 26, 34, 5, COLORS.buttonEdge)
        .setOrigin(0, 0.5)
        .setDepth(5)
        .setScale(0, 1),
      dwell: 0,
    };

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

    for (let i = 0; i < TOWNSFOLK.count; i++) {
      const homeY = Phaser.Math.Between(TOWNSFOLK.streetTop, TOWNSFOLK.streetBottom);
      const rect = this.add
        .rectangle(Phaser.Math.Between(80, WORLD.w - 80), homeY, 20, 24, COLORS.townsfolk)
        .setDepth(3);
      this.physics.add.existing(rect);
      bodyOf(rect).setCollideWorldBounds(true);
      this.townsfolk.push({ rect, turnIn: 0, strollX: 0, homeY, waveIn: 0, hitIn: 0 });
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

    // Hat and boots are a block on top of the hobo and a strip under him, until there is real art.
    this.hatRect = this.add.rectangle(0, 0, 16, 8, 0).setDepth(4.1).setVisible(false);
    this.bootRect = this.add.rectangle(0, 0, 26, 5, 0).setDepth(4.1).setVisible(false);

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

    const button = (
      x: number,
      y: number,
      label: string,
      onDown: () => void,
      onUp?: () => void,
    ): { disc: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text } => {
      const disc = this.add.circle(x, y, TOUCH.buttonRadius, COLORS.button, 0.6).setScrollFactor(0).setDepth(10);
      disc.setStrokeStyle(2, COLORS.buttonEdge, 0.8).setInteractive({ useHandCursor: true });
      const text = this.add
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
      return { disc, label: text };
    };
    const right = VIEW.w - 62;
    const low = VIEW.h - 96;
    button(right, low, 'SWING', () => (this.swingHeld = true), () => (this.swingHeld = false));
    button(right - 104, low + 28, 'EAT', () => (this.wantEat = true));
    button(right - 208, low + 28, 'DROP', () => (this.wantDrop = true));
    // These two only show while the thing is in the sack.
    this.playButton = button(right - 104, low - 76, 'PLAY', () => (this.wantPlay = true));
    this.cheeseButton = button(right - 208, low - 76, 'CHEESE', () => (this.wantCheese = true));
    this.showButton(this.playButton, false);
    this.showButton(this.cheeseButton, false);

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

  private showButton(b: { disc: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }, on: boolean): void {
    if (b.disc.visible === on) return;
    b.disc.setVisible(on);
    b.label.setVisible(on);
    if (on) b.disc.setInteractive({ useHandCursor: true });
    else b.disc.disableInteractive();
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
    this.updateGear(dt);
    this.updateEnvy(dt);
    this.updateHints(dt);
    this.updateSwarm(dt);
    this.updateTownsfolk(dt);
    this.updateKeeper(dt);
    this.updateDog(dt);
    this.updateHobos(dt);
    this.updateSpawns(dt);
    this.updateHud();

    if (this.health <= 0) {
      this.stats.days = this.sky.daysSurvived;
      this.stats.cause = this.causeOfDeath();
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
    this.stagger -= dt;
    this.nagIn -= dt;
    this.player.setFillStyle(this.hurtFlash > 0 ? 0xff5040 : COLORS.player);
    // Staggered, the hobo reels. The coat shows as the outline of the rectangle.
    this.player.setAngle(this.stagger > 0 ? Math.sin(this.time.now / 55) * 16 : 0);
    const coat = this.wear.coat;
    if (coat) this.player.setStrokeStyle(4, coat.color);
    else this.player.setStrokeStyle();
    const hat = this.wear.hat;
    const tall = hat?.keeperIgnores ? 16 : 8; // a top hat is a tall hat
    this.hatRect.setVisible(hat !== null).setPosition(this.player.x, this.player.y - 14 - tall / 2);
    if (hat) this.hatRect.setSize(16, tall).setFillStyle(hat.color).setStrokeStyle(1, COLORS.buttonEdge);
    const boots = this.wear.boots;
    this.bootRect.setVisible(boots !== null).setPosition(this.player.x, this.player.y + 15);
    if (boots) this.bootRect.setFillStyle(boots.color).setStrokeStyle(1, COLORS.buttonEdge);
    this.envy.gain = this.worn.reduce((gain, piece) => gain * (piece.envyGain ?? 1), 1);
    this.playing -= dt;
    this.breathIn -= dt;
    this.greetIn -= dt;

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
      const speed = PLAYER.speed * (1 - 0.04 * this.sack.length) * chill * this.wornProduct((piece) => piece.speed);
      if (this.stagger > 0) {
        // Still sliding the way the hit sent him; the feet only half listen.
        const moving = dx !== 0 || dy !== 0;
        const wantX = moving ? (dx / len) * speed * STAGGER.steerShare : 0;
        const wantY = moving ? (dy / len) * speed * STAGGER.steerShare : 0;
        const grip = Math.min(1, STAGGER.grip * dt);
        body.setVelocity(
          body.velocity.x + (wantX - body.velocity.x) * grip,
          body.velocity.y + (wantY - body.velocity.y) * grip,
        );
      } else {
        body.setVelocity((dx / len) * speed, (dy / len) * speed);
      }
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
      if (this.sack.length >= this.sackSlots) continue;
      this.sack.push(item.type);
      this.envy.add(item.type.value);
      if (item.fromHobo) this.taken.push(item.type.gadget === 'harmonica' ? 'HARMONICA' : 'CHEESE');
      this.removeItem(item);
      sfx.pickup();
    }

    if (Phaser.Input.Keyboard.JustDown(k.E) || this.wantEat) this.eat();
    if (Phaser.Input.Keyboard.JustDown(k.Q) || this.wantDrop) this.dropFood();
    if (Phaser.Input.Keyboard.JustDown(k.F) || this.wantPlay) this.playHarmonica();
    if (Phaser.Input.Keyboard.JustDown(k.C) || this.wantCheese) this.unwrapCheese();
    this.wantEat = false;
    this.wantDrop = false;
    this.wantPlay = false;
    this.wantCheese = false;
    this.showButton(this.playButton, this.sack.some((item) => item.gadget === 'harmonica'));
    this.showButton(this.cheeseButton, this.sack.some((item) => item.gadget === 'limburger'));
    this.playButton.disc.setAlpha(this.breathIn > 0 ? 0.35 : 1);
    const handsFree = this.stagger <= 0 && this.playing <= 0;
    if ((k.SPACE.isDown || this.swingHeld) && this.swingIn <= 0 && handsFree) this.swing();
  }

  /** Everything being worn, in no particular order. */
  private get worn(): Wearable[] {
    return [this.wear.hat, this.wear.coat, this.wear.boots].filter((piece): piece is Wearable => piece !== null);
  }

  private wornProduct(of: (piece: Wearable) => number): number {
    return this.worn.reduce((product, piece) => product * of(piece), 1);
  }

  /** A tune no hobo can stand still for. Both hands on the harmonica, so no swinging. */
  private playHarmonica(): void {
    if (!this.sack.some((item) => item.gadget === 'harmonica')) return;
    if (this.breathIn > 0) {
      if (this.nagIn <= 0) {
        this.nagIn = 2;
        this.say(this.player.x, this.player.y - 24, 'Out of puff.');
      }
      return;
    }
    this.breathIn = HARMONICA.cooldownSec;
    this.playing = HARMONICA.danceSec;
    if (this.rebar) this.rebar.dwell = 0;
    sfx.harmonica(HARMONICA.danceSec);
    this.say(this.player.x, this.player.y - 24, 'Toodle-oo, toodle-ay.');
    let first = true;
    for (const hobo of this.hobos) {
      if (hobo.ko || hobo.fleeing || dist(hobo.rect, this.player) > HARMONICA.radius) continue;
      hobo.dancing = HARMONICA.danceSec;
      bodyOf(hobo.rect).setVelocity(0, 0);
      if (first) this.say(hobo.rect.x, hobo.rect.y - 20, pick(['Oh, I LIKE this one.', 'Hot dog!', 'Play it, friend.']));
      first = false;
    }
  }

  /** Limburger: every hobo's last resort. Stink goes straight to the top and the cheese is gone. */
  private unwrapCheese(): void {
    const at = this.sack.findIndex((item) => item.gadget === 'limburger');
    if (at < 0) return;
    const cheese = this.sack.splice(at, 1)[0];
    this.envy.add(-cheese.value);
    this.stink = STINK.max;
    sfx.munch();
    this.say(this.player.x, this.player.y - 24, pick(['Unwrapped.', 'Ripe.', 'May God forgive me.']));
  }

  private get sackSlots(): number {
    return SACKS[this.sackTier].slots;
  }

  /** The share of a bindle hit that what you are wearing takes for you. */
  private get block(): number {
    const worn = this.worn.reduce((sum, piece) => sum + piece.block + (piece.blockPerCan ?? 0) * this.cans, 0);
    const paper = this.padding > 0 ? ARMOR.paperBlock : 0;
    return Math.min(ARMOR.maxBlock, worn + paper);
  }

  /** True, with a grumble, if what you are wearing won't let you bend over. */
  private cantBend(): boolean {
    if (!this.worn.some((piece) => piece.noSearch)) return false;
    if (this.nagIn <= 0) {
      this.nagIn = 3;
      this.say(this.player.x, this.player.y - 24, pick(["Can't bend over in a barrel.", 'The barrel says no.']));
    }
    return true;
  }

  private eat(): void {
    // The newest thing in the sack that is actually food.
    let at = this.sack.length - 1;
    while (at >= 0 && this.sack[at].gadget) at--;
    if (at < 0) return;
    const food = this.sack.splice(at, 1)[0];
    this.hunger = Math.min(PLAYER.maxHunger, this.hunger + food.food);
    this.stats.eaten++;
    sfx.munch();
    if (food.stink) {
      this.stink = Math.min(STINK.max, this.stink + food.stink);
      this.say(this.player.x, this.player.y - 24, pick(['Toot.', 'The musical fruit.', 'Pardon.']));
    }
    // Beans leave an empty can, and a hobo throws nothing away.
    if (food === ITEMS[0] && this.cans < ARMOR.maxCans) {
      this.cans++;
      if (this.wear.coat?.blockPerCan) this.say(this.player.x, this.player.y - 44, 'Clank.');
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

  /** Drops the newest thing in the sack, whatever it is. Only food is a lure. */
  private dropFood(): void {
    const thing = this.sack.pop();
    if (!thing) return;
    this.envy.add(-thing.value);
    const item = this.placeItem(thing, this.player.x, this.player.y, true);
    if (thing.gadget) {
      item.dropped = false; // nobody fights over a harmonica
      item.rect.setStrokeStyle(2, COLORS.buttonEdge);
      item.label = this.gearLabel(item.rect.x, item.rect.y + 18, thing.name);
    }
  }

  private swing(): void {
    const stick = STICKS[this.stickTier];
    if (this.rebar) this.rebar.dwell = 0; // prying takes both hands
    this.swingIn = PLAYER.swingCooldown * (1 + 0.08 * this.sack.length); // heavier bindle, slower swing
    const arc = this.add.circle(this.player.x, this.player.y, stick.reach, 0xffffff, 0.22).setDepth(5);
    arc.setStrokeStyle(2, stick.color, 0.8);
    this.tweens.add({ targets: arc, alpha: 0, duration: 140, onComplete: () => arc.destroy() });

    let hit = false;
    for (const hobo of this.hobos) {
      if (hobo.ko || dist(this.player, hobo.rect) > stick.reach) continue;
      this.hitHobo(hobo, this.player, null, stick.damage, 260 * this.wornProduct((piece) => piece.kick ?? 1));
      hit = true;
    }
    if (dist(this.player, this.dog.rect) <= stick.reach) {
      this.shove(this.dog.rect, this.player, 320);
      this.dog.stun = 0.7;
      hit = true;
    }
    if (hit) sfx.bonk();
  }

  private hurtPlayer(amount: number, from: Point, by: HurtBy, knock = 240): void {
    // A moment of mercy after each hit, so a crowd can't land ten blows in one frame.
    if (this.safeFor > 0 || this.health <= 0) return;
    this.safeFor = PLAYER.mercySec;
    // Coats, cans and newspaper stop bindles. Nothing stops the dog, or decent folk.
    this.health -= by === 'bindle' ? amount * (1 - this.block) : amount;
    if (this.health <= 0) this.killedBy = by;
    this.hurtFlash = 0.12;
    if (this.rebar) this.rebar.dwell = 0;
    sfx.bonk();

    // A man in a barrel stays where he is put.
    if (this.worn.some((piece) => piece.steady)) return;
    this.playerStun = 0.18;
    const surefooted = this.worn.some((piece) => piece.noStagger);
    if (by === 'bindle' && !surefooted && this.stagger <= 0 && Math.random() < STAGGER.chance) {
      this.stagger = Phaser.Math.FloatBetween(STAGGER.minSec, STAGGER.maxSec);
      this.shove(this.player, from, STAGGER.shoveSpeed);
      this.say(this.player.x, this.player.y - 24, pick(['Oof!', 'Stars!', 'Who turned the town?', 'Whoa, Nelly.']));
      return;
    }
    this.shove(this.player, from, knock);
  }

  /** One line for the game-over screen, so the play-tester knows which system did the killing. */
  private causeOfDeath(): string {
    const coat = this.wear.coat;
    if (this.killedBy === 'bindle') {
      if (coat?.steady) return 'Bonked to death inside a barrel. It rang like a bell.';
      if (this.wear.hat?.keeperIgnores) return 'Bonked to death in a top hat and monocle. He was asking for it.';
      return 'Bonked into the hereafter by a fellow hobo.';
    }
    if (this.killedBy === 'dog') return 'Seen off for good by the railyard dog.';
    if (this.killedBy === 'townsfolk') return 'Run out of this world by decent townsfolk. A bath would have saved him.';
    const starving = this.hunger <= 0;
    const freezing = this.warmth <= 0;
    if (starving && freezing) return 'Starved and froze at the same time. Thorough.';
    if (starving) {
      const food = this.sack.filter((item) => !item.gadget);
      if (food.length === 0) return 'Starved, without a bean to his name.';
      const what = food.length === 1 ? `${food[0].name}` : `${food.length} things to eat`;
      return `Starved with ${what} in the sack. He was saving it.`;
    }
    if (freezing) {
      return coat === COATS[0]
        ? 'Froze in a wool coat, which takes some doing.'
        : 'Froze solid. The town has a new statue.';
    }
    return 'Cause of death unknown. Suspect the beans.';
  }

  private updateNeeds(dt: number): void {
    this.hunger = Math.max(0, this.hunger - PLAYER.hungerPerSec * dt);
    if (this.hunger <= 0) this.health -= PLAYER.starvePerSec * dt;
    // A full belly mends you, and the mending eats into it. Not in a Panic: no time to digest.
    this.healing =
      this.state === 'calm' && this.hunger >= HEALING.fullFrom && this.health > 0 && this.health < PLAYER.maxHealth;
    if (this.healing) {
      const mend = Math.min(HEALING.perSec * dt, PLAYER.maxHealth - this.health);
      this.health += mend;
      this.hunger = Math.max(0, this.hunger - mend * HEALING.hungerPerHealth);
    }

    // Warmth: a fire always wins; otherwise night and rain take it and dry daylight gives it back.
    const cold =
      ((this.sky.isNight ? WARMTH.nightPerSec : 0) + (this.sky.raining ? WARMTH.rainPerSec : 0)) *
      this.wornProduct((piece) => piece.cold);
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
      const against = Math.hypot(dx, dy) < DUMPSTER.reach && !this.cantBend();
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
    // Now and then there is something better than food in there.
    const find = Math.random() < GEAR.dumpsterChance ? this.randomGear() : null;
    if (find) this.placeGear(find, bin.rect.x + Phaser.Math.Between(-30, 30), bin.rect.y + below * 82, false, false);
  }

  // ---------------------------------------------------------------- gear

  private gearLabel(x: number, y: number, words: string): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, words, { fontFamily: 'Georgia, serif', fontSize: '12px', fontStyle: 'italic', color: COLORS.gearLabel })
      .setOrigin(0.5)
      .setDepth(2);
  }

  private gearName(gear: Gear): string {
    if (gear.kind === 'item') return gear.item.name;
    return gear.kind === 'stick' ? STICKS[gear.tier].name : gear.kind === 'sack' ? SACKS[gear.tier].name : gear.wear.name;
  }

  private gearColor(gear: Gear): number {
    if (gear.kind === 'item') return gear.item.color;
    return gear.kind === 'stick' ? STICKS[gear.tier].color : gear.kind === 'sack' ? SACKS[gear.tier].color : gear.wear.color;
  }

  /** A piece worth finding: never a stick or sack no better than yours, never the coat on your back. */
  private randomGear(): Gear | null {
    const useful = GEAR_FINDS.filter(({ gear }) =>
      gear.kind === 'stick'
        ? gear.tier > this.stickTier
        : gear.kind === 'sack'
          ? gear.tier > this.sackTier
          : gear.kind === 'item'
            ? !this.sack.includes(gear.item)
            : this.wear[gear.wear.slot] !== gear.wear,
    );
    let roll = Math.random() * useful.reduce((sum, find) => sum + find.weight, 0);
    for (const find of useful) {
      roll -= find.weight;
      if (roll <= 0) return find.gear;
    }
    return null;
  }

  private placeGear(gear: Gear, x: number, y: number, underfoot: boolean, fromHobo: boolean): void {
    // A harmonica or a cheese goes in the sack, so on the ground it is an item like food, with a name.
    if (gear.kind === 'item') {
      const item = this.placeItem(gear.item, x, y, false);
      item.rect.setStrokeStyle(2, COLORS.buttonEdge);
      item.label = this.gearLabel(x, y + 18, gear.item.name);
      item.fromHobo = fromHobo;
      return;
    }
    // Sticks are long and thin; everything else is a square with an outline, to tell it from food.
    const rect =
      gear.kind === 'stick'
        ? this.add.rectangle(x, y, 6, 28, this.gearColor(gear)).setAngle(60)
        : this.add.rectangle(x, y, 18, 18, this.gearColor(gear)).setStrokeStyle(2, COLORS.buttonEdge);
    rect.setDepth(2);
    this.gear.push({ rect, label: this.gearLabel(x, y + 20, this.gearName(gear)), gear, underfoot, fromHobo });
  }

  private updateGear(dt: number): void {
    for (const piece of [...this.gear]) {
      const d = dist(this.player, piece.rect);
      if (piece.underfoot) {
        if (d > GEAR.stepOffRadius) piece.underfoot = false;
        continue;
      }
      if (d > GEAR.pickupRadius || !this.takeGear(piece.gear)) continue;
      if (piece.fromHobo) {
        const gear = piece.gear;
        if (gear.kind === 'stick') this.taken.push('STICK');
        else if (gear.kind === 'sack') this.taken.push('SACK');
        else if (gear.kind === 'wear') this.taken.push(gear.wear.muttered ?? gear.wear.slot.toUpperCase());
      }
      piece.rect.destroy();
      piece.label.destroy();
      this.gear = this.gear.filter((other) => other !== piece);
      sfx.pickup();
    }

    // Prying the rebar out of the track takes a while, and the dog has opinions.
    const rebar = this.rebar;
    if (!rebar) return;
    const still = bodyOf(this.player).velocity.length() < 20;
    const prying = dist(this.player, rebar.rect) < REBAR.reach && still && this.playerStun <= 0 && !this.cantBend();
    rebar.dwell = prying ? rebar.dwell + dt : 0;
    rebar.bar.setScale(Math.min(rebar.dwell / REBAR.prySec, 1), 1);
    if (rebar.dwell < REBAR.prySec) return;
    rebar.rect.destroy();
    rebar.label.destroy();
    rebar.bar.destroy();
    this.rebar = null;
    this.takeGear({ kind: 'stick', tier: STICKS.length - 1 });
    sfx.pickup();
  }

  /** Puts a piece of gear to use. False if it is no better than what you have. */
  private takeGear(gear: Gear): boolean {
    const { x, y } = this.player;
    if (gear.kind === 'stick') {
      if (gear.tier <= this.stickTier) return false;
      this.placeGear({ kind: 'stick', tier: this.stickTier }, x, y, true, false);
      this.stickTier = gear.tier;
      this.envy.add(STICKS[gear.tier].envy);
      this.say(x, y - 24, gear.tier === STICKS.length - 1 ? 'Now THAT is a stick.' : 'A finer stick.');
      return true;
    }
    if (gear.kind === 'sack') {
      if (gear.tier <= this.sackTier) return false;
      this.placeGear({ kind: 'sack', tier: this.sackTier }, x, y, true, false);
      this.sackTier = gear.tier;
      this.envy.add(SACKS[gear.tier].envy);
      this.say(x, y - 24, 'Room for more.');
      return true;
    }
    if (gear.kind === 'item') return false; // sack items are picked up as items, not here
    const old = this.wear[gear.wear.slot];
    if (old === gear.wear) return false;
    if (old) this.placeGear({ kind: 'wear', wear: old }, x, y, true, false);
    this.wear[gear.wear.slot] = gear.wear;
    this.envy.add(gear.wear.envy);
    const w = gear.wear;
    this.say(
      x,
      y - 24,
      w.steady ? 'Snug.' : w.blockPerCan ? 'Clank.' : w.keeperIgnores ? 'I say.' : w.slot === 'hat' ? 'Bong.' : 'Fits like it was stolen.',
    );
    return true;
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

  /**
   * The only warning the player gets. Each stage keeps what the one below it switched on.
   * Rising: crows and a far-off harmonica. High: watchers, chalk signs and smoke.
   * Critical: rattling bins, eyes in the boxcars, muttering townsfolk and the shutter.
   */
  private showHints(stage: number): void {
    if (stage === this.shownStage) return;
    const was = this.shownStage;
    this.shownStage = stage;
    const crowCount = ENVY.crows[stage] ?? 0;
    this.crows.forEach((crow, i) => crow.setVisible(i < crowCount));
    this.tweens.add({ targets: this.gloom, fillAlpha: [0, 0, 0.07, 0.16][stage] ?? 0, duration: 1500 });

    if (stage >= 1 && was < 1) this.farTuneIn = Phaser.Math.FloatBetween(3, 8);
    if (stage >= 2 && was < 2) {
      this.spawnWatchers();
      this.chalkIn = 0.5;
      this.setSmoke(true);
    }
    if (stage < 2 && was >= 2) this.clearHighHints();
    if (stage >= 3 && was < 3) {
      this.setShutter(true);
      this.rattleIn = 2;
      this.eyesIn = 1.5;
      this.townMutterIn = 1;
    }
    if (stage < 3 && this.shuttered) this.setShutter(false);
  }

  private updateHints(dt: number): void {
    if (this.state !== 'calm') return;
    const stage = this.shownStage;

    if (stage >= 1) {
      this.farTuneIn -= dt;
      if (this.farTuneIn <= 0) {
        this.farTuneIn = Phaser.Math.FloatBetween(HINTS.farTuneMinSec, HINTS.farTuneMaxSec);
        sfx.harmonica(HINTS.farTuneSec, true);
        this.farNote();
      }
    }

    if (stage >= 2) {
      for (const w of this.watchers) {
        if (w.out) {
          w.backIn -= dt;
          if (w.backIn <= 0) this.placeWatcher(w);
          continue;
        }
        w.rect.setAngle(Math.sin(this.time.now / 700 + w.rect.x) * 4);
        if (dist(w.rect, this.player) < HINTS.watcherShyRadius) this.duckWatcher(w);
      }
      this.chalkIn -= dt;
      if (this.chalkIn <= 0 && this.chalkShown < Math.min(HINTS.chalkSigns, this.chalk.length)) {
        this.chalkIn = HINTS.chalkEverySec;
        const sign = this.chalk[this.chalkShown++];
        sign.setVisible(true).setAlpha(0);
        this.tweens.add({ targets: sign, alpha: 0.85, duration: 1200 });
      }
    }

    if (stage >= 3) {
      this.rattleIn -= dt;
      if (this.rattleIn <= 0) {
        this.rattleIn = Phaser.Math.FloatBetween(HINTS.rattleMinSec, HINTS.rattleMaxSec);
        this.rattleBin(pick(this.dumpsters));
      }
      this.eyesIn -= dt;
      if (this.eyesIn <= 0) {
        this.eyesIn = Phaser.Math.FloatBetween(HINTS.eyesMinSec, HINTS.eyesMaxSec);
        this.blinkEyes();
      }
      this.townMutterIn -= dt;
      if (this.townMutterIn <= 0) {
        this.townMutterIn = Phaser.Math.FloatBetween(HINTS.townMutterMinSec, HINTS.townMutterMaxSec);
        const near = this.townsfolk.filter((t) => t.rect.visible && dist(t.rect, this.player) < 520);
        if (near.length > 0 && this.swarm === 'none') {
          const t = pick(near);
          this.say(
            t.rect.x,
            t.rect.y - 22,
            pick(['drifters...', 'lock up, Martha', 'more of em every day...', "I don't like it", 'bolt the door, Harold']),
          );
        }
      }
    }
  }

  /** The far-off harmonica, for anyone playing with the sound off: a note drifting in at the screen's edge. */
  private farNote(): void {
    const x = pick([28, VIEW.w - 28]);
    const y = Phaser.Math.Between(90, 220);
    const note = this.add
      .text(x, y, '♪', { fontFamily: 'Georgia, serif', fontSize: '18px', color: '#f0e6cc' })
      .setOrigin(0.5)
      .setAlpha(0.55)
      .setScrollFactor(0)
      .setDepth(9);
    this.tweens.add({ targets: note, y: y - 40, alpha: 0, duration: HINTS.farTuneSec * 1000, onComplete: () => note.destroy() });
  }

  private spawnWatchers(): void {
    for (let i = 0; i < HINTS.watchers; i++) {
      const rect = this.add.rectangle(0, 0, 22, 22, COLORS.hobo).setDepth(3).setVisible(false);
      // They turn up one at a time, a moment apart.
      this.watchers.push({ rect, out: true, backIn: 0.3 + i * 2, away: { x: 0, y: 1 } });
    }
  }

  /** Somewhere on the left, right or bottom edge of the map, close enough to be seen, not close enough to talk to. */
  private placeWatcher(w: Watcher): void {
    const edgeSpot = (): Point => {
      const side = Phaser.Math.Between(0, 2);
      if (side === 0) return { x: 14, y: Phaser.Math.Between(360, 920) };
      if (side === 1) return { x: WORLD.w - 14, y: Phaser.Math.Between(360, 920) };
      return { x: Phaser.Math.Between(80, WORLD.w - 80), y: WORLD.h - 14 };
    };
    let spot = edgeSpot();
    for (let tries = 0; tries < 12; tries++) {
      const d = dist(spot, this.player);
      if (d > HINTS.watcherShyRadius + 60 && d < 750) break;
      spot = edgeSpot();
    }
    if (dist(spot, this.player) < HINTS.watcherShyRadius + 20) {
      w.backIn = 2; // nowhere good to stand; try again in a moment
      return;
    }
    w.away = spot.x < 30 ? { x: -1, y: 0 } : spot.x > WORLD.w - 30 ? { x: 1, y: 0 } : { x: 0, y: 1 };
    w.out = false;
    w.rect.setPosition(spot.x, spot.y).setVisible(true).setAlpha(0).setAngle(0);
    this.tweens.add({ targets: w.rect, alpha: 1, duration: 800 });
  }

  private duckWatcher(w: Watcher): void {
    w.out = true;
    w.backIn = Phaser.Math.FloatBetween(HINTS.watcherBackMinSec, HINTS.watcherBackMaxSec);
    this.tweens.killTweensOf(w.rect);
    this.tweens.add({
      targets: w.rect,
      x: w.rect.x + w.away.x * 40,
      y: w.rect.y + w.away.y * 40,
      alpha: 0,
      duration: 350,
      onComplete: () => w.rect.setVisible(false),
    });
  }

  /** Watchers gone, chalk washed off, the smoke dies down. */
  private clearHighHints(): void {
    for (const w of this.watchers) {
      this.tweens.killTweensOf(w.rect);
      w.rect.destroy();
    }
    this.watchers = [];
    for (const sign of this.chalk) {
      this.tweens.killTweensOf(sign);
      sign.setVisible(false).setAlpha(0);
    }
    this.chalkShown = 0;
    Phaser.Utils.Array.Shuffle(this.chalk);
    this.setSmoke(false);
  }

  /** A handful of real hobo signs, near enough, in chalk. */
  private drawSign(g: Phaser.GameObjects.Graphics, kind: number): void {
    g.lineStyle(2, COLORS.chalk, 1);
    switch (kind % 5) {
      case 0: // a circle with a cross: good for a handout
        g.strokeCircle(0, 0, 8);
        g.lineBetween(-6, -6, 6, 6);
        g.lineBetween(-6, 6, 6, -6);
        break;
      case 1: // a triangle: watch yourself
        g.strokeTriangle(-8, 7, 8, 7, 0, -8);
        break;
      case 2: // a zigzag: a dog that bites
        g.beginPath();
        g.moveTo(-10, 4);
        g.lineTo(-5, -5);
        g.lineTo(0, 4);
        g.lineTo(5, -5);
        g.lineTo(10, 4);
        g.strokePath();
        break;
      case 3: // a top hat: a rich man lives here
        g.strokeRect(-5, -10, 10, 10);
        g.lineBetween(-10, 0, 10, 0);
        break;
      default: // two lines and a circle: there are a lot of us about
        g.lineBetween(-9, -3, 9, -3);
        g.lineBetween(-9, 4, 9, 4);
        g.strokeCircle(0, -10, 3);
    }
  }

  private setSmoke(on: boolean): void {
    if (on === this.smokeOn) return;
    this.smokeOn = on;
    this.smoke.forEach((puff, i) => {
      this.tweens.killTweensOf(puff);
      puff.setVisible(on);
      if (!on) return;
      puff.setPosition(SMOKE.x, SMOKE.y).setAlpha(0).setScale(0.6);
      this.tweens.add({
        targets: puff,
        x: SMOKE.x + 24,
        y: SMOKE.y - 170,
        alpha: { from: 0.45, to: 0 },
        scale: { from: 0.6, to: 1.8 },
        duration: 3200,
        delay: i * 460,
        repeat: -1,
      });
    });
  }

  /** The shopkeeper shuts up shop: no pie until the trouble has been and gone. */
  private setShutter(down: boolean): void {
    if (down === this.shuttered) return;
    this.shuttered = down;
    this.tweens.killTweensOf(this.shutter);
    this.tweens.add({
      targets: this.shutter,
      scaleY: down ? 1 : 0,
      duration: down ? 900 : 1200,
      ease: down ? 'Bounce.easeOut' : 'Sine.easeInOut',
    });
    if (!down) return;
    sfx.rattle();
    if (this.keeper.rect.visible) {
      this.say(this.keeper.rect.x, this.keeper.rect.y - 24, pick(["We're CLOSED.", 'Not today.', 'Lock up, lock up!']));
    }
  }

  /** Something in that dumpster, and it isn't you. */
  private rattleBin(bin: Dumpster): void {
    const x = bin.rect.x;
    this.tweens.add({
      targets: bin.rect,
      x: x + 3,
      duration: 45,
      yoyo: true,
      repeat: 4,
      onComplete: () => bin.rect.setX(x),
    });
    if (dist(bin.rect, this.player) < 700) sfx.rattle();
  }

  /** Two eyes in a dark boxcar doorway. They blink once and they're gone. */
  private blinkEyes(): void {
    const x = pick(BOXCAR_XS) + Phaser.Math.Between(-80, 80);
    const y = BOXCAR_Y - 4;
    // Above the night tint, like the fires, so they show best after dark.
    const eyes = [-5, 5].map((dx) => this.add.rectangle(x + dx, y, 4, 3, COLORS.eyes).setDepth(7.6));
    this.time.delayedCall(700, () => eyes.forEach((e) => e.setAlpha(0)));
    this.time.delayedCall(820, () => eyes.forEach((e) => e.setAlpha(1)));
    this.time.delayedCall(1500, () => eyes.forEach((e) => e.destroy()));
  }

  private startPanic(): void {
    this.state = 'approach';
    sfx.whistle();
    sfx.footsteps(PANIC.approachSec);
    // The crows know. They leave. So does everyone else; only the shutter stays down.
    this.crows.forEach((crow) => crow.setVisible(false));
    this.clearHighHints();
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
    // Word gets round. This horde knows what you took off the last one; what you take off
    // this one is for the next.
    this.mutters = this.taken;
    this.taken = [];
    this.mutterIn = PANIC.mutterMaxSec;
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
      dancing: 0,
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

    if (this.state === 'melee' && this.mutters.length > 0) {
      this.mutterIn -= dt;
      if (this.mutterIn <= 0) {
        this.mutterIn = Phaser.Math.FloatBetween(PANIC.mutterMinSec, PANIC.mutterMaxSec);
        const near = this.hobos.filter((h) => !h.ko && dist(h.rect, this.player) < PANIC.mutterRadius);
        if (near.length > 0) {
          const hobo = pick(near);
          const what = pick(this.mutters);
          const line = pick([`...took muh ${what}`, `...that's muh ${what}`, `...muh ${what}...`, `...gimme back muh ${what}`]);
          this.say(hobo.rect.x, hobo.rect.y - 20, line);
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
      if (hobo.dancing > 0 && !hobo.fleeing) {
        // He cannot help it. A little jig on the spot until the tune stops.
        hobo.dancing -= dt;
        hobo.rect.setAngle(hobo.dancing > 0 ? Math.sin(this.time.now / 90 + hobo.speed) * 22 : 0);
        if (hobo.stun <= 0) bodyOf(hobo.rect).setVelocity(Math.sin(this.time.now / 180 + hobo.speed) * 40, 0);
        continue;
      }
      if (hobo.stun > 0) continue;

      if (hobo.fleeing) {
        hobo.rect.setAngle(0);
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
    //    A top hat changes that: he is the first man anyone looks at, food or no food.
    const dandy = Math.max(0, ...this.worn.map((piece) => piece.hoboFocus ?? 0));
    const focus = Math.max(this.brawling ? PANIC.playerFocus : PANIC.mobFocus, dandy);
    if ((this.sack.length > 0 || dandy > 0) && Math.random() < focus) return { kind: 'player' };

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
    if (dist(hobo.rect, this.player) < PANIC.hoboReach) this.hurtPlayer(PANIC.hoboDamage, hobo.rect, 'bindle');
    const aimedAt = hobo.target?.kind === 'hobo' ? hobo.target.hobo : null;
    for (const other of this.hobos) {
      if (other === hobo || other.ko || dist(hobo.rect, other.rect) > PANIC.hoboReach) continue;
      if (!this.brawling && other !== aimedAt) continue;
      this.hitHobo(other, hobo.rect, hobo, 1);
    }
  }

  private hitHobo(victim: Hobo, from: Point, attacker: Hobo | null, damage: number, shove = 260): void {
    victim.hp -= damage;
    victim.stun = 0.25;
    victim.grudge = attacker;
    if (attacker) victim.target = { kind: 'hobo', hobo: attacker };
    else {
      victim.madAtPlayer = PANIC.madAtPlayerSec;
      victim.target = { kind: 'player' };
    }
    this.shove(victim.rect, from, shove);
    if (victim.hp > 0) return;

    victim.ko = true;
    victim.rect.setFillStyle(COLORS.hoboKo).setDepth(2).setAngle(0);
    bodyOf(victim.rect).setVelocity(0, 0);
    bodyOf(victim.rect).enable = false;
    if (!attacker) this.stats.bonked++;
    // A flattened hobo sometimes spills what he was carrying: the aftermath loot.
    if (Math.random() < 0.45) this.placeItem(this.randomItemType(), victim.rect.x, victim.rect.y, false);
    // Now and then it is something he was wearing.
    const find = Math.random() < GEAR.hoboDropChance ? this.randomGear() : null;
    if (find) this.placeGear(find, victim.rect.x + 22, victim.rect.y, false, true);
  }

  // ---------------------------------------------------------------- townsfolk and the dog

  /**
   * Townsfolk stroll their stretch of main street. A ripe hobo makes them step back, a very ripe one
   * gets told so, and at the Critical hint stage they edge up to the shopfronts. In a swarm they
   * come for you.
   */
  private updateTownsfolk(dt: number): void {
    this.townTalkIn -= dt;
    const stage = this.state === 'calm' ? this.shownStage : 0;
    const over = Phaser.Math.Clamp((this.stink - TOWNSFOLK.recoilFrom) / (STINK.max - TOWNSFOLK.recoilFrom), 0, 1);
    const recoil = this.stink >= TOWNSFOLK.recoilFrom ? TOWNSFOLK.recoilMin + (TOWNSFOLK.recoilMax - TOWNSFOLK.recoilMin) * over : 0;
    const top = Math.min(TOWNSFOLK.streetTop, HINTS.townHuddleY);
    // In a swarm they come at you from the side away from the trough, and drive you into it.
    const toTrough = Phaser.Math.Angle.Between(this.player.x, this.player.y, TROUGH.x, TROUGH.y);
    const behind: Point = {
      x: this.player.x - Math.cos(toTrough) * 16,
      y: this.player.y - Math.sin(toTrough) * 16,
    };
    let pushers = 0;

    for (const t of this.townsfolk) {
      if (!t.rect.visible) continue;
      const body = bodyOf(t.rect);
      t.turnIn -= dt;
      t.waveIn -= dt;
      t.hitIn -= dt;
      const d = dist(t.rect, this.player);

      if (this.swarm === 'on') {
        this.moveToward(t.rect, d > 60 ? this.player : behind, TOWNSFOLK.swarmSpeed);
        if (d < TOWNSFOLK.pushReach) pushers++;
        // In the trough they stop hitting and hold him there: a blow could knock him out of the water.
        if (d < TOWNSFOLK.swarmReach && t.hitIn <= 0 && !this.bathing) {
          t.hitIn = TOWNSFOLK.swarmHitEverySec;
          // The blow lands from behind, so it knocks you trough-ward whichever side he is on.
          this.hurtPlayer(TOWNSFOLK.swarmDamage, behind, 'townsfolk', TOWNSFOLK.hitShove);
        }
        continue;
      }
      if (this.swarm === 'warn') {
        body.setVelocity(0, 0); // they stop and stare
        continue;
      }

      if (d < recoil) {
        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, t.rect.x, t.rect.y);
        let vy = Math.sin(angle) * TOWNSFOLK.recoilSpeed;
        // Back away along the street; don't wander off it.
        if ((t.rect.y <= top && vy < 0) || (t.rect.y >= TOWNSFOLK.streetBottom && vy > 0)) vy = 0;
        body.setVelocity(Math.cos(angle) * TOWNSFOLK.recoilSpeed, vy);
        t.turnIn = 0.4;
        if (this.stink >= TOWNSFOLK.waveOffFrom && t.waveIn <= 0 && this.townTalkIn <= 0) {
          t.waveIn = TOWNSFOLK.waveOffEverySec;
          this.townTalkIn = 1.5;
          this.say(t.rect.x, t.rect.y - 22, pick(['Pee-yew!', 'Shoo!', 'Mercy, the SMELL.', 'Mind the children.']));
        }
        continue;
      }

      if (t.turnIn <= 0) {
        t.turnIn = Phaser.Math.FloatBetween(1.5, 4);
        t.strollX = Phaser.Math.Between(-1, 1) * TOWNSFOLK.strollSpeed;
      }
      // Drift back to his own line, or, when trouble is close, up to the shopfronts.
      const wantY = stage >= 3 ? HINTS.townHuddleY : t.homeY;
      const dy = wantY - t.rect.y;
      const far = Math.abs(dy) > 60; // after a swarm he could be anywhere
      const vy = Math.abs(dy) < 3 ? 0 : Math.sign(dy) * Math.min(TOWNSFOLK.strollSpeed * (far ? 2.5 : 1), Math.abs(dy) * 2);
      body.setVelocity(far ? 0 : t.strollX, vy);
    }

    // The bum's rush: hands on your back, on top of whatever your feet are doing.
    // (Not while he is reeling from a blow: the blow itself is already sending him that way.)
    // Once he is in, they hold him near the middle of the trough rather than shove him through it.
    const offCentre = dist(this.player, TROUGH);
    if (pushers > 0 && this.playerStun <= 0 && offCentre > 6) {
      const push = Math.min(TOWNSFOLK.pushMax, pushers * TOWNSFOLK.pushSpeed, this.bathing ? offCentre * 8 : Infinity);
      const body = bodyOf(this.player);
      body.setVelocity(body.velocity.x + Math.cos(toTrough) * push, body.velocity.y + Math.sin(toTrough) * push);
      if (this.nagIn <= 0 && !this.bathing) {
        this.nagIn = 2.5;
        this.say(this.player.x, this.player.y - 24, pick(['Hey! HEY!', 'I can walk!', 'Unhand me!', 'Not the trough!']));
      }
    }
  }

  /** Full Stink for too long and the town loses patience. Only the horse trough calls them off. */
  private updateSwarm(dt: number): void {
    if (this.state !== 'calm') {
      this.swarm = 'none'; // a Panic sends everyone indoors
      this.ripeFor = 0;
      return;
    }
    this.swarmTalkIn -= dt;
    if (this.swarm === 'none') {
      this.ripeFor = this.stink >= STINK.max - 0.01 ? this.ripeFor + dt : 0;
      if (this.ripeFor >= TOWNSFOLK.swarmFuseSec) {
        this.swarm = 'warn';
        this.swarmIn = TOWNSFOLK.swarmWarnSec;
        this.townShout(pick(['SOMEBODY FETCH A BUCKET!', 'THAT DOES IT!', 'I can SMELL him from here!']));
      }
      return;
    }
    // They don't let go until he is clean. Not cleaner: clean.
    if (this.stink <= 0) {
      this.swarm = 'none';
      this.ripeFor = 0;
      this.townShout(pick(['And STAY clean!', 'That will do.', 'Much obliged.']));
      return;
    }
    if (this.swarm === 'warn') {
      this.swarmIn -= dt;
      if (this.swarmIn <= 0) {
        this.swarm = 'on';
        this.swarmTalkIn = 2.5;
        this.townShout(pick(['GET HIM!', 'RUN HIM OUT!', 'INTO THE TROUGH WITH HIM!']));
      }
      return;
    }
    if (this.swarmTalkIn <= 0) {
      this.swarmTalkIn = Phaser.Math.FloatBetween(this.bathing ? 0.8 : 2, this.bathing ? 1.4 : 4);
      this.townShout(
        this.bathing
          ? pick(['SCRUB!', 'Behind the ears!', 'Again!', 'Hold him under!', 'Not done yet!'])
          : pick(['Filthy!', 'Get in the trough!', 'Not on MY street!', 'Somebody hold my nose!', 'Phew!']),
      );
    }
  }

  /**
   * A shout from the nearest townsperson. If he is off screen the words still show, at the
   * edge of the screen on his side, so the player knows trouble is coming and from where.
   */
  private townShout(words: string): void {
    const shown = this.townsfolk.filter((t) => t.rect.visible);
    if (shown.length === 0) return;
    const t = shown.reduce((a, b) => (dist(a.rect, this.player) <= dist(b.rect, this.player) ? a : b));
    const view = this.cameras.main.worldView;
    const x = Phaser.Math.Clamp(t.rect.x, view.left + 110, view.right - 110);
    const y = Phaser.Math.Clamp(t.rect.y - 24, view.top + 90, view.bottom - 40);
    this.say(x, y, words);
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
    // Behind the shutter it can't be got at, and no new one goes out.
    if (this.shuttered) {
      this.pieDwell = 0;
      this.pieBar.setScale(0, 1);
    } else if (!this.pieOut) {
      this.pieIn -= dt;
      if (this.pieIn <= 0) {
        this.pieOut = true;
        this.pie.setVisible(true);
      }
    } else {
      const atSill = dist(this.player, SILL) < SHOPKEEPER.sillReach;
      const lifting = atSill && this.sack.length < this.sackSlots && this.playerStun <= 0 && !this.cantBend();
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

    // When the whistle blows, or the shutter comes down, he goes inside and bolts the door.
    if (this.state !== 'calm' || this.shuttered) {
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
      (ahead ? SHOPKEEPER.noticeAhead : SHOPKEEPER.noticeBehind) +
      SHOPKEEPER.stinkRadius * this.stinkRatio +
      this.worn.reduce((sum, piece) => sum + (piece.keeperNotice ?? 0), 0);
    const noticed = onProperty && dist(keeper.rect, this.player) < notice;
    // A top hat and monocle: clearly a gentleman, whatever the smell.
    if (noticed && this.worn.some((piece) => piece.keeperIgnores)) {
      keeper.chasing = 0;
      if (this.greetIn <= 0) {
        this.greetIn = 8;
        this.say(keeper.rect.x, keeper.rect.y - 24, pick(['Good day, sir.', 'Lovely weather, sir.', 'Do come again, sir.']));
      }
    } else if (keeper.chasing <= 0 && noticed) {
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
    // Clanking carries: some coats let him notice you from further off.
    const notice = DOG.sightRadius * this.wornProduct((piece) => piece.dogNotice);
    if (playerInYard && dist(dog.rect, this.player) < notice) {
      this.moveToward(dog.rect, this.player, DOG.speed);
      if (dist(dog.rect, this.player) < 24 && dog.biteIn <= 0) {
        dog.biteIn = DOG.biteCooldown;
        this.hurtPlayer(DOG.biteDamage, dog.rect, 'dog');
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
    item.label?.destroy();
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
    const worn = this.wear.coat;
    const coat = !worn ? 'none' : worn.blockPerCan ? `${worn.name} (${this.cans} cans)` : worn.name;
    this.hud.setText(
      `Day ${this.sky.day}   Health ${bar(this.health, PLAYER.maxHealth)}${this.healing ? ' +mending' : ''}   ` +
        `Hunger ${bar(this.hunger, PLAYER.maxHunger)}   Warmth ${bar(this.warmth, WARMTH.max)}` +
        `${this.padding > 0 ? ' +paper' : ''}\n` +
        `Sack (${SACKS[this.sackTier].name}) ${this.sack.length}/${this.sackSlots}: ${sack}\n` +
        `Stick ${STICKS[this.stickTier].name}   Coat ${coat}   ` +
        `Hat ${this.wear.hat?.name ?? 'none'}   Boots ${this.wear.boots?.name ?? 'none'}` +
        `${this.stagger > 0 ? '   SEEING STARS' : ''}`,
    );
  }
}
