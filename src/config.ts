// Every tunable number lives here so play-testing is a matter of editing one file.

export const VIEW = { w: 960, h: 600 };
export const WORLD = { w: 1920, h: 1320 };

export interface ItemType {
  name: string;
  /** How much Envy it adds when picked up, and how much hobos want it. */
  value: number;
  /** Hunger restored when eaten. */
  food: number;
  /** Stink added when eaten. Beans are the musical fruit. */
  stink?: number;
  color: number;
  /** Relative chance of spawning. */
  weight: number;
}

export const ITEMS: ItemType[] = [
  { name: 'beans', value: 5, food: 22, stink: 8, color: 0xb5651d, weight: 6 },
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
  mercySec: 0.6,
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
  /** The longest a melee can run. */
  meleeSec: 45,
  /** Once the whole horde has arrived, the second whistle blows early when this few are left standing. */
  lastStanding: 2,
  exitSec: 7,
  firstHorde: 32,
  hordeGrowth: 8,
  hoboSpeed: 112,
  hoboHp: 4,
  hoboDamage: 5,
  hoboSwingCooldown: 0.9,
  hoboReach: 34,
  /** Chance, each time a hobo picks a target, that he goes for a player who is carrying food. */
  playerFocus: 0.45,
  /** The same chance while the mob is still gathering. The rest crowd in close and loom. */
  mobFocus: 0.15,
  /** How close a hobo who is only looming stands. */
  crowdRing: 46,
  /** The brawl among the hobos starts once this share of the horde is within mobRadius of the player. */
  mobShare: 0.6,
  mobRadius: 200,
  /** It starts anyway this many seconds into the melee, in case the player keeps running. */
  brawlAfterSec: 20,
  /** Once the brawl is on, the chance that a hobo with no better idea picks a fight with the nearest hobo. */
  brawlChance: 0.6,
  /** A hobo who grabs dropped food worth at least this is mobbed even before the brawl starts. */
  prizeValue: 20,
  /** Seconds a hobo who grabbed dropped food is a target for the others. */
  lootEnvySec: 6,
  /** Seconds a hobo stays angry at a player who bonked him. */
  madAtPlayerSec: 4,
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
  /** Chance that a loose item is a newspaper instead of food. */
  paperChance: 0.15,
};

/** Not food and not loot: it goes straight inside your shirt. */
export const NEWSPAPER: ItemType = { name: 'newspaper', value: 0, food: 0, color: 0xd8d2c0, weight: 0 };

export const DAY = {
  /** Seconds in one full day, daylight and night together. "Days survived" counts these. */
  lengthSec: 180,
  /** The share of each day, at its end, that is night. */
  nightFraction: 1 / 3,
  /** Seconds the light takes to change at dusk and at dawn. */
  fadeSec: 8,
  /** How dark the night tint gets, 0 to 1. */
  nightAlpha: 0.55,
  nightColor: 0x140c04,
};

export const WARMTH = {
  max: 100,
  /** Lost per second at night, and per second in rain. Both at once add up. */
  nightPerSec: 1.6,
  rainPerSec: 2,
  /** Regained per second in dry daylight. */
  sunPerSec: 0.5,
  /** Regained per second beside a barrel fire, whatever the weather. */
  firePerSec: 14,
  fireRadius: 90,
  /** Below this you start to slow down, reaching slowTo of full speed at zero. */
  slowBelow: 35,
  slowTo: 0.55,
  /** Health lost per second at zero Warmth. */
  freezePerSec: 2.5,
  /** Cold a single newspaper soaks up before your Warmth starts to fall, and the most you can stuff in. */
  paperWorth: 25,
  paperMax: 50,
};

export const STINK = {
  max: 100,
  perSec: 0.45,
  /** Added by one dumpster dive. */
  perDive: 18,
  /** Washed off per second in rain, and per second standing in the horse trough. */
  rainWashPerSec: 1.5,
  troughWashPerSec: 50,
  /** Panic hobos start to hesitate above this much Stink. */
  hesitateFrom: 40,
  /** At full Stink, the chance that a hobo about to hit you thinks better of it. */
  hesitateChance: 0.6,
  /** Seconds a hobo who thought better of it keeps his distance. */
  hesitateSec: 1.2,
};

export const RAIN = {
  /** A shower starts this many seconds after the last one ended, picked at random in this range. */
  gapMinSec: 150,
  gapMaxSec: 330,
  lastsMinSec: 20,
  lastsMaxSec: 30,
  drops: 70,
  fallSpeed: 900,
  /** Extra darkness while it rains. */
  gloom: 0.14,
  color: 0xa8c0d0,
};

export const DUMPSTER = {
  /** Seconds you have to stand against one before you are in it. */
  diveSec: 1.2,
  /** How close counts as standing against it. */
  reach: 20,
  /** Items one dive turns up. */
  loot: 2,
  /** Chance that each of those is a newspaper. */
  paperChance: 0.3,
  refillSec: 45,
};

export const SHOPKEEPER = {
  /** Which of the six storefronts is his, counting from 0 at the left. */
  shop: 3,
  paceSpeed: 45,
  chaseSpeed: 200,
  /** How far he notices a clean hobo in the direction he is walking, and behind his back. */
  noticeAhead: 190,
  noticeBehind: 70,
  /** Added to both at full Stink. A nose needs no eyes. */
  stinkRadius: 110,
  /** Seconds you have to stand at the windowsill to lift the pie, and how close counts. */
  liftSec: 1.2,
  sillReach: 30,
  /** His property: this far either side of the shop's middle, and down the street to this y. */
  propertyHalfWidth: 190,
  propertyBottom: 320,
  /** How hard the broom shoves you, and how long you stagger. */
  shoveSpeed: 430,
  staggerSec: 0.35,
  /** He stops chasing after this long, or as soon as you are off the property. */
  giveUpSec: 4,
  /** Seconds until a new pie is put out to cool on the windowsill. */
  pieEverySec: 30,
};

export const TOUCH = {
  /** Finger travel, in screen pixels, before the thumb stick starts moving you. */
  deadZone: 12,
  stickRadius: 52,
  buttonRadius: 44,
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
  hoboLooter: 0x9aa63a,
  button: 0x2a2218,
  buttonEdge: 0xe8c07a,
  crow: 0x0c0c0c,
  wire: 0x1a1a1a,
  keeperShop: 0xa8683c,
  keeper: 0xe8e4d8,
  sill: 0xd8ccb0,
  barrel: 0x33302c,
  flame: 0xf08a24,
  dumpster: 0x2f5a44,
  dumpsterEmpty: 0x26342c,
  trough: 0x4f7896,
  stink: 0x8a9a2a,
  fly: 0x0c0c0c,
};
