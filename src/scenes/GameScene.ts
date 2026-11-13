import Phaser from 'phaser';
import { COLORS, DOG, ENVY, ITEMS, PANIC, PLAYER, SPAWN, TOUCH, VIEW, WORLD, type ItemType } from '../config';
import { Envy } from '../envy';
import * as sfx from '../audio';
import { showHome } from '../home';

type Rect = Phaser.GameObjects.Rectangle;
type Body = Phaser.Physics.Arcade.Body;
type Point = { x: number; y: number };

const bodyOf = (rect: Rect): Body => rect.body as Body;
const dist = (a: Point, b: Point): number => Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);

export interface RunStats {
  seconds: number;
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

type Target = { kind: 'player' } | { kind: 'hobo'; hobo: Hobo } | { kind: 'item'; item: GroundItem } | null;

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
  /** While positive, the player bonked him and he remembers. */
  madAtPlayer: number;
}

interface Townsperson {
  rect: Rect;
  turnIn: number;
}

type PanicState = 'calm' | 'approach' | 'melee' | 'exit';

const YARD_TOP = 960;
const STREET_BOTTOM = 330;
const TRAIN_EXIT: Point = { x: WORLD.w + 60, y: 1100 };

export class GameScene extends Phaser.Scene {
  private player!: Rect;
  private health = PLAYER.maxHealth;
  private hunger = PLAYER.maxHunger;
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
  private stats: RunStats = { seconds: 0, panics: 0, bonked: 0, eaten: 0 };

  constructor() {
    super('Game');
  }

  /** Phaser reuses the scene object between runs, so every field is reset here. */
  init(): void {
    this.health = PLAYER.maxHealth;
    this.hunger = PLAYER.maxHunger;
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
    this.stats = { seconds: 0, panics: 0, bonked: 0, eaten: 0 };
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
      const shop = this.add.rectangle(190 + i * 300, 110, 190, 120, COLORS.shop);
      this.walls.add(shop);
    }
    // A few boxcars parked in the yard.
    for (const x of [420, 980, 1500]) {
      const car = this.add.rectangle(x, 1010, 220, 60, COLORS.rail);
      this.walls.add(car);
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

    this.updatePlayer(dt);
    this.updateNeeds(dt);
    this.updateEnvy(dt);
    this.updateTownsfolk(dt);
    this.updateDog(dt);
    this.updateHobos(dt);
    this.updateSpawns(dt);
    this.updateHud();

    if (this.health <= 0) this.scene.start('GameOver', this.stats);
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
      // A full sack is a heavy bindle: each item carried slows you a little.
      const speed = PLAYER.speed * (1 - 0.04 * this.sack.length);
      body.setVelocity((dx / len) * speed, (dy / len) * speed);
    }

    // Pick up whatever you walk over, if the sack has room.
    const now = this.time.now;
    for (const item of [...this.items]) {
      if (this.sack.length >= PLAYER.sackSlots) break;
      if (now < item.noPickupUntil || dist(this.player, item.rect) > 24) continue;
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
    // Eating in private takes the item's value off Envy. Eating where anyone can see adds to it.
    this.envy.add(this.isSeen() ? food.value : -food.value);
  }

  private isSeen(): boolean {
    const near = (rect: Rect): boolean => dist(this.player, rect) < PLAYER.seenRadius;
    return (
      this.townsfolk.some((t) => t.rect.visible && near(t.rect)) || this.hobos.some((h) => !h.ko && near(h.rect))
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

    // 3. A hobo who just grabbed dropped food. Nobody likes a hobo with beans.
    const looter = this.nearestHobo(hobo, 320, (other) => other.looter > 0);
    if (looter) return { kind: 'hobo', hobo: looter };

    // 4. The player: always if he bonked you, otherwise only some of the time and only for his food.
    if (hobo.madAtPlayer > 0) return { kind: 'player' };
    if (this.sack.length > 0 && Math.random() < PANIC.playerFocus) return { kind: 'player' };

    // 5. Otherwise pick a fight with the nearest hobo. The player is the last resort.
    const nearest = this.nearestHobo(hobo, Infinity, () => true);
    return nearest ? { kind: 'hobo', hobo: nearest } : { kind: 'player' };
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
        hobo.rect.setFillStyle(COLORS.hoboLooter);
      }
      return;
    }

    const victim = target.kind === 'player' ? this.player : target.hobo.rect;
    this.moveToward(hobo.rect, victim, hobo.speed);
    if (dist(hobo.rect, victim) < PANIC.hoboReach - 4 && hobo.cooldown <= 0) this.hoboSwing(hobo);
  }

  /** A hobo's swing hits everyone in reach, friend or not. This is how the brawl spreads. */
  private hoboSwing(hobo: Hobo): void {
    hobo.cooldown = PANIC.hoboSwingCooldown * Phaser.Math.FloatBetween(0.8, 1.3);
    if (dist(hobo.rect, this.player) < PANIC.hoboReach) this.hurtPlayer(PANIC.hoboDamage, hobo.rect);
    for (const other of this.hobos) {
      if (other === hobo || other.ko || dist(hobo.rect, other.rect) > PANIC.hoboReach) continue;
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
    this.placeItem(this.randomItemType(), x, y, false);
  }

  private placeItem(type: ItemType, x: number, y: number, dropped: boolean): void {
    const size = 10 + type.value / 3;
    const rect = this.add.rectangle(x, y, size, size, type.color).setDepth(2);
    this.items.push({ rect, type, dropped, noPickupUntil: dropped ? this.time.now + 1500 : 0 });
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

  private updateHud(): void {
    const bar = (value: number, max: number): string => {
      const filled = Phaser.Math.Clamp(Math.round((value / max) * 10), 0, 10);
      return '#'.repeat(filled) + '-'.repeat(10 - filled);
    };
    const sack = this.sack.map((item) => item.name).join(', ') || 'empty';
    this.hud.setText(
      `Health ${bar(this.health, PLAYER.maxHealth)}   Hunger ${bar(this.hunger, PLAYER.maxHunger)}   ` +
        `Sack ${this.sack.length}/${PLAYER.sackSlots}: ${sack}`,
    );
  }
}
