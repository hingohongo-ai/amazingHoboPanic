import { ENVY } from './config';

/**
 * The hidden value behind a Hobo Panic. The player never sees this number;
 * they only see the hints that each stage switches on.
 */
export class Envy {
  value = 0;
  threshold = Envy.rollThreshold();

  private static rollThreshold(): number {
    const spread = (Math.random() * 2 - 1) * ENVY.variance;
    return ENVY.threshold * (1 + spread);
  }

  /** Positive for loot gained or eating in public, negative for loot lost or eaten in private. */
  add(amount: number): void {
    this.value = Math.max(0, this.value + amount);
  }

  /** Envy fades slowly while the player is carrying little. */
  update(dt: number, carriedValue: number): void {
    if (carriedValue < ENVY.poorBelow) this.add(-ENVY.decayPerSec * dt);
  }

  /** 0 = calm, 1 = rising, 2 = high, 3 = critical. */
  get stage(): number {
    const ratio = this.value / this.threshold;
    let stage = 0;
    for (const cut of ENVY.stages) if (ratio >= cut) stage++;
    return stage;
  }

  get tripped(): boolean {
    return this.value >= this.threshold;
  }

  reset(): void {
    this.value = 0;
    this.threshold = Envy.rollThreshold();
  }
}
