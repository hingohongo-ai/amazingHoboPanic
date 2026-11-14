import Phaser from 'phaser';
import { VIEW } from '../config';
import { initAudio } from '../audio';
import { homeHasFocus, showHome } from '../home';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    showHome(true);
    const cx = VIEW.w / 2;
    this.add
      .text(cx, 170, 'AMAZING HOBO PANIC', { fontFamily: 'Georgia, serif', fontSize: '56px', color: '#e8c07a' })
      .setOrigin(0.5);
    this.add
      .text(cx, 235, 'gray-box prototype: you are the tan square', {
        fontFamily: 'Georgia, serif',
        fontSize: '18px',
        color: '#a89878',
      })
      .setOrigin(0.5);
    this.add
      .text(
        cx,
        362,
        [
          'Move: hold the mouse or a thumb on the field, or WASD / arrows',
          'Swing your bindle: SWING button, right-click or Space',
          'Eat from your sack: EAT button or E   (mind who is watching)',
          'Drop food: DROP button or Q',
          'Search a dumpster: stand against it',
          '',
          'Stay fed. Stay warm after dark: find a barrel fire or some newspaper.',
          'The horse trough is there if you care how you smell.',
          'Do not get too comfortable.',
        ].join('\n'),
        { fontFamily: 'monospace', fontSize: '16px', color: '#d8ccb0', align: 'center', lineSpacing: 6 },
      )
      .setOrigin(0.5);
    this.add
      .text(cx, 510, 'Press Space or click to ride the rails', {
        fontFamily: 'Georgia, serif',
        fontSize: '22px',
        color: '#f0c05a',
      })
      .setOrigin(0.5);

    const start = (): void => {
      if (homeHasFocus()) return;
      initAudio();
      this.scene.start('Game');
    };
    this.input.keyboard!.once('keydown-SPACE', start);
    this.input.once('pointerdown', start);
  }
}
