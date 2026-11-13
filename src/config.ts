// Every tunable number lives here so play-testing is a matter of editing one file.

export const VIEW = { w: 960, h: 600 };
export const WORLD = { w: 1920, h: 1320 };

export interface ItemType {
  name: string;
  /** How much Envy it adds when picked up, and how much hobos want it. */
  value: number;
  /** Hunger restored when eaten. */
  food: number;
  color: number;
  /** Relative chance of spawning. */
  weight: number;
}

export const ITEMS: ItemType[] = [
  { name: 'beans', value: 5, food: 22, color: 0xb5651d, weight: 6 },
  { name: 'pie', value: 12, food: 40, color: 0xe0a030, weight: 3 },
  { name: 'chicken', value: 25, food: 70, color: 0xf2e2b0, weight: 1 },
];

export const PLAYER = {
  speed: 170,
  sackSlots: 6,
  maxHealth: 100,
  maxHunger: 100,
  hungerPerSec: 1.1,
  starvePerSec: 3,
  swingCooldown: 0.45,
  swingRadius: 48,
  /** Anyone this close counts as watching you eat. */
  seenRadius: 230,
  /** Seconds of safety after taking a hit. */
  mercySec: 0.45,
};

export const ENVY = {
  /** Average Envy at which a Panic fires. */
  threshold: 95,
  /** The real threshold is rolled within this fraction either side, so it can't be counted to. */
  variance: 0.2,
  /** Envy fades while the sack is worth less than this. */
  poorBelow: 10,
  decayPerSec: 1.5,
  /** Fractions of the threshold at which each stage of hints appears. */
  stages: [0.35, 0.6, 0.85],
  /** Crows on the wire at each hint stage. */
  crows: [0, 2, 5, 9],
};

export const PANIC = {
  /** Seconds of tramping feet between the whistle and the horde. */
  approachSec: 10,
  /** The horde trickles in over this many seconds of the melee. */
  arrivalSec: 14,
  meleeSec: 32,
  exitSec: 7,
  firstHorde: 24,
  hordeGrowth: 6,
  hoboSpeed: 112,
  hoboHp: 4,
  hoboDamage: 6,
  hoboSwingCooldown: 0.9,
  hoboReach: 34,
};

export const DOG = {
  speed: 190,
  sightRadius: 270,
  biteDamage: 9,
  biteCooldown: 1,
};

export const SPAWN = {
  itemsOnMap: 24,
  respawnEverySec: 4,
};

export const COLORS = {
  ground: 0x3d4a36,
  street: 0x5a544c,
  yard: 0x4b4136,
  rail: 0x2a2520,
  camp: 0x4f4a2c,
  shop: 0x8a5a44,
  player: 0xe8c07a,
  townsfolk: 0x7fa6c9,
  dog: 0x9b3b2f,
  hobo: 0x6f7f3a,
  hoboKo: 0x55554f,
  crow: 0x0c0c0c,
  wire: 0x1a1a1a,
};
