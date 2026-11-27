// What civs trade (Civ IV's list, less its vassals and permanent
// alliances). A deal is of one of two kinds, never both:
//
//   settled at once   gold, a technology, a map of the world, a city; a
//                     war declared on a third civ, peace made with one;
//                     the state's religion taken up. Done as it is
//                     signed, and over.
//   lasting           gold a turn, a resource, open borders, a defensive
//                     pact, an embargo on a third civ. It runs for
//                     DEAL_TURNS, and either side may end it once
//                     DEAL_MIN have passed.
//
// The two are not mixed: gold in hand for a promise of thirty turns would
// let the taker walk off with the gold and end the promise (Civ IV keeps
// them apart for the same reason).
//
// Open borders and a defensive pact bind both sides alike: they stand on
// both sides of the deal that makes them.
import type { TechKey } from './techs.ts';
import type { ResourceKey } from './resources.ts';
import type { ReligionKey } from './religion.ts';

export type NowItem =
  | { readonly k: 'gold'; readonly n: number }
  | { readonly k: 'tech'; readonly tech: TechKey }
  | { readonly k: 'map' }
  | { readonly k: 'city'; readonly city: number }
  | { readonly k: 'warOn'; readonly civ: number }
  | { readonly k: 'peaceWith'; readonly civ: number }
  | { readonly k: 'convert'; readonly religion: ReligionKey };
export type LastingItem =
  | { readonly k: 'goldPerTurn'; readonly n: number }
  | { readonly k: 'resource'; readonly resource: ResourceKey }
  | { readonly k: 'openBorders' }
  | { readonly k: 'pact' }
  | { readonly k: 'embargo'; readonly civ: number };
export type Item = NowItem | LastingItem;

const LASTING: ReadonlySet<Item['k']> = new Set(['goldPerTurn', 'resource', 'openBorders', 'pact', 'embargo']);
export const isLasting = (i: Item): i is LastingItem => LASTING.has(i.k);
// (What binds both sides alike.)
export const isMutual = (i: Item): boolean => i.k === 'openBorders' || i.k === 'pact';
export const sameItem = (a: Item, b: Item): boolean => JSON.stringify(a) === JSON.stringify(b);

// A deal proposed: what `from` gives `to`, and what it asks of it.
// (`peace`: it ends the war between the two as well: a peace with terms,
// settled at once. `demand`: see below.)
export interface Offer {
  readonly from: number;
  readonly to: number;
  readonly give: readonly Item[];
  readonly get: readonly Item[];
  readonly peace?: boolean;
  readonly demand?: boolean;   // asked with nothing offered, of a civ thought weak: refusing it is remembered
}
// A lasting deal in force: what a gives b and b gives a, since a turn and until one.
export interface Treaty {
  readonly a: number;
  readonly b: number;
  readonly give: readonly LastingItem[];
  readonly get: readonly LastingItem[];
  readonly since: number;
  readonly until: number;
}
export const DEAL_TURNS = 30;
export const DEAL_MIN = 10;

export const offerItems = (o: Offer): Item[] => [...o.give, ...o.get];
// What a civ gives in a treaty, and gets.
export const givenBy = (t: Treaty, civ: number): readonly LastingItem[] => (t.a === civ ? t.give : t.b === civ ? t.get : []);
export const partyTo = (t: Treaty, civ: number): boolean => t.a === civ || t.b === civ;
export const between = (t: Treaty, x: number, y: number): boolean => (t.a === x && t.b === y) || (t.a === y && t.b === x);
