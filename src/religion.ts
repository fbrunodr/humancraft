// Religions (Civ IV's, in the main). Each is founded by the first civ in
// the world to adopt its faith, an identity trait of the Devotion path
// (identity.ts): Meditation founds Hinduism, and so on; a civ adopts one
// faith at most, so the rest stay open to others. The founder's capital
// becomes its holy city and is the first to hold it.
//
// A city holds any number of religions, and never loses one. A religion
// comes to a city by a missionary and no other way (no pressure, no trade
// route, no distance to the holy city): a missionary of a religion,
// raised with faith in a city that holds it, goes where it is sent and
// preaches in a city that does not; it takes with the odds Civ IV gives
// it (spreadChance), and the missionary is spent either way.
//
// Every religion gives the same. What it gives depends on the state:
//   a state religion   each of the civ's cities that holds it makes
//                      STATE_BONUS more (culture and cohesion)
//   a secular state    each of its cities makes SECULAR_BONUS more for
//                      every religion it holds past its first
// so with no religion yet a state is secular for nothing; with up to
// three in a city a state religion pays as much or more (three: the
// same); and once its cities hold four and more each, being secular
// pays more. A civ takes for its state religion
// one that a city of its own holds. Its first costs nothing; every change
// after that (to another, or back to none) unsettles its people: its
// cities make CONVERSION_COST less cohesion for CONVERSION_TURNS.
//
// Each religion has its own buildings, the same for all but the name: a
// temple (TEMPLE_TECH) and, with that, a cathedral (CATHEDRAL_TECH), built
// only in a city that holds the religion; a city of three religions may
// build all three temples.
//
// Whoever holds a religion's holy city takes TITHE gold a turn for every
// city in the world that holds it.
//
// There is no victory by religion. What a shared state religion does
// between two civs is diplomacy's (diplomacy.ts): they think the better
// of each other, and of a rival creed the worse.

export interface ReligionDef {
  readonly name: string;
  readonly color: string;
  readonly temple: string;      // its temple's name
  readonly cathedral: string;   // and its great house's (Civ IV's names)
}

export const RELIGIONS = {
  hinduism:     { name: 'Hinduism',     color: '#d9480f', temple: 'Hindu Temple',     cathedral: 'Mandir' },
  judaism:      { name: 'Judaism',      color: '#1c7ed6', temple: 'Jewish Temple',    cathedral: 'Synagogue' },
  buddhism:     { name: 'Buddhism',     color: '#f59f00', temple: 'Buddhist Temple',  cathedral: 'Stupa' },
  taoism:       { name: 'Taoism',       color: '#495057', temple: 'Taoist Temple',    cathedral: 'Pagoda' },
  confucianism: { name: 'Confucianism', color: '#2b8a3e', temple: 'Confucian Temple', cathedral: 'Confucian Academy' },
  christianity: { name: 'Christianity', color: '#7048e8', temple: 'Christian Temple', cathedral: 'Cathedral' },
  islam:        { name: 'Islam',        color: '#0b7285', temple: 'Islamic Temple',   cathedral: 'Mosque' },
} satisfies Record<string, ReligionDef>;
export type ReligionKey = keyof typeof RELIGIONS;
export const RELIGION_KEYS = Object.keys(RELIGIONS) as ReligionKey[];
export const religionDef = (k: ReligionKey): ReligionDef => RELIGIONS[k];

// The chance (in a hundred) that a missionary's preaching takes, by Civ
// IV's law (CvUnit::spread): SPREAD_BASE in a city of its own civ, half
// that in another's; and of what is left to a hundred, the share of the
// world's religions the city does not hold yet. So a city with none always
// takes the first; each one it holds makes the next harder, and a
// foreign city is harder than one's own.
export const SPREAD_BASE = 40;
export function spreadChance(held: number, own: boolean): number {
  const base = own ? SPREAD_BASE : Math.floor(SPREAD_BASE / 2), n = RELIGION_KEYS.length;
  return base + Math.floor(((n - Math.min(n, held)) * (100 - base)) / n);
}

// A missionary costs MISSIONARY_FAITH (at the game's pace); a civ keeps at
// most MISSIONARIES_MOST of a religion out at once (Civ IV's three).
export const MISSIONARY_FAITH = 30;
export const MISSIONARIES_MOST = 3;

// What the state makes of its cities' religions (see above).
export const STATE_BONUS = { culture: 2, cohesion: 2 } as const;
export const SECULAR_BONUS = { culture: 1, cohesion: 1 } as const;
export const CONVERSION_TURNS = 10;
export const CONVERSION_COST = 0.5;

// Gold a turn to the holder of a holy city, for each city that holds its religion.
export const TITHE = 1;

// The techs its buildings wait for (the city holding the religion besides).
export const TEMPLE_TECH = 'mysticism', CATHEDRAL_TECH = 'domes';
