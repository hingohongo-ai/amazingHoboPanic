import Phaser from 'phaser';
import { VIEW } from '../config';
import { homeHasFocus, showHome } from '../home';
import type { RunStats } from './GameScene';

const BEST_KEY = 'amazingHoboPanic.bestSeconds';

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(seconds: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(seconds));
  } catch {
    // Storage can be blocked; the score just isn't kept.
  }
}

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export class GameOverScene extends Phaser.Scene {
  private stats: RunStats = { seconds: 0, days: 0, panics: 0, bonked: 0, eaten: 0 };

  constructor() {
    super('GameOver');
  }

  init(data: Partial<RunStats>): void {
    this.stats = { seconds: 0, days: 0, panics: 0, bonked: 0, eaten: 0, ...data };
  }

  create(): void {
    showHome(true);
    const { seconds, days, panics, bonked, eaten } = this.stats;
    const best = readBest();
    const isBest = seconds > best;
    if (isBest) writeBest(seconds);

    const cx = VIEW.w / 2;
    this.add
      .text(cx, 150, 'THE RAILS CLAIM ANOTHER', { fontFamily: 'Georgia, serif', fontSize: '44px', color: '#e8c07a' })
      .setOrigin(0.5);
    this.add
      .text(
        cx,
        310,
        [
          `Days survived   ${days}`,
          `Time on the bum ${clock(seconds)}${isBest ? '   (new best)' : ''}`,
          `Best time       ${clock(Math.max(best, seconds))}`,
          `Panics survived ${panics}`,
          `Hobos bonked    ${bonked}`,
          `Things eaten    ${eaten}`,
        ].join('\n'),
        { fontFamily: 'monospace', fontSize: '20px', color: '#d8ccb0', lineSpacing: 10 },
      )
      .setOrigin(0.5);
    this.add
      .text(cx, 480, 'Press Space or click to try again', {
        fontFamily: 'Georgia, serif',
        fontSize: '22px',
        color: '#f0c05a',
      })
      .setOrigin(0.5);

    const restart = (): void => {
      if (homeHasFocus()) return;
      this.scene.start('Game');
    };
    // A short delay so a held Space from the fight doesn't restart at once.
    this.time.delayedCall(600, () => {
      this.input.keyboard!.once('keydown-SPACE', restart);
      this.input.once('pointerdown', restart);
    });
  }
}
