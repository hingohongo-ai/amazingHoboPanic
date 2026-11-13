import Phaser from 'phaser';
import './style.css';
import { VIEW } from './config';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { GameOverScene } from './scenes/GameOverScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW.w,
  height: VIEW.h,
  backgroundColor: '#14110d',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [TitleScene, GameScene, GameOverScene],
});

// Handy in the browser console while developing: __game.scene.getScene('Game')
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
