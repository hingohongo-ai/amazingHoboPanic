import Phaser from 'phaser';
import { DAY, RAIN, VIEW } from './config';
import * as sfx from './audio';

/**
 * The clock and the weather: day turning to night, and the occasional shower.
 * It only keeps time and draws; what cold and wet do to the hobo is the game scene's business.
 */
export class Sky {
  private seconds = 0;
  private rainFor = 0;
  private nextRainIn = Sky.rollGap();
  private shade: Phaser.GameObjects.Rectangle;
  private drops: Phaser.GameObjects.Rectangle[] = [];

  constructor(scene: Phaser.Scene) {
    // Night is one translucent rectangle pinned over the whole screen.
    this.shade = scene.add
      .rectangle(0, 0, VIEW.w, VIEW.h, DAY.nightColor, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(7);
    for (let i = 0; i < RAIN.drops; i++) {
      const drop = scene.add
        .rectangle(Math.random() * VIEW.w, Math.random() * VIEW.h, 2, 16, RAIN.color, 0.45)
        .setAngle(12)
        .setScrollFactor(0)
        .setDepth(7)
        .setVisible(false);
      this.drops.push(drop);
    }
    scene.events.once('shutdown', () => sfx.rain(false));
  }

  private static rollGap(): number {
    return Phaser.Math.FloatBetween(RAIN.gapMinSec, RAIN.gapMaxSec);
  }

  /** Seconds into the current day. */
  private get clock(): number {
    return this.seconds % DAY.lengthSec;
  }

  private get dusk(): number {
    return DAY.lengthSec * (1 - DAY.nightFraction);
  }

  /** The day the player is living through, starting at 1. */
  get day(): number {
    return Math.floor(this.seconds / DAY.lengthSec) + 1;
  }

  /** Whole days seen through to the next dawn. */
  get daysSurvived(): number {
    return this.day - 1;
  }

  get isNight(): boolean {
    return this.clock >= this.dusk;
  }

  get raining(): boolean {
    return this.rainFor > 0;
  }

  /** 0 in full daylight, 1 in full night, in between while the light is changing. */
  get darkness(): number {
    const t = this.clock;
    if (t >= this.dusk) return Phaser.Math.Clamp((t - this.dusk) / DAY.fadeSec, 0, 1);
    // Dawn: the dark lifts over the first seconds of every day but the first.
    return this.day > 1 ? Phaser.Math.Clamp(1 - t / DAY.fadeSec, 0, 1) : 0;
  }

  startRain(): void {
    this.rainFor = Phaser.Math.FloatBetween(RAIN.lastsMinSec, RAIN.lastsMaxSec);
    this.drops.forEach((drop) => drop.setVisible(true));
    sfx.rain(true);
  }

  private stopRain(): void {
    this.rainFor = 0;
    this.nextRainIn = Sky.rollGap();
    this.drops.forEach((drop) => drop.setVisible(false));
    sfx.rain(false);
  }

  update(dt: number): void {
    this.seconds += dt;

    if (this.raining) {
      this.rainFor -= dt;
      if (this.rainFor <= 0) this.stopRain();
    } else {
      this.nextRainIn -= dt;
      if (this.nextRainIn <= 0) this.startRain();
    }

    if (this.raining) {
      for (const drop of this.drops) {
        drop.y += RAIN.fallSpeed * dt;
        drop.x -= RAIN.fallSpeed * 0.21 * dt;
        if (drop.y > VIEW.h + 10) {
          drop.y = -10;
          drop.x = Math.random() * (VIEW.w + 120);
        }
      }
    }

    const dark = this.darkness * DAY.nightAlpha + (this.raining ? RAIN.gloom : 0);
    this.shade.setFillStyle(DAY.nightColor, Math.min(dark, 0.8));
  }
}
