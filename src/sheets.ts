import { HUMAN, EMBARK_TECH, OCEAN_TECH, UNITS_PER_SOURCE, DEAL_TURNS, TRUCE_BREAK, VICTORIES, UN_EVERY, UN_SHARE, UN_TECH, MIN_WAR, type Victory, type Game, type Player } from './game.ts';
import { DEAL_MIN, isLasting, isMutual, sameItem, givenBy, partyTo, type Item, type Offer } from './deals.ts';
import { regard, powerOf, mood, moodOf, weigh, techsFor, mapNews, forecast, itemText, MOODS, REGARDS, REGARD_CUTS } from './diplomacy.ts';
import { TECH_KEYS, STAGE_TECHS, techDef, techPath, type TechKey, type TechDef } from './techs.ts';
import {
  POLITICS_KEYS, politicsDef, politicsPath, GOVERNMENT_KEYS, governmentDef, policyDef, fits, SLOT_KINDS, POLICY_KINDS, POLICY_KEYS,
  type PoliticsKey, type PoliticsDef, type GovernmentKey, type PolicyKey, type PolicySlot, type PolicyKind,
} from './politics.ts';
import {
  PATHS, FAITH_KEYS, PAIR_SLOTS, MAX_TRAITS, openSlots, traitDef, pathTraits, traitBlock, pathLevels, epithet, traitOfReligion, BLOCK_TEXT, isTraitKey,
  type PathKey, type TraitKey,
} from './identity.ts';
import { RELIGION_KEYS, religionDef, spreadChance, STATE_BONUS, SECULAR_BONUS, CONVERSION_TURNS, CONVERSION_COST, MISSIONARIES_MOST, TITHE, TEMPLE_TECH, CATHEDRAL_TECH, type ReligionKey } from './religion.ts';
import { RESOURCE_KEYS, resourceDef, empireBonus, type ResourceKey } from './resources.ts';
import { describe as describeEffect, describeAll, yieldBonus, total, type Effect } from './effects.ts';
import { ERAS, BUILDINGS, WONDERS, IMPROVEMENTS, OUTPUT_KEYS, out, type EraIndex, type ImprovementKey, type OutputKey } from './cities.ts';
import { UNITS, unitDef, buildDef } from './rules.ts';
import { FREE_UNITS, UPKEEP_PER_TILE, UPKEEP_PER_CITY, UPKEEP_PER_POP, COURTHOUSE_CUT, BUILDING_UPKEEP_PER, UNIT_UPKEEP_PER, INFLATION_TURNS, buildingUpkeep } from './economy.ts';
import { RANKS, type Rank } from './ai.ts';
import { bonusStr, tip } from './ui.ts';
import { icon, unitIcon, resourceIcon, YIELD_ICON } from './icons.ts';

// The empire's sheets: full-screen pages over the map, opened from the top
// bar (data-sheet: the research, politics and identity tracks, and the
// buttons; the gold, science, cohesion, culture and faith yields open the
// economy, research, politics, identity and religion; the resources beside
// them, theirs; the turn, victory)
// and closed with Esc.
//   economy     the treasury's accounts: what comes in, what goes out, city by city
//   cities      every city of the civ in one table: what each makes, how it grows, what it builds
//   resources   the strategic resources (their sources, the units they arm) and the luxuries
//   research    the tech tree: click a tech to research it (and what it needs first);
//               a box to find what gives something ("camp", "embark"), going from one
//               item found to the next (Enter, or its arrows)
//   politics    the politics tree, likewise (governments and policies)
//   identity    the civ's identity: its paths and traits (identity.ts), to adopt
//   government  three tabs (beside its title): the government in place and its
//               policies, the policy cards to slot, and the governments to adopt
//   religion    the world's religions and the civ's cities' faith
//   diplomacy   the civs met: at war or peace, declare war, offer or accept peace;
//               trade (resources, gold a turn): offers, deals in force, a proposal
//   victory     how the game is won, and how far the civ and those it has met are
// Research, politics, identity and religion have a second tab each: where
// their yield (science, cohesion, culture, faith) comes from.
// They change the game directly and then call `changed` (main.ts redraws).

export type SheetKind = 'economy' | 'resources' | 'cities' | 'research' | 'politics' | 'identity' | 'government' | 'religion' | 'diplomacy' | 'victory';
const SHEETS: readonly SheetKind[] = ['economy', 'resources', 'cities', 'research', 'politics', 'identity', 'government', 'religion', 'diplomacy', 'victory'];
const isSheet = (s: string): s is SheetKind => (SHEETS as readonly string[]).includes(s);
// The sheets a yield pays for, each with a second tab (where the yield comes from): the yield, the two tabs' names.
const YIELD_TAB: Partial<Record<SheetKind, readonly [OutputKey, string, string]>> = {
  research: ['science', 'Technologies', 'Science'], politics: ['cohesion', 'Politics', 'Cohesion'], identity: ['culture', 'Traits', 'Culture'], religion: ['faith', 'Religions', 'Faith'],
};
const YIELD_USE: Record<OutputKey, string> = {
  food: '', prod: '', gold: '', science: 'It goes toward what you research.', cohesion: 'It goes toward your politics.',
  culture: 'It goes toward your identity\'s next trait, and each city\'s own pushes its borders out.', faith: 'It is kept, and buys what a city builds; a founder\'s raises missionaries.',
};
type GovTab = 'mine' | 'policies' | 'governments';
type DipTab = 'civs' | 'relations' | 'trade' | 'deals' | 'un';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const KIND_NAME: Record<PolicySlot, string> = { military: 'Military', economic: 'Economic', social: 'Social', wildcard: 'Wildcard' };
const TIER_NAME = ['', 'I', 'II', 'III'] as const;
// The kinds among some units, each with how many.
const unitKeysOf = <K extends string>(types: readonly K[]): [K, number][] => {
  const n = new Map<K, number>();
  for (const t of types) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n];
};
// A table that sorts: a cell is what it shows and what it sorts by; a
// column, its heading and whether it is a figure (right-aligned, the
// largest first when first clicked).
interface Cell { readonly html: string; readonly v: number | string }
const num = (v: number, html: string): Cell => ({ html, v });
type Col = readonly [label: string, figure: boolean, tip?: string];

// A tree's plates and the room between them (pixels). A plate is as tall as
// the tree's fullest needs: its name, then up to CHIP_ROWS rows of chips.
const NODE_W = 280, GAP_X = 56, GAP_Y = 14, TREE_TOP = 46, TREE_PAD = 8;
// How far before an item its lines turn up or down the gap.
const LANE_BACK = 20;
// A chip on a plate: what an item unlocks or gives, named. Their widths are
// reckoned here (one face, every letter as wide: game.css .node .u), so a
// plate knows its rows before it is drawn.
interface Chip { readonly cls: string; readonly ic: string; readonly name: string; readonly sub: string }
const CHIP_CH = 6.75, CHIP_PAD = 32, CHIP_GAP = 4, CHIP_ROWS = 2, CHIP_ROOM = NODE_W - 24, MORE_W = 38;
const YIELD_CLS: Record<OutputKey, string> = { food: 'food', prod: 'prod', gold: 'gold', science: 'sci', culture: 'cul', faith: 'fai', cohesion: 'coh' };
const IMPROVEMENT_KEYS = Object.keys(IMPROVEMENTS) as ImprovementKey[];
const plural = (name: string) => (name.endsWith('s') ? name : name.endsWith('y') ? `${name.slice(0, -1)}ies` : `${name}s`);
// The rows a run of chips takes, each as wide as given.
const chipRows = (widths: readonly number[]): number => {
  let rows = 0, left = 0;
  for (const w of widths) {
    if (rows === 0 || w + CHIP_GAP > left) { rows++; left = CHIP_ROOM - w; } else left -= w + CHIP_GAP;
  }
  return rows;
};

export class Sheets {
  private open: SheetKind | null = null;
  private shown: string | null = null;      // the sheet and tab last drawn (a tree opens scrolled to where the civ has got to)
  private readonly sources = new Set<SheetKind>();
  private readonly sorts = new Map<string, { col: number; down: boolean }>();   // each table's order, as the player set it   // the sheets showing their second tab: where their yield comes from
  private readonly el: HTMLElement;
  private govTab: GovTab = 'mine';
  private findAt = 0;                        // which of the items found it stands at
  private find = '';                         // what the tree's box looks for
  private filter: PolicyKind | 'all' = 'all';
  private target: { slot: PolicySlot; i: number } | null = null;   // the slot a policy card will go to
  private notice = '';
  // The trade being drawn up: with whom, what each side gives.
  // (`reply`: the letter it answers, a counter-proposal: set aside when this one is sent.)
  private draft: { civ: number; lasting: boolean; peace: boolean; give: Item[]; get: Item[]; reply?: Offer } | null = null;
  private civ = -1;                          // the civilization shown in detail
  private pieces: 'give' | 'get' = 'give';   // whose pieces the letter's drawer shows
  private dipTab: DipTab = 'civs';
  // The charts on the sheet as drawn (their lines, for the pointer to read a turn off them).
  private readonly charts = new Map<string, { title: string; series: readonly { name: string; color: string; values: readonly number[] }[] }>();

  constructor(private readonly game: Game, private readonly changed: () => void) {
    this.el = document.getElementById('sheet')!;
    document.body.addEventListener('click', (e) => {
      // (An icon is a target too: an SVG element, not an HTML one.)
      const t = e.target instanceof Element ? e.target : null;
      const btn = t?.closest<HTMLElement>('[data-sheet]');
      if (btn) {
        const k = btn.dataset['sheet'] ?? '';
        if (!isSheet(k)) return;
        // (The three advances, top left, open their own tab: the tree or the traits, whatever tab the sheet was left on.)
        if (btn.closest('#trackers') && this.sources.delete(k)) { this.open = k; this.notice = ''; this.render(); }
        else if (this.el.contains(btn)) this.show(k);
        else this.toggle(k);
        return;
      }
      if (!t || !this.el.contains(t)) return;
      const act = t.closest<HTMLElement>('[data-do]');
      if (act) this.act(act);
    });
    // A tree's item under the pointer: the lines of all it rests on light up.
    // A chart under the pointer: a line at its turn, and that turn's figures beside it.
    this.el.addEventListener('mousemove', (e) => {
      const svg = e.target instanceof Element ? e.target.closest<SVGSVGElement>('.hchart svg') : null;
      for (const box of this.el.querySelectorAll<HTMLElement>('.hchart')) {
        const tipEl = box.querySelector<HTMLElement>('.htip'), cross = box.querySelector<SVGLineElement>('.hcross');
        if (!tipEl || !cross) continue;
        const data = svg && box.contains(svg) ? this.charts.get(svg.dataset['chart'] ?? '') : undefined;
        if (!svg || !data) { tipEl.hidden = true; cross.setAttribute('visibility', 'hidden'); continue; }
        const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, x = ((e.clientX - r.left) / r.width) * vb.width;
        const x0 = Number(svg.dataset['x0']), x1 = Number(svg.dataset['x1']), turns = Number(svg.dataset['turns']);
        const t = Math.max(1, Math.min(turns, Math.round(1 + ((x - x0) / Math.max(1, x1 - x0)) * (turns - 1))));
        const px = x0 + ((t - 1) / Math.max(1, turns - 1)) * (x1 - x0);
        cross.setAttribute('x1', String(px)); cross.setAttribute('x2', String(px)); cross.setAttribute('visibility', 'visible');
        const rows = data.series.map((sr) => ({ sr, v: sr.values[t - 1] ?? 0 })).sort((a, b) => b.v - a.v)
          .map((x2) => `<div><span class="swatch" style="background:${x2.sr.color}"></span>${esc(x2.sr.name)}<b>${x2.v.toLocaleString()}</b></div>`).join('');
        tipEl.innerHTML = `<small>Turn ${t}</small>${rows}`;
        tipEl.hidden = false;
        const left = ((px / vb.width) * r.width) + (r.left - box.getBoundingClientRect().left);
        tipEl.style.left = `${px > vb.width * 0.6 ? left - tipEl.offsetWidth - 14 : left + 14}px`;
      }
    });
    this.el.addEventListener('mouseover', (e) => {
      const node = e.target instanceof Element ? e.target.closest<HTMLElement>('.node') : null;
      const lit = new Set<string>();
      const add = (k: string): void => {
        if (lit.has(k)) return;
        lit.add(k);
        const needs: readonly string[] = (TECH_KEYS as readonly string[]).includes(k) ? techDef(k as TechKey).needs : politicsDef(k as PoliticsKey).needs;
        needs.forEach(add);
      };
      if (node?.dataset['node']) add(node.dataset['node']);
      // (Those lit are drawn last, over the rest: they run one over another before a column, and the last drawn shows.)
      this.el.querySelectorAll<SVGPathElement>('svg.links path').forEach((p) => {
        const on = lit.has(p.dataset['b'] ?? '') && lit.has(p.dataset['a'] ?? '');
        if (on !== p.classList.contains('lit')) { p.classList.toggle('lit', on); if (on) p.parentNode?.appendChild(p); }
      });
    });
    // A tree's box: what is typed dims every item that does not give it.
    this.el.addEventListener('input', (e) => {
      if (!(e.target instanceof HTMLInputElement) || !e.target.matches('[data-find]')) return;
      this.find = e.target.value;
      this.findAt = 0;
      this.applyFind(true);
    });
    // (Enter in the box, or the down arrow: the next item found; with Shift, or the up arrow, the one before.)
    this.el.addEventListener('keydown', (e) => {
      if (!(e.target instanceof HTMLInputElement) || !e.target.matches('[data-find]')) return;
      const by = e.key === 'Enter' ? (e.shiftKey ? -1 : 1) : e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (!by) return;
      e.preventDefault();
      this.findStep(by);
    });
    // (A press on one of the box's arrows leaves the keys with the box.)
    this.el.addEventListener('mousedown', (e) => { if (e.target instanceof Element && e.target.closest('.findnav')) e.preventDefault(); });
  }

  // Dims a tree's items that neither are nor give what the box asks for, and
  // marks the chips that do. The items found are gone through in the tree's
  // order (left to right, then down): one of them is the one stood at, ringed
  // and counted ("2 of 5"); `go` brings it into view.
  private applyFind(go: boolean): void {
    const q = this.find.trim().toLowerCase();
    const hits: HTMLElement[] = [];
    this.el.querySelectorAll<HTMLElement>('.node').forEach((node) => {
      const hit = q !== '' && (node.dataset['find'] ?? '').includes(q);
      node.classList.toggle('dim', q !== '' && !hit);
      node.classList.remove('at');
      node.querySelectorAll<HTMLElement>('.u').forEach((u) => u.classList.toggle('hit', q !== '' && (u.dataset['f'] ?? '').includes(q)));
      if (hit) hits.push(node);
    });
    hits.sort((a, b) => a.offsetLeft - b.offsetLeft || a.offsetTop - b.offsetTop);
    this.findAt = hits.length ? ((this.findAt % hits.length) + hits.length) % hits.length : 0;
    const at = hits[this.findAt];
    at?.classList.add('at');
    const count = this.el.querySelector('.find small');
    if (count) count.textContent = q ? (hits.length ? `${this.findAt + 1} of ${hits.length}` : 'nothing') : '';
    this.el.querySelectorAll<HTMLButtonElement>('.findnav button').forEach((b) => { b.disabled = hits.length < 2; });
    // (Into the middle of what shows of the sheet under its head.)
    const tree = this.el.querySelector<HTMLElement>('.tree'), head = this.el.querySelector<HTMLElement>('.head');
    if (go && at && tree) this.el.scrollTo({
      left: tree.offsetLeft + at.offsetLeft + at.offsetWidth / 2 - this.el.clientWidth / 2,
      top: tree.offsetTop + at.offsetTop + at.offsetHeight / 2 - (this.el.clientHeight + (head?.offsetHeight ?? 0)) / 2,
      behavior: 'smooth',
    });
  }
  // To the next item found (or the one before), round and round.
  // (The box keeps the keys: after a click on an arrow, Enter still goes on from there.)
  private findStep(by: number): void { this.findAt += by; this.el.querySelector<HTMLInputElement>('[data-find]')?.focus({ preventScroll: true }); this.applyFind(true); }

  get isOpen(): boolean { return this.open !== null; }
  private get me(): Player { return this.game.players[HUMAN]!; }

  toggle(k: SheetKind): void { this.open = this.open === k ? null : k; this.notice = ''; this.find = ''; this.findAt = 0; this.render(); }
  close(): void { this.open = null; this.render(); }
  // A letter came: the Diplomacy sheet opened on it.
  showLetters(): void { this.draft = null; this.dipTab = 'trade'; this.open = 'diplomacy'; this.notice = ''; this.render(); }
  // Opens a sheet (if it is not the one open).
  show(k: SheetKind): void { if (this.open !== k) this.toggle(k); }

  render(): void {
    document.querySelectorAll<HTMLElement>('#sheets [data-sheet]').forEach((b) => {
      b.classList.toggle('active', b.dataset['sheet'] === this.open);
      const k = b.dataset['sheet'];
      const pending = (k === 'diplomacy' && ([...this.game.peaceOffers].some((o) => o.endsWith(`>${HUMAN}`)) || this.game.dealOffers.length > 0))
        || (k === 'government' && this.freeSlots() > 0);
      b.querySelector('.dot')?.remove();
      if (pending) b.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
    });
    document.querySelectorAll<HTMLElement>('#trackers [data-sheet]').forEach((b) => b.classList.toggle('active', b.dataset['sheet'] === this.open));
    // (The yields that open a sheet: lit by game.css from this.)
    document.body.dataset['open'] = this.open ?? '';
    if (!this.open) { this.el.classList.add('hidden'); this.el.innerHTML = ''; this.shown = null; return; }
    this.el.classList.remove('hidden');
    const tabbed = YIELD_TAB[this.open], from = tabbed && this.sources.has(this.open) ? tabbed[0] : null;
    const key = `${this.open}${from ? ':from' : ''}`, fresh = this.shown !== key;
    this.shown = key;
    const left = this.el.scrollLeft, top = this.el.scrollTop;
    const [title, sub, main] = this.page(this.open);
    // (Victory, diplomacy and government keep to the middle of the sheet, as the accounts do: game.css .page.)
    const body = from ? this.sourcesHtml(from) : this.open === 'victory' || this.open === 'diplomacy' || this.open === 'government' || this.open === 'cities' ? `<div class="page ${this.open === 'diplomacy' && (this.dipTab === 'civs' || this.dipTab === 'trade') ? 'wide' : ''}">${main}</div>` : main;
    const govTab = (k: GovTab, label: string) => `<button class="${this.govTab === k ? 'active' : ''}" data-do="govTab" data-tab="${k}">${label}</button>`;
    const dipTab = (k: DipTab, label: string) => `<button class="${this.dipTab === k ? 'active' : ''}" data-do="dipTab" data-tab="${k}">${label}${k === 'trade' && this.game.dealOffers.length ? ` <small>${this.game.dealOffers.length}</small>` : ''}</button>`;
    const tabs = this.open === 'government' ? `<nav class="htabs">${govTab('mine', 'My government')}${govTab('policies', 'Policies')}${govTab('governments', 'Governments')}</nav>`
      : this.open === 'diplomacy' ? `<nav class="htabs">${dipTab('civs', 'Civilizations')}${dipTab('relations', 'Relations')}${dipTab('trade', 'Letters')}${dipTab('deals', 'Agreements')}${dipTab('un', 'United Nations')}</nav>`
      : tabbed ? `<nav class="htabs"><button class="${from ? '' : 'active'}" data-do="tab" data-tab="main">${tabbed[1]}</button><button class="${from ? 'active' : ''}" data-do="tab" data-tab="from">${icon(YIELD_ICON[tabbed[0]])}${tabbed[2]}</button></nav>` : '';
    // (Its head: its title, a tree's box to find things in it. The top bar goes from one sheet to another.)
    const tree = (this.open === 'research' || this.open === 'politics') && !from;
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.matches('[data-find]');
    const find = tree ? `<label class="find">${icon('search')}<input data-find type="text" spellcheck="false" placeholder="Find what gives… ${this.open === 'research' ? 'camp, embark, iron' : 'a policy, a government'}" value="${esc(this.find)}"><small></small></label><span class="findnav"><button type="button" data-do="findPrev" ${tip('The one before', 'Shift + Enter, or the up arrow')}>‹</button><button type="button" data-do="findNext" ${tip('The next', 'Enter, or the down arrow')}>›</button></span>` : '';
    this.el.innerHTML = `<div class="head"><div class="stitle"><h2>${title}</h2>${tabs}<span class="sub">${sub}</span><span class="grow"></span>${find}
      <button class="close" data-do="close">${icon('close')} Close <kbd>Esc</kbd></button></div></div><div class="body">${body}</div>`;
    if (tree) {
      this.applyFind(false);
      if (typing) { const box = this.el.querySelector<HTMLInputElement>('[data-find]'); box?.focus(); box?.setSelectionRange(box.value.length, box.value.length); }
    }
    // (As it was scrolled; a tree just opened: at the first items still to come.)
    const start = Number(this.el.querySelector<HTMLElement>('.tree')?.dataset['start'] ?? 0);
    this.el.scrollLeft = fresh ? start : left;
    this.el.scrollTop = fresh ? 0 : top;
  }

  // The empty policy slots the civ could fill.
  private freeSlots(): number {
    const p = this.me, have = new Set(SLOT_KINDS.flatMap((s) => p.policies[s]));
    const spare = this.game.policiesOf(p).filter((k) => !have.has(k));
    return SLOT_KINDS.reduce((n, s) => n + p.policies[s].filter((x) => x === null).length * (spare.some((k) => fits(k, s)) ? 1 : 0), 0);
  }

  private act(el: HTMLElement): void {
    const g = this.game, p = this.me, d = el.dataset;
    this.notice = '';
    switch (d['do']) {
      case 'close': this.close(); return;
      case 'findPrev': this.findStep(-1); return;
      case 'findNext': this.findStep(1); return;
      case 'sort': {
        // (The same column again: the other way. A new one: figures from the largest, names from A.)
        const id = d['table'] ?? '', col = Number(d['col']), was = this.sorts.get(id);
        this.sorts.set(id, { col, down: was?.col === col ? !was.down : d['fig'] === '1' });
        break;
      }
      case 'tab': if (this.open) { if (d['tab'] === 'from') this.sources.add(this.open); else this.sources.delete(this.open); } break;
      case 'tech': g.setResearch(p, d['key'] as TechKey); break;
      case 'politics': g.setPolitics(p, d['key'] as PoliticsKey); break;
      case 'trait': { const k = d['key'] ?? ''; if (isTraitKey(k) && !g.adoptTrait(p, k)) this.notice = 'Not enough identity points yet.'; break; }
      case 'gov': g.setGovernment(p, d['key'] as GovernmentKey); break;
      case 'stateReligion': { const k = d['key'] ?? ''; const why = g.stateBlock(p, k === '' ? null : k as ReligionKey); if (why) this.notice = why; else g.setStateReligion(p, k === '' ? null : k as ReligionKey); break; }
      case 'govTab': this.govTab = d['tab'] as GovTab; this.target = null; break;
      case 'filter': this.filter = d['kind'] as PolicyKind | 'all'; break;
      case 'slot': {
        // A filled slot: take its policy out. An empty one: the next card goes there.
        const slot = d['slot'] as PolicySlot, i = Number(d['i']);
        if (p.policies[slot][i]) { g.setPolicy(p, slot, i, null); this.target = null; }
        else { this.target = { slot, i }; this.govTab = 'policies'; this.filter = slot === 'wildcard' ? 'all' : slot; }
        break;
      }
      case 'card': {
        const k = d['key'] as PolicyKey;
        const at = SLOT_KINDS.find((s) => p.policies[s].includes(k));
        if (at) g.setPolicy(p, at, p.policies[at].indexOf(k), null);
        else if (this.target && fits(k, this.target.slot)) { g.setPolicy(p, this.target.slot, this.target.i, k); this.target = null; }
        else if (!g.slotPolicy(p, k)) this.notice = `No free ${policyDef(k).kind} or wildcard slot: take a policy out first, or change government.`;
        break;
      }
      case 'clearPolicies': for (const s of SLOT_KINDS) p.policies[s].forEach((_, i) => g.setPolicy(p, s, i, null)); break;
      case 'war': g.declareWar(HUMAN, Number(d['civ'])); break;
      case 'peace': g.offerPeace(HUMAN, Number(d['civ'])); break;
      case 'accept': { const from = Number(d['civ']); if (g.peaceOffers.has(`${from}>${HUMAN}`)) g.makePeace(from, HUMAN); break; }
      case 'dipTab': this.dipTab = d['tab'] as DipTab; break;
      case 'civPick': this.civ = Number(d['civ']); break;
      case 'pieces': this.pieces = d['side'] === 'get' ? 'get' : 'give'; break;
      case 'tradeWith': { const civ = Number(d['civ']), war = g.atWar(HUMAN, civ); this.draft = { civ, lasting: !war, peace: war, give: [], get: [] }; this.pieces = 'give'; this.dipTab = 'trade'; break; }
      // (Writing back: the letter turned round, what they asked as what the player gives, to be changed and sent in its place.)
      case 'letterReply': { const o = g.dealOffers[Number(d['i'])]; if (!o) return; this.draft = { civ: o.from, lasting: [...o.give, ...o.get].some(isLasting), peace: o.peace === true, give: [...o.get], get: [...o.give], reply: o }; this.pieces = 'give'; break; }
      case 'letterBack': this.draft = null; break;
      case 'tradeKind': if (this.draft && !this.draft.peace) { this.draft.lasting = d['kind'] === 'lasting'; this.draft.give = []; this.draft.get = []; } break;
      case 'tradeItem': {
        if (!this.draft) return;
        const item = JSON.parse(d['item'] ?? 'null') as Item | null, side = d['side'] === 'give' ? 'give' : 'get';
        if (!item) return;
        // (What binds both sides goes on both, and comes off both.)
        for (const list of isMutual(item) ? [this.draft.give, this.draft.get] : [this.draft[side]]) {
          const at = list.findIndex((x) => sameItem(x, item));
          if (at >= 0) list.splice(at, 1); else list.push(item);
        }
        break;
      }
      case 'tradeGold': {
        if (!this.draft) return;
        const list = this.draft[d['side'] === 'give' ? 'give' : 'get'], k = this.draft.lasting ? 'goldPerTurn' : 'gold';
        const at = list.findIndex((x) => x.k === k), was = at >= 0 ? (list[at] as { n: number }).n : 0, n = Math.max(0, was + Number(d['n']));
        if (at >= 0) list.splice(at, 1);
        if (n > 0) list.push({ k, n });
        break;
      }
      case 'tradeCancel': this.draft = null; break;
      case 'tradePropose': {
        if (!this.draft) return;
        const o = this.draftOffer(this.draft), who = g.players[this.draft.civ]!.name, reply = this.draft.reply;
        if (g.offerBlock(o) !== null) { this.notice = g.offerBlock(o) ?? ''; break; }
        // (A counter-proposal sent: their own letter is set aside, as one declined.)
        if (reply) { const at = g.dealOffers.indexOf(reply); if (at >= 0) g.answerOffer(at, false); delete this.draft.reply; }
        const r = g.propose(o);
        if (r === 'signed') { this.draft = null; this.notice = `The ${who} signed.`; }
        else this.notice = r === 'blocked' ? g.offerBlock(o) ?? '' : `The ${who} decline, for this turn: a better offer may change their mind, or another turn.`;
        break;
      }
      case 'dealAnswer': { const o = g.dealOffers[Number(d['i'])], yes = d['yes'] === '1'; if (o && g.answerOffer(Number(d['i']), yes)) this.notice = `Signed with the ${g.players[o.from]!.name}.`; break; }
      case 'treatyEnd': { const t = g.deals[Number(d['i'])]; if (t && !g.cancelTreaty(t, HUMAN)) this.notice = `A deal runs ${DEAL_MIN} turns before either side may end it.`; break; }
      case 'ballot': g.ballot = d['civ'] === '' ? null : Number(d['civ']); break;
      default: return;
    }
    this.changed();
  }

  // ---- pages ----

  // (A sheet's title is its ministry's: Education for research, Justice for politics, Internal and External
  // Affairs for government and diplomacy. The top bar and the tabs keep the short names.)
  private page(k: SheetKind): [string, string, string] {
    const p = this.me;
    switch (k) {
      case 'economy': {
        const l = p.ledger, net = Math.round(l.income.gold + l.tithes + l.trade - l.cityUpkeep - l.unitUpkeep);
        return ['Economy', `${p.gold} gold in the treasury · ${net >= 0 ? '+' : ''}${net} a turn`, this.economyHtml()];
      }
      case 'resources': return ['Resources', `${RESOURCE_KEYS.filter((k) => resourceDef(k).kind === 'strategic' && this.game.resourceSources(HUMAN, k) > 0).length} strategic · ${this.game.luxuriesOf(HUMAN).length} luxuries`, this.resourcesHtml()];
      case 'cities': {
        const mine = this.game.cities.filter((c) => c.owner === HUMAN), pop = mine.reduce((a, c) => a + c.pop, 0);
        return ['Cities', `${mine.length === 1 ? '1 city' : `${mine.length} cities`} · ${pop} ${pop === 1 ? 'citizen' : 'citizens'}`, this.citiesHtml()];
      }
      case 'victory': return ['Victory', `Turn ${this.game.turn} of ${this.game.turnLimit} · ${Math.max(0, this.game.turnLimit - this.game.turn)} left`, this.victoryHtml()];
      case 'research': return ['Education', this.trackSub('tech'), this.treeHtml('tech')];
      case 'politics': return ['Justice', this.trackSub('politics'), this.treeHtml('politics')];
      case 'identity': return ['Identity', `${Math.floor(p.identityPoints)} identity points · next trait ${this.game.nextTraitCost(p)} · ${p.ledger.income.culture} culture a turn`, this.identityHtml()];
      case 'government': return ['Internal Affairs', governmentDef(p.government).name, this.governmentHtml()];
      case 'religion': return ['Religion', `${this.game.religions.size} of ${RELIGION_KEYS.length} founded`, this.religionHtml()];
      case 'diplomacy': return ['External Affairs', 'Relations with the civilizations you have met', this.diplomacyHtml()];
    }
  }

  private trackSub(k: 'tech' | 'politics'): string {
    const p = this.me, rate = k === 'tech' ? p.ledger.income.science : p.ledger.income.cohesion;
    const on = k === 'tech' ? (p.research ? techDef(p.research).name : null) : (p.studying ? politicsDef(p.studying).name : null);
    return `${on ? `On ${esc(on)}` : 'Nothing chosen'} · ${rate} ${k === 'tech' ? 'science' : 'cohesion'} a turn · click any item to work toward it`;
  }

  // What a tech or politics item unlocks and gives, each a named chip, a
  // colour to a kind (game.css .node .u: a unit red, a building grey, a
  // wonder gold, a government purple, a policy tan, an unlock teal, a
  // yield green): a unit, a building, a wonder, a government, a policy by their own signs;
  // an open padlock for everything else it makes possible (an improvement
  // to build, a resource to see, land units at sea); a yield's sign for
  // what it adds.
  private unlockChips(kind: 'tech' | 'politics', k: string): Chip[] {
    const d: TechDef | PoliticsDef = kind === 'tech' ? techDef(k as TechKey) : politicsDef(k as PoliticsKey);
    const fx: readonly Effect[] = 'effects' in d ? d.effects ?? [] : [];
    // (The improvements this is the first tech of: it lets them be built.)
    const builds = kind === 'tech' ? IMPROVEMENT_KEYS.filter((i) => STAGE_TECHS(i)[0] === k) : [];
    const lock = (name: string, sub: string): Chip => ({ cls: 'l', ic: icon('unlock'), name, sub });
    return [
      ...(d.units ?? []).map((u) => ({ cls: 'n', ic: icon(unitIcon(u)), name: UNITS[u].name, sub: unitDef(u).desc ?? 'Unit' })),
      ...(d.buildings ?? []).map((b) => ({ cls: 'b', ic: icon('building'), name: BUILDINGS[b].name, sub: BUILDINGS[b].desc })),
      ...(d.wonders ?? []).map((w) => ({ cls: 'w', ic: icon('star'), name: WONDERS[w].name, sub: `Wonder · ${WONDERS[w].desc}` })),
      ...('governments' in d ? (d.governments ?? []).map((x) => ({ cls: 'g', ic: icon('government'), name: governmentDef(x).name, sub: `Government · ${describeAll(governmentDef(x).effects)}` })) : []),
      ...('policies' in d ? (d.policies ?? []).map((x) => ({ cls: 'p', ic: icon('politics'), name: policyDef(x).name, sub: `${KIND_NAME[policyDef(x).kind]} policy · ${describeAll(policyDef(x).effects)}` })) : []),
      ...builds.map((i) => {
        const gives = fx.filter((e) => e.k === 'improvement' && e.imp === i).map(describeEffect).join('; ');
        return lock(`Build ${plural(IMPROVEMENTS[i].name)}`, `${plural(IMPROVEMENTS[i].name)} can be built${gives ? ` · ${gives}` : ''}`);
      }),
      ...(k === EMBARK_TECH ? [lock('Land units embark', 'Your land units can take to the shallows and the lakes, and workers build fishing boats from the water they float on')] : []),
      ...(k === OCEAN_TECH ? [lock('The deep ocean', 'Your ships and embarked units can cross the deep ocean')] : []),
      ...(kind === 'tech' ? RESOURCE_KEYS.filter((r) => resourceDef(r).reveal === k).map((r) => lock(`Reveals ${resourceDef(r).name}`, 'A strategic resource, hidden until now')) : []),
      ...fx.filter((e) => !(e.k === 'improvement' && builds.includes(e.imp))).map((e) => this.effectChip(e)),
    ];
  }
  // What an item adds, as a chip under its yield's sign (one yield on an improvement: said short).
  private effectChip(e: Effect): Chip {
    const text = describeEffect(e);
    const ys = e.k === 'yield' ? [e.y] : 'o' in e ? OUTPUT_KEYS.filter((y) => e.o[y] !== 0) : [];
    const y = ys[0];
    const name = e.k === 'improvement' && y && ys.length === 1 ? `${e.o[y] > 0 ? '+' : ''}${e.o[y]} per ${IMPROVEMENTS[e.imp].name}` : text;
    return { cls: 'e', ic: icon(y ? YIELD_ICON[y] : 'up'), name, sub: text };
  }
  // A plate's chips, drawn: all of them if they fit its rows, or as many as do and a count of the rest.
  private chipsHtml(chips: readonly Chip[]): { html: string; rows: number } {
    const width = (c: Chip) => Math.min(CHIP_ROOM, CHIP_PAD + CHIP_CH * c.name.length);
    let n = chips.length;
    while (n > 0 && chipRows([...chips.slice(0, n).map(width), ...(n < chips.length ? [MORE_W] : [])]) > CHIP_ROWS) n--;
    const shown = chips.slice(0, n), rest = chips.slice(n);
    const html = shown.map((c) => `<span class="u ${c.cls}" data-f="${esc(`${c.name} ${c.sub}`.toLowerCase())}" ${tip(esc(c.name), esc(c.sub))}>${c.ic}<span>${esc(c.name)}</span></span>`).join('')
      + (rest.length ? `<span class="u more" ${tip(`${rest.length} more`, esc(rest.map((c) => c.name).join(' · ')))}>+${rest.length}</span>` : '');
    return { html, rows: chipRows([...shown.map(width), ...(rest.length ? [MORE_W] : [])]) };
  }

  // A tree: an era to a band, in it a column to each depth (each item one
  // column after the deepest it needs); down a column the items sit near
  // the ones they rest on, so the lines between them (drawn behind, from
  // the same layout) stay short and cross little.
  private treeHtml(kind: 'tech' | 'politics'): string {
    const p = this.me;
    const keys: readonly string[] = kind === 'tech' ? TECH_KEYS : POLITICS_KEYS;
    const def = (k: string): TechDef | PoliticsDef => (kind === 'tech' ? techDef(k as TechKey) : politicsDef(k as PoliticsKey));
    const depth = new Map<string, number>();
    const depthOf = (k: string): number => {
      const known = depth.get(k);
      if (known !== undefined) return known;
      const needs: readonly string[] = def(k).needs;
      const d = needs.length ? 1 + Math.max(...needs.map((n) => depthOf(n))) : 0;
      depth.set(k, d);
      return d;
    };
    // (Each era begins after the last column of the eras before it.)
    const col = new Map<string, number>();
    const bands: { era: EraIndex; from: number; to: number }[] = [];
    let start = 0;
    for (let e = 0; e < ERAS.length; e++) {
      const ks = keys.filter((k) => def(k).era === e);
      if (!ks.length) continue;
      const base = Math.min(...ks.map(depthOf));
      for (const k of ks) col.set(k, Math.max(start, start + depthOf(k) - base));
      const end = Math.max(...ks.map((k) => col.get(k)!)) + 1;
      bands.push({ era: e as EraIndex, from: start, to: end });
      start = end;
    }
    const cols: string[][] = [];
    for (const k of keys) (cols[col.get(k)!] ??= []).push(k);
    // Rows: down each column in the order of what its items rest on, each
    // as near the middle of those as the ones above it leave room for.
    const row = new Map<string, number>();
    for (const ks of cols) {
      if (!ks) continue;
      const want = new Map(ks.map((k, i) => {
        const needs: readonly string[] = def(k).needs;
        return [k, needs.length ? needs.reduce((a, n) => a + (row.get(n) ?? 0), 0) / needs.length : i];
      }));
      const order = [...ks].sort((a, b) => want.get(a)! - want.get(b)!);
      let last = -1;
      const at = order.map((k) => (last = Math.max(last + 1, Math.round(want.get(k)!))));
      // (Pushed down as a block by the crowd: moved back up by as much, not past the top.)
      const drift = Math.min(at[0]!, Math.max(0, Math.round(order.reduce((a, k, i) => a + at[i]! - want.get(k)!, 0) / order.length)));
      order.forEach((k, i) => row.set(k, at[i]! - drift));
    }
    // (Every plate as tall as the fullest one's chips ask.)
    const chips = new Map(keys.map((k) => [k, this.unlockChips(kind, k)]));
    const drawn = new Map(keys.map((k) => [k, this.chipsHtml(chips.get(k)!)]));
    const NODE_H = 44 + 26 * Math.max(1, ...keys.map((k) => drawn.get(k)!.rows));
    const x = (c: number) => TREE_PAD + c * (NODE_W + GAP_X), y = (r: number) => TREE_TOP + r * (NODE_H + GAP_Y);
    const known = kind === 'tech' ? p.techs as ReadonlySet<string> : p.politics as ReadonlySet<string>;
    const current = kind === 'tech' ? p.research : p.studying;
    const order: readonly string[] = kind === 'tech' ? p.researchQueue : p.politicsQueue, queue = new Set<string>(order);
    const progress = (k: string) => (kind === 'tech' ? p.techProgress[k as TechKey] : p.politicsProgress[k as PoliticsKey]) ?? 0;
    const rate = kind === 'tech' ? p.ledger.income.science : p.ledger.income.cohesion;
    const unit = kind === 'tech' ? 'science' : 'cohesion';
    // (What it costs at the game's pace.)
    const cost = (k: string): number => this.game.paced(def(k).cost);
    const node = (k: string): string => {
      const d = def(k), done = known.has(k);
      const ready = (d.needs as readonly string[]).every((n) => known.has(n));
      const cls = done ? 'done' : k === current ? 'current' : queue.has(k) ? 'queued' : ready ? '' : 'locked';
      const mine = chips.get(k)!;
      // (Its place in what is being worked toward: 1 now, then the queue.)
      const place = k === current ? 1 : queue.has(k) ? order.indexOf(k) + 2 : 0;
      const fx = 'effects' in d ? (d.effects ?? []).map(describeEffect).join(' · ') : '';
      const pathCost = done ? 0 : (kind === 'tech' ? techPath(k as TechKey, p.techs) : politicsPath(k as PoliticsKey, p.politics) as string[])
        .reduce((s, n) => s + cost(n) - progress(n), 0);
      const turns = done ? '' : rate > 0 ? `${Math.max(1, Math.ceil(pathCost / rate))} turns` : '—';
      const bar = !done && progress(k) > 0 ? `<div class="bar ${kind === 'tech' ? 'sci' : 'coh'}"><i style="width:${(100 * progress(k) / cost(k)).toFixed(1)}%"></i></div>` : '';
      const state = done ? 'Known' : k === current ? 'Being worked on' : queue.has(k) ? 'Queued' : ready ? 'Click to work on it' : 'Click to work toward it, through what it needs';
      return `<div class="node ${cls}" style="left:${x(col.get(k)!)}px;top:${y(row.get(k)!)}px;width:${NODE_W}px;height:${NODE_H}px" data-node="${k}" data-find="${esc(`${d.name} ${mine.map((c) => `${c.name} ${c.sub}`).join(' ')}`.toLowerCase())}" ${done ? '' : `data-do="${kind}" data-key="${k}"`}
        ${tip(esc(d.name), `${cost(k)} ${unit}${fx ? ` · ${esc(fx)}` : ''} · ${state}`)}>
        <div class="name">${place ? `<i class="ord">${place}</i>` : ''}<span>${esc(d.name)}</span><small>${turns}</small></div>
        <div class="unl">${drawn.get(k)!.html}</div>${bar}</div>`;
    };
    // The lines: out of an item along its row, down (or up) the gap before
    // the item that needs it, and in: all at one distance before the items
    // of a column, so they run there one over another, as a single line.
    // (Drawn in this order, each over the last: the plain ones, those of what is known, those on the way to what is worked toward.)
    const links: [number, string][] = [];
    for (const k of keys) {
      const x2 = x(col.get(k)!), y2 = y(row.get(k)!) + NODE_H / 2, lane = x2 - LANE_BACK;
      for (const n of def(k).needs as readonly string[]) {
        const x1 = x(col.get(n)!) + NODE_W, y1 = y(row.get(n)!) + NODE_H / 2;
        const r = Math.min(7, Math.abs(y2 - y1) / 2), dir = Math.sign(y2 - y1);
        const d = dir === 0 ? `M${x1},${y1} H${x2}`
          : `M${x1},${y1} H${lane - r} Q${lane},${y1} ${lane},${y1 + dir * r} V${y2 - dir * r} Q${lane},${y2} ${lane + r},${y2} H${x2}`;
        const on = (k === current || queue.has(k)) && (n === current || queue.has(n));
        links.push([on ? 2 : known.has(n) ? 1 : 0, `<path class="${known.has(n) ? 'done' : on ? 'on' : ''}" data-a="${n}" data-b="${k}" d="${d}"/>`]);
      }
    }
    const rows = Math.max(...keys.map((k) => row.get(k)!)) + 1;
    const width = x(cols.length) - GAP_X + TREE_PAD, height = y(rows) + 10;
    const bandHtml = bands.map((b) => `<div class="band" style="left:${x(b.from) - GAP_X / 2}px;width:${(b.to - b.from) * (NODE_W + GAP_X)}px"><span>${ERAS[b.era].name}</span></div>`).join('');
    // (Opened at the first column with something still to learn.)
    const first = Math.min(...keys.filter((k) => !known.has(k)).map((k) => col.get(k)!), cols.length - 1);
    return `<div class="tree ${kind}" data-tree="${kind}" data-start="${Math.max(0, x(first) - 80)}" style="width:${width}px;height:${height}px">${bandHtml}
      <svg class="links" width="${width}" height="${height}">${links.sort((a, b) => a[0] - b[0]).map((l) => l[1]).join('')}</svg>${keys.map(node).join('')}</div>`;
  }

  // ---- identity ----

  private identityHtml(): string {
    const g = this.game, p = this.me, have = p.identity, founded = g.founded();
    const lv = pathLevels(have), afford = p.identityPoints >= g.nextTraitCost(p);
    const name = epithet(have);
    // A pair as a slider: the left path's traits fill its slots from the
    // left, the right one's from the right; the rest are open to either.
    const slider = (a: PathKey): string => {
      const b = PATHS[a].opposite;
      const cells = Array.from({ length: PAIR_SLOTS }, (_, i) => `<i class="${i < lv[a] ? 'a' : i >= PAIR_SLOTS - lv[b] ? 'b' : ''}"></i>`).join('');
      return `<div class="slider"><span>${PATHS[a].name} <b>${lv[a]}</b></span><div class="cells">${cells}</div><span><b>${lv[b]}</b> ${PATHS[b].name}</span></div>`;
    };
    // (Devotion last: with its faiths it is the tallest.)
    const PAIRS = ['martial', 'commerce', 'frontier', 'maritime', 'devotion'] as const;
    const profile = PAIRS.map(slider).join('');
    const traitNode = (k: TraitKey): string => {
      const d = traitDef(k), block = traitBlock(k, have, p.era, founded);
      const cls = have.has(k) ? 'adopted' : block ? `blocked ${block}` : afford ? 'open' : 'wait';
      const why = block && block !== 'adopted' ? BLOCK_TEXT[block] : !afford && !have.has(k) ? `Needs ${g.nextTraitCost(p)} identity points` : '';
      const rel = d.religion ? `<div class="tag ${founded.has(d.religion) && !have.has(k) ? 'taken' : ''}">Founds ${religionDef(d.religion).name}</div>` : '';
      return `<div class="trait ${cls}" ${!block && afford ? `data-do="trait" data-key="${k}"` : ''} ${why ? tip(esc(d.name), esc(why)) : ''}>
        <div class="name">${esc(d.name)}<small>${ERAS[d.era].name}</small></div><div class="fx">${esc(describeAll(d.effects))}</div>${rel}</div>`;
    };
    const column = (k: PathKey): string => {
      const ts = pathTraits(k);
      const tiers = [0, 1, 2, 3, 4, 5].map((tier) => {
        const row = ts.filter((x) => traitDef(x).tier === tier);
        return `<div class="tier ${tier === 3 ? 'fork' : ''}">${row.map(traitNode).join(tier === 3 ? '<span class="or">or</span>' : '')}</div>`;
      }).join('');
      const faiths = k === 'devotion'
        ? `<div class="faiths"><div class="label">Faiths <small>· adopt one; the first to adopt one founds it</small></div>${FAITH_KEYS.map(traitNode).join('')}</div>` : '';
      return `<div class="path"><div class="phead"><b>${PATHS[k].name}</b><small>${esc(PATHS[k].desc)}</small><small>${openSlots(k, have) - lv[k]} of ${PAIR_SLOTS} slots open</small></div>${tiers}${faiths}</div>`;
    };
    const pairs = PAIRS.map((k) =>
      `<div class="pair"><div class="pslider">${slider(k)}</div>${column(k)}<div class="vs">⟷</div>${column(PATHS[k].opposite)}</div>`).join('');
    return `<p class="note">Identity is who your people are, and it is for good. Culture earns identity points; each trait costs more than the last, and your people take ${MAX_TRAITS} at most. Paths come in opposed pairs, each a slider of ${PAIR_SLOTS} slots shared by both sides: every trait taken on one side closes the last open slot of the other, so you may go all the way down one path, or part of the way down both. A trait needs one of the tier above it in its path and the era it belongs to; the Renaissance tier is a fork: one of its two traits closes the other.</p>
      <div class="profile"><div class="who"><span class="label">Your people</span><b>${name ? `${esc(name)} ${esc(p.name)}` : `${esc(p.name)} <small>· no traits yet</small>`}</b><small>${have.size} of ${MAX_TRAITS} traits · ${Math.floor(p.identityPoints)} points · next ${g.nextTraitCost(p)}</small></div><div class="levels">${profile}</div></div>
      ${this.notice ? `<p class="notice">${esc(this.notice)}</p>` : ''}
      <div class="pairs">${pairs}</div>`;
  }

  // ---- government ----

  private governmentHtml(): string {
    // (Its three tabs stand beside its title: render.)
    const body = this.govTab === 'mine' ? this.myGovernmentHtml() : this.govTab === 'policies' ? this.policiesHtml() : this.governmentsHtml();
    return `${this.notice ? `<p class="notice">${esc(this.notice)}</p>` : ''}${body}`;
  }

  private policyCard(k: PolicyKey, extra = ''): string {
    const d = policyDef(k);
    return `<div class="pcard ${d.kind} ${extra}" data-do="card" data-key="${k}"><div class="kind">${KIND_NAME[d.kind]}</div><b>${esc(d.name)}</b><div class="fx">${esc(describeAll(d.effects))}</div></div>`;
  }
  // The government's slots, row by kind: a card in each filled one (click:
  // out), an empty one to pick (click: its cards).
  private slotsHtml(compact: boolean): string {
    const p = this.me;
    return SLOT_KINDS.map((s) => {
      const n = p.policies[s].length;
      const cells = n ? p.policies[s].map((k, i) => {
        const picked = this.target?.slot === s && this.target.i === i;
        return k ? `<div class="cell" data-do="slot" data-slot="${s}" data-i="${i}" ${tip('Click to take it out')}>${this.policyCard(k, 'slotted')}</div>`
          : `<div class="cell empty ${picked ? 'picked' : ''}" data-do="slot" data-slot="${s}" data-i="${i}">${picked ? 'Pick a card →' : 'Empty slot'}</div>`;
      }).join('') : `<div class="none">No ${KIND_NAME[s].toLowerCase()} slots in this government</div>`;
      return `<div class="srow ${s} ${compact ? 'compact' : ''}"><div class="slabel"><span class="label">${KIND_NAME[s]}</span><small>${n}</small></div><div class="cells">${cells}</div></div>`;
    }).join('');
  }
  private govCard(k: GovernmentKey, current: boolean, open: boolean): string {
    const d = governmentDef(k);
    const pips = SLOT_KINDS.flatMap((s) => Array.from({ length: d.slots[s] }, () => `<i class="${s}" ${tip(`${KIND_NAME[s]} slot`)}></i>`)).join('');
    const from = POLITICS_KEYS.find((c) => (politicsDef(c).governments ?? []).includes(k));
    const action = current ? '<span class="pill">Current</span>' : open ? `<button data-do="gov" data-key="${k}">Adopt</button>` : `<small>Needs ${from ? esc(politicsDef(from).name) : '—'}</small>`;
    return `<div class="govcard ${current ? 'current' : ''} ${open ? '' : 'locked'}"><div class="ghead"><b>${esc(d.name)}</b>${d.tier ? `<small>Tier ${TIER_NAME[d.tier]}</small>` : ''}</div>
      <div class="pips">${pips || '<small>no slots</small>'}</div><div class="fx">${d.effects.length ? esc(describeAll(d.effects)) : 'No bonus'}</div><div class="gfoot">${action}</div></div>`;
  }
  private myGovernmentHtml(): string {
    const p = this.me;
    return `<div class="govmine"><div class="left">${this.govCard(p.government, true, true)}
      <p class="note">Governments and policies can be changed at any time, for free: policies that no longer fit are taken out. Click an empty slot to choose its card; click a card to take it out.</p></div>
      <div class="right">${this.slotsHtml(false)}</div></div>`;
  }
  private policiesHtml(): string {
    const g = this.game, p = this.me;
    const have = new Set(g.policiesOf(p)), used = new Set(SLOT_KINDS.flatMap((s) => p.policies[s]));
    const chips = (['all', ...POLICY_KINDS] as const).map((k) => `<button class="${this.filter === k ? 'active' : ''}" data-do="filter" data-kind="${k}">${k === 'all' ? 'All' : KIND_NAME[k]} <small>${POLICY_KEYS.filter((x) => have.has(x) && (k === 'all' || policyDef(x).kind === k)).length}</small></button>`).join('');
    const cards = POLICY_KEYS.filter((k) => have.has(k) && (this.filter === 'all' || policyDef(k).kind === this.filter))
      .map((k) => this.policyCard(k, `${used.has(k) ? 'inuse' : ''} ${this.target && !fits(k, this.target.slot) ? 'nofit' : ''}`)).join('');
    const locked = POLICY_KEYS.length - have.size;
    return `<div class="govpolicies"><div class="left">${this.slotsHtml(true)}<div class="buttons"><button data-do="clearPolicies">Clear all</button></div></div>
      <div class="right"><div class="chips">${chips}</div>
        <div class="cards">${cards || '<p class="note">No policies of this kind yet: politics unlock them.</p>'}</div>
        <p class="note">${locked} more policies to unlock through politics. Click a card to put it in a free slot of its kind (or a wildcard); click it again to take it out.</p></div></div>`;
  }
  private governmentsHtml(): string {
    const p = this.me, have = this.game.governmentsOf(p);
    const cols = ([0, 1, 2, 3] as const).map((tier) => {
      const ks = GOVERNMENT_KEYS.filter((k) => governmentDef(k).tier === tier);
      return `<div class="gcol"><div class="era">${tier ? `Tier ${TIER_NAME[tier]}` : 'First'}</div>${ks.map((k) => this.govCard(k, p.government === k, have.includes(k))).join('')}</div>`;
    }).join('');
    return `<div class="gcols">${cols}</div>`;
  }

  // The rules in three short parts; the state's religion, to choose; then
  // a card to each religion: its faith, who founded it and holds its holy
  // city, how far it has gone (a founded one lit); and the player's cities.
  private religionHtml(): string {
    const g = this.game, p = this.me;
    const cards = RELIGION_KEYS.map((r) => {
      const d = religionDef(r), f = g.religions.get(r);
      const holy = f?.holyCity != null ? g.cityById.get(f.holyCity) : undefined;
      const fol = g.followers(r);
      const by = f ? g.players[f.founder]! : null, seat = holy ? g.players[holy.owner]! : null;
      const states = g.players.filter((o) => o.alive && o.stateReligion === r && (o.id === p.id || g.met[p.id]![o.id]));
      const state = by ? `<span><span class="swatch" style="background:${by.color}"></span>Founded by ${by.id === p.id ? 'you' : `the ${esc(by.name)}`}</span>${holy && seat ? `<span>Holy city ${esc(holy.name)}${seat.id !== by.id ? ` (held by ${seat.id === p.id ? 'you' : `the ${esc(seat.name)}`})` : ''}</span>` : ''}<span>${fol.cities === 1 ? '1 city holds it' : `${fol.cities} cities hold it`} · ${Math.round(100 * fol.share)}% of the world's people</span>${states.length ? `<span>State religion of ${states.map((o) => (o.id === p.id ? 'yours' : `the ${esc(o.name)}`)).join(', ')}</span>` : ''}`
        : '<span>Not yet founded</span>';
      return `<div class="rcard ${f ? 'founded' : ''}"><div class="rhead"><span class="seal" style="background:${d.color}"></span><div><b>${d.name}</b><small>Faith: ${esc(traitDef(traitOfReligion(r)).name)}</small></div></div>
        <div class="rbonus"><small>${esc(d.temple)} · ${esc(d.cathedral)}</small></div><div class="rfoot">${state}</div></div>`;
    }).join('');
    const mine = g.cities.filter((c) => c.owner === p.id);
    const cities = mine.length ? mine.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.religions.size ? [...c.religions].map((r) => `${religionDef(r).name}${p.stateReligion === r ? ' <small>state</small>' : ''}`).join(', ') : '<small>none</small>'}</td><td>${bonusStr(g.religionYield(c)) || '<small>—</small>'}</td></tr>`).join('') : '';
    const n = RELIGION_KEYS.length;
    return `<div class="page"><div class="rules"><div><h4>Founding</h4><p>A religion is founded by the first civilization to adopt its faith, a trait of the Devotion path of identity (Meditation founds Hinduism). A civilization adopts one faith at most. Its capital becomes the holy city; whoever holds a holy city takes ${TITHE} gold a turn from every city in the world that holds its religion.</p></div>
      <div><h4>Spreading</h4><p>A city holds any number of religions and never loses one. A religion comes to a city by a missionary and no other way. A missionary's preaching takes ${spreadChance(0, true)} times in 100 in a city with no religion; ${spreadChance(1, true)} in a city of your own that holds one already, ${spreadChance(2, true)} with two, down to ${spreadChance(n - 1, true)} with ${n - 1}; in another civilization's city ${spreadChance(1, false)}, ${spreadChance(2, false)}, down to ${spreadChance(n - 1, false)}. The missionary is spent either way.</p></div>
      <div><h4>The state</h4><p>Every religion gives the same. Under a state religion each of your cities that holds it makes ${bonusStr(out(STATE_BONUS))}. In a secular state each city makes ${bonusStr(out(SECULAR_BONUS))} for every religion it holds past its first: the same with three, and worth more once your cities hold four each. Civilizations of one state religion think the better of each other; of rival ones, the worse.</p></div>
      <div><h4>Buildings</h4><p>Each religion has its own temple (${techDef(TEMPLE_TECH).name}) and cathedral (${techDef(CATHEDRAL_TECH).name}), built in a city that holds it: a city of three religions may build all three. Faith buys them, a Shrine, missionaries and, under a state religion, fighting units.</p></div></div>
      ${this.stateHtml()}
      <h3>Religions</h3><div class="rcards">${cards}</div>
      ${this.convertHtml()}
      ${cities ? `<h3>Your cities</h3><table class="grid"><tr><th>City</th><th>Holds</th><th>Makes of them now</th></tr>${cities}</table>` : ''}</div>`;
  }

  // The state's religion: what each choice would bring now, and the button to make it.
  private stateHtml(): string {
    const g = this.game, p = this.me;
    const now = g.stateWorth(p.id, p.stateReligion);
    const card = (r: ReligionKey | null): string => {
      const cur = p.stateReligion === r, why = cur ? null : g.stateBlock(p, r), y = g.stateWorth(p.id, r);
      const held = r ? g.cities.filter((c) => c.owner === p.id && c.religions.has(r)).length : g.cities.filter((c) => c.owner === p.id).reduce((s, c) => s + c.religions.size, 0);
      const diff = (y.culture + y.cohesion) - (now.culture + now.cohesion);
      const sharing = r ? g.players.filter((o) => o.alive && o.id !== p.id && g.met[p.id]![o.id] && o.stateReligion === r).map((o) => esc(o.name)) : [];
      return `<div class="rcard ${cur ? 'founded' : ''}"><div class="rhead"><span class="seal" style="background:${r ? religionDef(r).color : '#b9b5ac'}"></span><div><b>${r ? religionDef(r).name : 'Secular'}</b><small>${r ? `${held} of your cities hold it` : `${held} religions held across your cities (each city's first counts for nothing)`}</small></div></div>
        <div class="rbonus">${bonusStr(y) || 'nothing yet'}<small>a turn in all${cur ? '' : diff ? ` (${diff > 0 ? '+' : ''}${diff} on now)` : ' (as now)'}</small></div>
        <div class="rfoot">${sharing.length ? `<span>Shared with the ${sharing.join(', ')}</span>` : ''}${cur ? '<span><b>Your state now</b></span>' : `<button data-do="stateReligion" data-key="${r ?? ''}" class="${why ? 'off' : ''}" ${why ? `title="${esc(why)}"` : ''}>${r ? 'Make it the state religion' : 'Become secular'}</button>`}</div></div>`;
    };
    const warn = p.conversion > 0 ? `Your people are unsettled by the last change: ${Math.round(100 * CONVERSION_COST)}% less cohesion for ${p.conversion} more turns, and no new change until then.`
      : g.conversionCosts(p) ? `Changing it unsettles your people: your cities make ${Math.round(100 * CONVERSION_COST)}% less cohesion for ${CONVERSION_TURNS} turns.` : 'Your first state religion costs nothing; every change after it unsettles your people for a while.';
    return `<h3>The state</h3><p class="note">${warn}</p><div class="rcards">${[null, ...g.stateOptions(p.id)].map(card).join('')}</div>`;
  }

  // What faith does: missionaries.
  private convertHtml(): string {
    const g = this.game;
    const out = g.units.filter((u) => u.owner === HUMAN && u.type === 'missionary').length;
    return `<h3>Missionaries</h3><p class="note">You raise a missionary of a religion with faith (${g.missionaryCostOf(HUMAN)}; you have ${this.me.faith}) in a city of yours that holds it: the buttons are in the city's panel. At most ${MISSIONARIES_MOST} of a religion out at once. It goes where you send it, over land and sea, and preaches in a city it stands in or beside, anyone's you are not at war with.${out ? ` You have ${out} on the map.` : ''}</p>`;
  }

  private diplomacyHtml(): string {
    const g = this.game;
    const others = g.players.filter((o) => o.id !== HUMAN && o.alive && g.met[HUMAN]![o.id]);
    if (!others.length) return '<p class="note">You have not met another civilization yet. Civilizations meet when their units or cities come within sight of each other.</p>';
    return this.dipTab === 'relations' ? this.relationsHtml(others) : this.dipTab === 'trade' ? this.lettersHtml(others) : this.dipTab === 'deals' ? this.agreementsHtml() : this.dipTab === 'un' ? this.unHtml() : this.civsHtml(others);
  }

  // The civilizations met, in a list (each with its mood and what it thinks of the player, in a figure), and the one
  // picked in detail: its mood and what follows from it, where it stands on the two things the mood is read from,
  // every reason for and against, how the player compares, and what stands between the two now.
  private civsHtml(others: readonly Player[]): string {
    const g = this.game;
    if (!others.some((o) => o.id === this.civ)) this.civ = others[0]!.id;
    const o = g.players[this.civ]!;
    const num = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}`, tone = (L: number) => (L <= 1 ? 'bad' : L >= 3 ? 'good' : '');
    const list = others.map((c) => {
      const rg = regard(g, c.id, HUMAN), war = g.atWar(HUMAN, c.id);
      const ties = [g.pact(HUMAN, c.id) ? 'pact' : '', g.openBorders(HUMAN, c.id) ? 'open borders' : ''].filter(Boolean).join(', ');
      return `<button class="dl ${c.id === o.id ? 'on' : ''}" data-do="civPick" data-civ="${c.id}"><span class="seal" style="background:${c.color}"></span><span class="who"><b>${esc(c.name)}</b><small class="${war ? 'bad' : tone(rg.level)}">${war ? `At war · since turn ${g.relations[HUMAN]![c.id]!.since}` : `${MOODS[mood(g, c.id, HUMAN)].name}${ties ? ` · ${ties}` : ''}`}</small></span><b class="${tone(rg.level)}">${num(rg.total)}</b></button>`;
    }).join('');
    const r = g.relations[HUMAN]![o.id]!, war = r.war, rg = regard(g, o.id, HUMAN), pw = powerOf(g, o.id, HUMAN), md = MOODS[mood(g, o.id, HUMAN)];
    const offered = g.peaceOffers.has(`${o.id}>${HUMAN}`), wait = war ? Math.max(0, r.since + MIN_WAR - g.turn) : 0, truce = g.truceLeft(HUMAN, o.id);
    const action = !war ? `<button class="danger" data-do="war" data-civ="${o.id}" ${truce ? tip('Break the truce', `It has ${truce} turns to run: break it and your people make ${Math.round(100 * TRUCE_BREAK)}% less cohesion for as long, and they will remember it`) : g.pact(HUMAN, o.id) || g.openBorders(HUMAN, o.id) ? tip('Turn on them', 'A treaty stands between you: they, and their friends, will remember it') : ''}>Declare war${truce ? ` <small>truce: ${truce}</small>` : ''}</button>`
      : offered ? `<button class="primary" data-do="accept" data-civ="${o.id}">Accept peace</button>`
      : g.canMakePeace(HUMAN, o.id) ? `<button data-do="peace" data-civ="${o.id}">Offer peace</button>` : `<small>Peace possible in ${wait} turns</small>`;
    const known = epithet(o.identity);
    // (What follows from its regard: what it will do, and what it will not: diplomacy.ts refusal, aiVote, WAR_BY_REGARD.)
    const WILL = ['demand what it can of you; side with anyone against you', 'trade, at a steep price', 'trade fairly; open its borders; share what it knows, for a price', 'trade fairly; open its borders; swear a pact; vote for you', 'trade generously; swear a pact; vote for you'];
    const WONT = ['open its borders; share what it knows; swear a pact', 'open its borders; share what it knows; swear a pact', 'swear a pact; vote for you', 'go to war with you', 'go to war with you'];
    // (The two things the mood is read from: its regard down, how strong it finds the player across; the square it stands on marked.)
    const matrix = [4, 3, 2, 1, 0].map((L) => `<span class="${L === rg.level ? 'at' : ''}">${REGARDS[L]}</span>${[0, 1, 2, 3, 4].map((R) => `<i class="r${L} ${L === rg.level && R === pw.rank ? 'at' : ''}" ${tip(MOODS[moodOf(L as 0, R as Rank)].name, `${REGARDS[L]}, and finding you ${RANKS[R]}`)}></i>`).join('')}`).join('');
    const pos = Math.max(0, Math.min(100, 50 + (rg.total / 12) * 50));
    const side = (good: boolean) => { const xs = rg.reasons.filter((x) => (x.value > 0) === good).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)), sum = Math.round(10 * xs.reduce((n, x) => n + x.value, 0)) / 10;
      return `<div><b class="${good ? 'good' : 'bad'}">${good ? 'For you' : 'Against you'} · ${num(sum)}</b>${xs.length ? xs.map((x) => `<div class="dr"><b class="${good ? 'good' : 'bad'}">${num(x.value)}</b><span>${esc(x.text)}</span></div>`).join('') : '<div class="dr"><b></b><small>Nothing yet.</small></div>'}</div>`; };
    const next = rg.level < 4 ? `<p class="dnext"><b>${Math.round(10 * (([...REGARD_CUTS] as number[])[rg.level]! - rg.total + (rg.level < 2 ? 0.1 : 0))) / 10} more</b> would make them ${REGARDS[rg.level + 1]}.</p>` : '';
    const bars = (x: Rank) => `<span class="dbar ${x >= 3 ? 'good' : x <= 1 ? 'bad' : ''}" ${tip(RANKS[x])}>${[0, 1, 2, 3, 4].map((k) => `<i class="${k <= x ? 'on' : ''}"></i>`).join('')}</span>`;
    const ob = g.deals.find((t) => (t.a === HUMAN || t.b === HUMAN) && (t.a === o.id || t.b === o.id) && t.give.some((x) => x.k === 'openBorders'));
    const pact = g.deals.find((t) => (t.a === HUMAN || t.b === HUMAN) && (t.a === o.id || t.b === o.id) && t.give.some((x) => x.k === 'pact'));
    const metBoth = (x: Player) => x.alive && x.id !== o.id && x.id !== HUMAN && g.met[HUMAN]![x.id] && g.met[o.id]![x.id];
    const wars = g.players.filter((x) => metBoth(x) && g.atWar(o.id, x.id)).map((x) => esc(x.name)), friends = g.players.filter((x) => metBoth(x) && regard(g, o.id, x.id).level >= 3).map((x) => esc(x.name));
    const row = (a: string, b: string) => `<div><span>${a}</span><span>${b}</span></div>`;
    return `<div class="dip"><div class="dlist"><span class="label">Those you have met</span>${list}</div>
      <div class="ddetail">
        <div class="dhead"><span class="seal" style="background:${o.color}"></span><div><h3>${esc(o.name)}${known ? ` <small>${esc(known)}</small>` : ''}</h3><small>${esc(governmentDef(o.government).name)} · ${o.stateReligion ? religionDef(o.stateReligion).name : 'secular'} · ${ERAS[o.era].name} era</small></div>
          <span class="grow"></span><button data-do="tradeWith" data-civ="${o.id}">${war ? 'Write of peace' : 'Write a letter'}</button>${action}</div>
        <div class="drow">
          <div class="dbox grow"><span class="label">Their mood toward you</span><h2>${war ? 'At war' : md.name}</h2><p>${war ? `Since turn ${r.since}. ` : ''}${md.tells}</p>
            ${war ? '' : `<div class="dwill"><b class="good">will</b><span>${WILL[rg.level]}</span><b class="bad">won't</b><span>${WONT[rg.level]}</span></div>`}</div>
          <div class="dbox dmatrix"><span class="label">How they see you</span><div class="dgrid"><span></span><em>weak</em><em></em><em>even</em><em></em><em>strong</em>${matrix}</div></div>
        </div>
        <div class="drow fill">
          <div class="dbox grow"><div class="dtop"><span class="label">What they think of you</span><span><b>${REGARDS[rg.level]}</b> · ${num(rg.total)}</span></div>
            <div class="dscale2"><i style="left:${pos.toFixed(1)}%"></i></div><div class="dticks"><span>Hateful ${REGARD_CUTS[0]}</span><span>Hostile ${REGARD_CUTS[1]}</span><span>Cautious</span><span>+${REGARD_CUTS[2]} Friendly</span><span>+${REGARD_CUTS[3]} Ally</span></div>
            <div class="dsides">${side(true)}${side(false)}</div>${next}</div>
          <div class="dcol"><div class="dbox"><span class="label">How you compare <small>· they see you as ${RANKS[pw.rank]}</small></span>
              <div class="dpow2"><span>Army</span>${bars(pw.army)}<span>Production</span>${bars(pw.prod)}<span>Technology</span>${bars(pw.tech)}<span>Gold income</span>${bars(pw.gold)}</div></div>
            <div class="dbox grow"><span class="label">Between you now</span><div class="dnow">${row('Open borders', ob ? `${ob.until - g.turn} turns left` : 'none')}${row('Defensive pact', pact ? `${pact.until - g.turn} turns left` : 'none')}${row('Truce', truce ? `${truce} turns left` : 'none')}${row('Their wars', wars.join(', ') || 'none')}${row('Their friends', friends.join(', ') || 'none')}</div></div></div>
        </div>
      </div></div>`;
  }

  // Everyone the player knows of, round a regular polygon, with a line for what stands between each two: contact, war, a pact, open borders.
  private relationsHtml(others: readonly Player[]): string {
    const g = this.game, civs = [this.me, ...others], n = civs.length;
    const W = 760, H = 560, R = 205, cx = W / 2, cy = H / 2 - 6;
    const at = (i: number): [number, number] => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; };
    const lines: string[] = [];
    // (Drawn the plainest first, so a war or a pact lies over mere contact. Two lines between a pair lie side by side.)
    const kinds = [['contact', 0], ['borders', 1], ['pact', 2], ['war', 3]] as const;
    for (const [kind] of kinds) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = civs[i]!.id, b = civs[j]!.id;
      if (!g.met[a]![b]) continue;
      const has = { contact: !g.atWar(a, b) && !g.pact(a, b) && !g.openBorders(a, b), borders: g.openBorders(a, b), pact: g.pact(a, b), war: g.atWar(a, b) }[kind];
      if (!has) continue;
      const [x1, y1] = at(i), [x2, y2] = at(j);
      // (Open borders beside a pact: shifted a little to one side of it.)
      const both = kind === 'borders' && g.pact(a, b), len = Math.hypot(x2 - x1, y2 - y1), ox = both ? (-(y2 - y1) / len) * 4 : 0, oy = both ? ((x2 - x1) / len) * 4 : 0;
      lines.push(`<line class="rl ${kind}" x1="${(x1 + ox).toFixed(1)}" y1="${(y1 + oy).toFixed(1)}" x2="${(x2 + ox).toFixed(1)}" y2="${(y2 + oy).toFixed(1)}"><title>${esc(civs[i]!.name)} – ${esc(civs[j]!.name)}: ${kind === 'contact' ? 'at peace' : kind === 'borders' ? 'open borders' : kind === 'pact' ? 'defensive pact' : 'at war'}</title></line>`);
    }
    const nodes = civs.map((o, i) => {
      const [x, y] = at(i), out = 1 + 46 / R, lx = cx + (x - cx) * out, ly = cy + (y - cy) * out;
      const sub = o.id === HUMAN ? 'you' : g.atWar(HUMAN, o.id) ? 'at war with you' : MOODS[mood(g, o.id, HUMAN)].name;
      const anchor = Math.abs(x - cx) < 30 ? 'middle' : x > cx ? 'start' : 'end';
      return `<g><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="17" fill="${o.color}" class="rn"/><text x="${lx.toFixed(1)}" y="${(ly - 2).toFixed(1)}" text-anchor="${anchor}" class="rname">${esc(o.name)}</text><text x="${lx.toFixed(1)}" y="${(ly + 13).toFixed(1)}" text-anchor="${anchor}" class="rsub">(${esc(sub)})</text></g>`;
    }).join('');
    const key = (cls: string, label: string) => `<span><svg width="34" height="8"><line class="rl ${cls}" x1="1" y1="4" x2="33" y2="4"/></svg>${label}</span>`;
    return `<div class="relations"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Relations between the civilizations you know">${lines.join('')}${nodes}</svg>
      <div class="rkey">${key('contact', 'Contact, at peace')}${key('war', 'War')}${key('pact', 'Defensive pact')}${key('borders', 'Open borders')}</div></div>`;
  }

  // The United Nations: when its council sits next, whom it will vote between, how the vote would go now, and the player's own.
  private unHtml(): string {
    const g = this.game;
    const rules = `Their council sits every ${UN_EVERY} turns and votes on a leader of the world, between the two civilizations with the most votes (a vote a citizen). Each civilization gives all its votes to one of the two, or abstains; no one votes for itself. A candidate with ${Math.round(100 * UN_SHARE)}% of the votes of the rest of the world, abstentions counted against, wins the game. The computer's civilizations vote only for one they are Friendly or Devoted to, or sworn to defend: a shared state religion, open borders, a pact, gifts and a war fought on their side all bring them there.`;
    if (g.un.since === null) return `<p class="note">The United Nations are founded when the first civilization discovers ${techDef(UN_TECH).name}; through them every civilization comes to know every other. ${rules}</p>`;
    const cands = g.unCandidates(), name = (c: number) => (c === HUMAN ? 'you' : `the ${esc(g.players[c]!.name)}`), cap = (x: string) => `${x[0]!.toUpperCase()}${x.slice(1)}`;
    const table = (votes: readonly { civ: number; weight: number; for: number | null }[], cs: readonly [number, number], needs: (c: number) => number) => {
      const tally = (c: number) => votes.reduce((s, v) => s + (v.for === c && v.civ !== c ? v.weight : 0), 0);
      const rows = [...votes].sort((a, b) => b.weight - a.weight).map((v) => `<tr><td><span class="swatch" style="background:${g.players[v.civ]!.color}"></span> ${esc(g.players[v.civ]!.name)}${cs.includes(v.civ) ? ' <small>stands</small>' : ''}</td><td class="num">${v.weight}</td><td>${v.for === null ? '<small>abstains</small>' : `for ${name(v.for)}`}</td></tr>`).join('');
      return `<table class="grid"><tr><th>Civilization</th><th class="num">Votes</th><th>Given</th></tr>${rows}</table><p class="note">${cs.map((c) => `${cap(name(c))}: <b>${tally(c)}</b> of the ${needs(c)} needed`).join(' · ')}.</p>`;
    };
    const mine = cands ? g.ballotFor(cands) : null;
    const pick = (c: number | null, label: string) => `<button data-do="ballot" data-civ="${c ?? ''}" class="${mine === c ? 'active' : ''}">${label}</button>`;
    const last = g.un.last;
    // (What the last vote needed: of the votes cast then.)
    const neededThen = (c: number) => Math.max(1, Math.ceil(UN_SHARE * (last?.votes ?? []).reduce((s, v) => s + (v.civ !== c ? v.weight : 0), 0)));
    return `<p class="note">${rules}</p>
      <h3>The next vote <small>in ${Math.max(0, g.un.next - g.turn)} turns</small></h3>
      ${cands ? `<p>Between <b>${name(cands[0])}</b> and <b>${name(cands[1])}</b>, as things stand.</p>
        <div class="tfoot"><span>Your vote: <b>${mine === null ? 'abstain' : `for ${name(mine)}`}</b></span><span class="grow"></span>${cands.filter((c) => c !== HUMAN).map((c) => pick(c, `For ${name(c)}`)).join(' ')} ${pick(null, 'Abstain')}</div>
        <h3>How it would go today</h3>${table(forecast(g, cands, mine), cands, (c) => g.unNeeds(c))}` : '<p class="note">Too few civilizations are left to vote between.</p>'}
      ${last ? `<h3>The last vote <small>turn ${last.turn}</small></h3>${table(last.votes, last.candidates, neededThen)}` : ''}`;
  }

  // ---- victory ----

  // How the game is won: a card to each way, with how far the civ is along
  // it and who leads of those it has met (in broad, as anyone who has met
  // them can see); then everyone's standing in one table.
  private victoryHtml(): string {
    const g = this.game, p = this.me;
    const civs = g.players.filter((o) => o.alive && (o.id === HUMAN || g.met[HUMAN]![o.id])).sort((a, b) => g.score(b.id) - g.score(a.id));
    const first = (f: (o: Player) => number): Player => civs.reduce((a, o) => (f(o) > f(a) ? o : a), p);
    const bar = (share: number) => `<div class="bar"><i style="width:${(100 * Math.max(0, Math.min(1, share))).toFixed(1)}%"></i></div>`;
    const card = (k: Victory, mine: string, share: number, lead: string) =>
      `<div class="vcard"><b>${VICTORIES[k].name}</b><p>${VICTORIES[k].rule}</p><div class="vmine">${mine}</div>${bar(share)}<small>${lead}</small></div>`;
    const caps = first((o) => g.capitalsHeld(o.id)), era = first((o) => o.era);
    const rank = civs.findIndex((o) => o.id === p.id) + 1;
    const cards = [
      card('conquest', `You hold ${g.capitalsHeld(p.id)} of the ${g.capitalsToWin} first capitals that win`, g.capitalsHeld(p.id) / g.capitalsToWin,
        caps.id === p.id ? 'No one you have met holds more' : `The ${esc(caps.name)} hold ${g.capitalsHeld(caps.id)}`),
      card('science', `You know ${p.techs.size} of the ${TECH_KEYS.length} technologies`, p.techs.size / TECH_KEYS.length,
        era.id === p.id ? `No one you have met is past the ${ERAS[p.era].name} era` : `The ${esc(era.name)} are in the ${ERAS[era.era].name} era`),
      card('diplomacy', g.un.since === null ? 'The United Nations are not founded yet' : (() => { const c = g.unCandidates(); return c?.includes(p.id) ? `You stand in the next vote: you need ${g.unNeeds(p.id)} votes of the rest of the world` : 'You do not stand in the next vote: the two civilizations with the most citizens do'; })(),
        g.un.last && g.un.last.candidates.includes(p.id) ? g.un.last.votes.reduce((s2, v) => s2 + (v.for === p.id && v.civ !== p.id ? v.weight : 0), 0) / g.unNeeds(p.id) : 0,
        g.un.since === null ? 'Founded when the first civilization discovers Telecommunications' : `The council votes again in ${Math.max(0, g.un.next - g.turn)} turns (Diplomacy, United Nations)`),
      card('time', `${g.score(p.id)} points: ${civs.length === 1 ? 'you have met no one to compare' : `${rank === 1 ? 'the best score' : `${rank}${['th', 'st', 'nd', 'rd'][rank] ?? 'th'}`} of the ${civs.length} you know of`}`, g.turn / g.turnLimit,
        `${Math.max(0, g.turnLimit - g.turn)} turns left: the last is ${g.turnLimit}`),
    ].join('');
    // (Toward each way of winning, in broad: the score, the era.)
    const rows = civs.map((o) => `<tr><td><span class="swatch" style="background:${o.color}"></span> ${esc(o.name)}</td><td class="num">${g.score(o.id)}</td>
      <td>${ERAS[o.era].name}${o.id === HUMAN ? ` <small>${o.techs.size} of ${TECH_KEYS.length} technologies</small>` : ''}</td><td>${o.stateReligion ? religionDef(o.stateReligion).name : 'secular'}</td><td class="num">${g.capitalsHeld(o.id)} of the ${g.capitalsToWin} that win</td></tr>`).join('');
    return `<div class="vcards">${cards}</div>
      <h3>Standings</h3><p class="note">You and the civilizations you have met, the best score first. Of the others you know these things in broad, no more.</p>
      <table class="grid"><tr><th>Civilization</th><th class="num">Score</th><th>Era</th><th>State religion</th><th class="num">First capitals held</th></tr>${rows}</table>
      ${this.chartHtml('score', 'Score through the turns', (g.over ? g.players : civs).map((o) => ({ name: o.id === HUMAN ? `${o.name} (you)` : o.name, color: o.color, values: g.history.score[o.id] ?? [] })))}`;
  }

  // A chart of figures through the turns: a thin line a series, drawn straight on the sheet; names at the lines' ends;
  // the pointer reads a turn off it. (A line needs two turns.)
  private chartHtml(id: string, title: string, series: readonly { name: string; color: string; values: readonly number[] }[]): string {
    const turns = Math.max(0, ...series.map((x) => x.values.length));
    const head = `<h3>${title}</h3>`;
    if (turns < 2) return `${head}<p class="note">Nothing to draw yet: a line needs two turns.</p>`;
    this.charts.set(id, { title, series });
    const W = 1000, H = 240, L = 54, R = series.length > 1 ? 150 : 16, T = 10, B = 26, x0 = L, x1 = W - R;
    const all = series.flatMap((x) => [...x.values]), hi = Math.max(1, ...all), lo = Math.min(0, ...all);
    // (A round top to the scale, and four lines across.)
    const step = (() => { const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(Math.max(1e-9, raw))); return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw; })();
    const top = Math.ceil(hi / step) * step, bottom = Math.floor(lo / step) * step;
    const X = (t: number) => x0 + ((t - 1) / Math.max(1, turns - 1)) * (x1 - x0), Y = (v: number) => T + (1 - (v - bottom) / Math.max(1e-9, top - bottom)) * (H - T - B);
    const grid: string[] = [];
    for (let v = bottom; v <= top + 1e-9; v += step) grid.push(`<line class="${Math.abs(v) < 1e-9 ? 'hbase' : 'hgrid'}" x1="${x0}" x2="${x1}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="haxis" x="${x0 - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v).toLocaleString()}</text>`);
    const every = [10, 20, 25, 50, 100].find((x) => turns / x <= 8) ?? 100;
    for (let t = every; t <= turns; t += every) grid.push(`<text class="haxis" x="${X(t).toFixed(1)}" y="${H - 7}" text-anchor="middle">${t}</text>`);
    const lines = series.map((sr) => `<path class="hline" d="${sr.values.map((v, i) => `${i ? 'L' : 'M'}${X(i + 1).toFixed(1)} ${Y(v).toFixed(1)}`).join('')}" stroke="${sr.color}"/>`).join('');
    // (Names at the lines' ends, spread so that none sits on another; one line needs no name: the title says it.)
    let labels = '';
    if (series.length > 1) {
      const ends = series.map((sr) => ({ sr, y: Y(sr.values[sr.values.length - 1] ?? 0) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + 14);
      const over = Math.max(0, ends[ends.length - 1]!.y - (H - B));
      labels = ends.map((e) => `<circle cx="${x1 + 9}" cy="${(e.y - over).toFixed(1)}" r="3.5" fill="${e.sr.color}" class="hdot"/><text class="hname" x="${x1 + 18}" y="${(e.y - over + 4).toFixed(1)}">${esc(e.sr.name)}</text>`).join('');
    }
    return `${head}<div class="hchart"><svg viewBox="0 0 ${W} ${H}" data-chart="${id}" data-x0="${x0}" data-x1="${x1}" data-turns="${turns}" role="img" aria-label="${esc(title)}">
      ${grid.join('')}${lines}${labels}<line class="hcross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/></svg><div class="htip" hidden></div></div>`;
  }
  // The player's own figure through the turns, one line.
  private ownChart(k: 'science' | 'culture' | 'cohesion' | 'faith', color: string): string {
    const name = { science: 'Science', culture: 'Culture', cohesion: 'Cohesion', faith: 'Faith' }[k];
    return this.chartHtml(k, `${name} a turn, through the turns`, [{ name: `${name} a turn`, color, values: this.game.history[k][HUMAN] ?? [] }]);
  }

  // A table whose columns sort (click a heading: by it, again: the other
  // way), in the order the player last set or `first`.
  private tableHtml(id: string, cols: readonly Col[], rows: readonly (readonly Cell[])[], first: { col: number; down: boolean }, cls = ''): string {
    const by = this.sorts.get(id) ?? first;
    const sorted = [...rows].sort((a, b) => {
      const x = a[by.col]!.v, y = b[by.col]!.v;
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return by.down ? -d : d;
    });
    const head = cols.map(([label, fig, how], i) => `<th class="${fig ? 'num' : ''} ${by.col === i ? 'by' : ''}" data-do="sort" data-table="${id}" data-col="${i}" data-fig="${fig ? 1 : 0}" ${tip(esc(label), `${how ? `${esc(how)}. ` : ''}Click to sort by it`)}>${esc(label)}${by.col === i ? `<i>${by.down ? '▼' : '▲'}</i>` : ''}</th>`).join('');
    return `<table class="grid sorts ${cls}"><tr>${head}</tr>${sorted.map((r) => `<tr>${r.map((c, i) => `<td class="${cols[i]![1] ? 'num' : ''}">${c.html}</td>`).join('')}</tr>`).join('')}</table>`;
  }

  // ---- cities ----

  // Every city of the civ, a row each: all it makes a turn, how long to its
  // next citizen, what it builds and how long that takes. A click on its
  // name goes to it (main.ts selectCity).
  private citiesHtml(): string {
    const g = this.game, p = this.me;
    const cities = g.cities.filter((c) => c.owner === HUMAN);
    if (!cities.length) return '<p class="note">You have no city yet: found one with a settler.</p>';
    const fig = (v: number): Cell => num(v, v ? String(v) : '—');
    const rows = cities.map((c): Cell[] => {
      const y = g.cityYields(c);
      const need = g.growthCostOf(c, c.pop + c.growth);
      // (To sort by: the turns; a city not growing after all that grow, a starving one first of all.)
      const grow: Cell = c.growth > 0 ? num(0, '<span class="warn">a citizen to place</span>')
        : y.surplus > 0 ? (() => { const t = Math.ceil((need - c.food) / y.surplus); return num(t, `${t} ${t === 1 ? 'turn' : 'turns'}`); })()
        : y.surplus < 0 ? num(-1, '<span class="bad">starving</span>') : num(1e9, '<small>not growing</small>');
      const build: Cell = c.building ? (() => {
        const left = Math.max(0, g.costOf(c.building) - c.prod), t = y.prod > 0 ? Math.max(1, Math.ceil(left / y.prod)) : Infinity;
        return num(Number.isFinite(t) ? t : 1e9, `${esc(buildDef(c.building).name)} <small>${Number.isFinite(t) ? `${t} ${t === 1 ? 'turn' : 'turns'}` : 'no production'}</small>`);
      })() : num(-1, '<span class="warn">nothing</span>');
      return [{ html: `<a class="go" data-act="selectCity" data-id="${c.id}" ${tip(esc(c.name), 'Click: go to the city')}>${p.capital === c.id ? `${icon('star')} ` : ''}${esc(c.name)}</a>`, v: c.name },
        num(c.pop, String(c.pop)), fig(y.food), num(y.surplus, `${y.surplus > 0 ? '+' : y.surplus < 0 ? '−' : ''}${Math.abs(y.surplus)}`), fig(y.prod), fig(y.gold), fig(y.science), fig(y.culture), fig(y.faith), fig(y.cohesion), grow, build];
    });
    return `<p class="note">What each city makes a turn, as it stands now. Click a heading to sort by it, a city's name to go to it. The gold is before upkeep (the economy sheet has that); where a yield comes from is on its own sheet's second tab.</p>
      ${this.tableHtml('cities', [['City', false], ['Citizens', true], ['Food', true], ['Food spare', true, 'What is left once its citizens have eaten: toward its next citizen'], ['Production', true], ['Gold', true], ['Science', true], ['Culture', true], ['Faith', true], ['Cohesion', true],
        ['Next citizen', true], ['Building', true, 'Sorts by the turns left']], rows, { col: 1, down: true }, 'ecities')}`;
  }

  // ---- where a yield comes from ----

  // A yield taken apart (game.ts cityYieldParts): its sources line by line,
  // all the cities' together, then city by city. As the cities stand now.
  private sourcesHtml(y: OutputKey): string {
    const g = this.game, p = this.me;
    const n1 = (x: number) => (Math.round(10 * x) / 10).toLocaleString();
    const signed = (x: number) => `${x < 0 ? '−' : '+'}${n1(Math.abs(x))}`;
    const cities = g.cities.filter((c) => c.owner === p.id).map((c) => ({ c, parts: g.cityYieldParts(c) }));
    const SOURCES = [
      ['land', 'Worked land', 'The tiles your citizens work, with their improvements and resources'],
      ['center', 'City tiles', 'The tile each city stands on'],
      ['buildings', 'Buildings', 'What each city has built'],
      ['wonders', 'Wonders', 'In your cities and beside them'],
      ['specialists', 'Specialists', 'Citizens working in a building\'s slots'],
      ['capital', 'The capital', 'The palace, and what your government, policies and traits give the capital'],
      ['roads', 'Roads', 'Cities joined to the capital by road'],
      ['religion', 'Religion', 'What each city makes of the religions it holds, under your state'],
    ] as const;
    const name = y === 'prod' ? 'production' : y;
    const made = cities.reduce((a, x) => a + x.parts.total[y], 0);
    const raw = (x: (typeof cities)[number]) => SOURCES.reduce((a, [k]) => a + x.parts[k][y], 0);
    const lux = g.luxuryYield(p)[y], pct = yieldBonus(g.effectsOf(p), y);
    const lines: [string, number, string][] = [
      ...SOURCES.map(([k, label, how]): [string, number, string] => [label, cities.reduce((a, x) => a + x.parts[k][y], 0), how]),
      ['Luxuries', lux, 'What your kinds of luxury give the whole civilization'],
    ];
    const bonus = made - cities.reduce((a, x) => a + raw(x), 0);
    const most = Math.max(1, Math.abs(bonus), ...lines.map((x) => x[1]));
    const line = (label: string, v: number, how: string, cls: string) =>
      `<div class="eline"><div class="ehead"><span>${label}</span><b>${signed(v)}</b></div><div class="bar ${cls}"><i style="width:${(100 * Math.abs(v) / most).toFixed(1)}%"></i></div><small>${how}</small></div>`;
    const why = [`${pct >= 0 ? '+' : ''}${pct}% from your technologies, government, policies and traits`, 'your buildings\' percentages',
      ...(y === 'cohesion' ? ['less in troubled times (a broken truce, a war within your religion)'] : []),
      ...(p.arrears > 0 && (y === 'science' || y === 'culture' || y === 'prod') ? [`${Math.round(100 * p.arrears)}% less while the treasury is in arrears`] : []), 'rounding'].join('; ');
    const shown = lines.filter((x) => Math.abs(x[1]) > 0.04).map(([label, v, how]) => line(label, v, how, YIELD_CLS[y])).join('')
      + (Math.abs(bonus) > 0.04 ? line('Bonuses and penalties', bonus, `What these make of all the above: ${why}`, bonus < 0 ? 'cost' : YIELD_CLS[y]) : '');
    const cell = (v: number): Cell => num(v, Math.abs(v) > 0.04 ? signed(v) : '—');
    const rows = cities.map((x): Cell[] => {
      const q = x.parts;
      return [{ html: `${p.capital === x.c.id ? `${icon('star')} ` : ''}${esc(x.c.name)}`, v: x.c.name }, num(x.c.pop, String(x.c.pop)), cell(q.land[y]), cell(q.center[y] + q.buildings[y] + q.wonders[y]),
        cell(q.specialists[y]), cell(q.capital[y] + q.roads[y] + q.religion[y]), cell(q.total[y] - raw(x)), num(q.total[y], `<b>${signed(q.total[y])}</b>`)];
    });
    const table = this.tableHtml(`from-${y}`, [['City', false], ['Citizens', true], ['Land', true, 'The tiles its citizens work'], ['City, buildings, wonders', true], ['Specialists', true],
      ['Capital, roads, religion', true], ['Bonuses', true, 'What percentages, troubles and rounding make of the rest'], ['Makes', true]], rows, { col: 7, down: true }, 'ecities');
    return `<div class="page"><div class="etotals"><div><span class="label">Each turn</span><b>${signed(made + lux)}</b></div><div><span class="label">From your cities</span><b>${signed(made)}</b></div>
        ${Math.abs(lux) > 0.04 ? `<div><span class="label">From luxuries</span><b>${signed(lux)}</b></div>` : ''}<div><span class="label">Civilization's bonus</span><b>${pct >= 0 ? '+' : ''}${pct}%</b></div></div>
      <div class="ecols one"><div><h3>Where your ${name} comes from</h3>${shown || '<p class="note">Nothing yet.</p>'}</div></div>
      <p class="note">As your cities stand now. ${YIELD_USE[y]}</p>
      ${rows.length ? `<h3>Your cities</h3>${table}` : ''}
      ${y === 'science' || y === 'culture' || y === 'cohesion' || y === 'faith' ? this.ownChart(y, `var(--c-${{ science: 'sci', culture: 'cul', cohesion: 'coh', faith: 'fai' }[y]})`) : ''}</div>`;
  }

  // ---- resources ----

  // The strategic resources the civ can see, a card to each: its sources
  // (its land's, traded in, traded away), the units they arm and those it
  // has; then its luxuries and what they give.
  private resourcesHtml(): string {
    const g = this.game, p = this.me;
    const count = (ks: readonly ResourceKey[], k: ResourceKey) => ks.filter((x) => x === k).length;
    const strategic = RESOURCE_KEYS.filter((k) => resourceDef(k).kind === 'strategic');
    const seen = strategic.filter((k) => { const need = resourceDef(k).reveal; return !need || p.techs.has(need); });
    const unitKeys = Object.keys(UNITS) as (keyof typeof UNITS)[];
    const cards = seen.map((k) => {
      const sources = g.resourceSources(HUMAN, k), cap = UNITS_PER_SOURCE * sources, used = g.resourceUsed(HUMAN, k);
      const bought = count(g.imports(HUMAN), k), sold = count(g.exports(HUMAN), k), own = sources - bought + sold;
      const arms = unitKeys.filter((u) => unitDef(u).needs === k);
      const mine = arms.map((u) => [u, g.units.filter((x) => x.owner === HUMAN && x.type === u).length] as const).filter((x) => x[1] > 0);
      const where = [`${own} on your land`, bought ? `${bought} traded in` : '', sold ? `${sold} traded away` : ''].filter(Boolean).join(' · ');
      return `<div class="scard ${sources ? '' : 'none'}"><div class="shead">${icon(resourceIcon(k))}<b>${esc(resourceDef(k).name)}</b><span class="${used > cap ? 'bad' : ''}">${used} / ${cap}</span></div>
        <div class="bar"><i style="width:${cap ? Math.min(100, (100 * used) / cap).toFixed(1) : 0}%"></i></div>
        <small>${sources === 1 ? '1 source' : `${sources} sources`}: ${where}. ${cap ? `${used} of the ${cap} units they can arm are in the field.` : 'None to arm units with.'}</small>
        <small>Arms: ${arms.map((u) => esc(UNITS[u].name)).join(', ') || 'nothing yet'}</small>
        ${mine.length ? `<small>Yours: ${mine.map(([u, n]) => `${n} ${esc(UNITS[u].name)}`).join(', ')}</small>` : ''}</div>`;
    }).join('');
    const hidden = strategic.length - seen.length;
    const luxuries = g.luxuriesOf(HUMAN), imported = new Set(g.imports(HUMAN)), spare = g.spareResources(HUMAN), owned = g.ownedResources(HUMAN);
    const lux = luxuries.map((k) => `<tr><td>${icon(resourceIcon(k))} ${esc(resourceDef(k).name)}</td><td>${imported.has(k) && !owned.has(k) ? 'Traded in' : 'Your land'}</td>
      <td class="num">${spare.get(k) ?? 0}</td><td>${bonusStr(empireBonus(k, p.era))}</td></tr>`).join('');
    return `<div class="page"><h3 class="top">Strategic resources</h3><p class="note">A source is a tile of the resource in your land, improved, or one you trade for. Each arms ${UNITS_PER_SOURCE} of the units that need it; with none left, no more of them can be built.${hidden ? ` ${hidden} more ${hidden === 1 ? 'is' : 'are'} still hidden: technologies reveal them.` : ''}</p>
      ${cards ? `<div class="scards">${cards}</div>` : ''}
      <h3>Luxuries</h3><p class="note">The first copy of each luxury gives your whole civilization its bonus every turn, and it grows with the era. More copies add nothing: the spare ones are yours to trade (Diplomacy).</p>
      ${lux ? `<table class="grid eluxuries"><tr><th>Luxury</th><th>From</th><th class="num">Spare copies</th><th>Each turn</th></tr>${lux}</table>
        <p class="note">All together: ${bonusStr(p.ledger.luxuries) || 'nothing yet'} a turn.</p>` : '<p class="note">You have none yet: improve a tile of one in your land, or trade for one.</p>'}</div>`;
  }

  // ---- economy ----

  // The treasury's accounts: last turn's income and expenses line by line
  // (the top bar's figure, taken apart), then each city as it stands now.
  private economyHtml(): string {
    const g = this.game, p = this.me, l = p.ledger;
    const n1 = (x: number) => (Math.round(10 * x) / 10).toLocaleString();
    const cities = g.cities.filter((c) => c.owner === p.id);
    // (The ledger keeps cities' and buildings' upkeep as one: shared out as they stand now.)
    const cityUp = cities.reduce((a, c) => a + g.upkeepOf(c), 0), buildUp = cities.reduce((a, c) => a + g.buildingUpkeepOf(c), 0);
    const share = cityUp + buildUp > 0 ? cityUp / (cityUp + buildUp) : 1;
    const fighting = g.units.filter((u) => u.owner === p.id && !unitDef(u.type).civilian).length;
    const income: [string, number, string][] = [
      ['Cities', l.income.gold - l.luxuries.gold, 'Worked tiles, buildings, specialists, the palace, roads to the capital; production with nothing to build'],
      ['Luxuries', l.luxuries.gold, 'What your kinds of luxury give the whole civilization'],
      ['Tithes', l.tithes, 'From every city in the world holding a religion whose holy city you hold'],
      ['Trade', Math.max(0, l.trade), 'Gold a turn from your deals, less what you pay in them'],
    ];
    const expenses: [string, number, string][] = [
      ['Cities', l.cityUpkeep * share, 'Each by its distance from the capital, how many cities you have and its size'],
      ['Buildings', l.cityUpkeep * (1 - share), 'One gold for each 100 production a building cost'],
      ['Units', l.unitUpkeep, `${fighting} fighting ${fighting === 1 ? 'unit' : 'units'}; ${FREE_UNITS} and one per city are kept for nothing, civilians always`],
      ['Trade', Math.max(0, -l.trade), 'Gold a turn you pay in your deals, less what you get'],
    ];
    const sum = (ls: readonly [string, number, string][]) => ls.reduce((a, x) => a + x[1], 0);
    const most = Math.max(1, ...income.map((x) => x[1]), ...expenses.map((x) => x[1]));
    const lines = (ls: readonly [string, number, string][], cls: string, sign: string) => ls.filter((x) => x[1] > 0.04).map(([name, v, how]) =>
      `<div class="eline"><div class="ehead"><span>${name}</span><b>${sign}${n1(v)}</b></div><div class="bar ${cls}"><i style="width:${(100 * v / most).toFixed(1)}%"></i></div><small>${how}</small></div>`).join('')
      || '<p class="note">Nothing yet.</p>';
    const net = sum(income) - sum(expenses);
    const deals = g.deals.filter((d) => partyTo(d, HUMAN) && [...d.give, ...d.get].some((x) => x.k === 'goldPerTurn'));
    // (What upkeep is reckoned from: game.ts upkeepOf, buildingUpkeepOf, upkeep; economy.ts.)
    const fx = g.effectsOf(p), cityPct = total(fx, 'upkeep'), buildPct = total(fx, 'buildingUpkeep'), infl = g.inflation;
    const capital = p.capital === null ? undefined : g.cityById.get(p.capital);
    const gold = (v: number, sign: string): Cell => num(v, v > 0.04 ? `${sign}${n1(v)}` : '—');
    const rows = cities.map((c): Cell[] => {
      const made = g.cityYields(c).gold, up = g.upkeepOf(c), build = g.buildingUpkeepOf(c), left = made - up - build;
      const dist = capital && capital.id !== c.id ? Math.round(g.approxDist(c.tile, capital.tile)) : 0;
      const paid = [...c.buildings].filter((k) => buildingUpkeep(BUILDINGS[k].cost) > 0).length;
      return [{ html: `${p.capital === c.id ? `${icon('star')} ` : ''}${esc(c.name)}`, v: c.name }, num(c.pop, String(c.pop)), num(dist, p.capital === c.id ? 'capital' : String(dist)),
        num(Number(c.buildings.has('courthouse')), c.buildings.has('courthouse') ? 'yes' : '—'), gold(up, '−'), num(paid, `${paid} of ${c.buildings.size}`), gold(build, '−'), gold(made, '+'),
        num(left, `<b class="${left < 0 ? 'bad' : ''}">${left >= 0 ? '+' : '−'}${n1(Math.abs(left))}</b>`)];
    });
    const cityTable = this.tableHtml('economy-cities', [['City', false], ['Citizens', true], ['Tiles from the capital', true, 'Each costs upkeep'], ['Courthouse', true, 'Halves the city\'s upkeep'], ['City upkeep', true],
      ['Buildings that cost', true, `Those that cost ${BUILDING_UPKEEP_PER} production or more`], ['Building upkeep', true], ['Gold made', true], ['Left', true, 'Gold made, less both upkeeps']], rows, { col: 8, down: true }, 'ecities');
    // (The units: each kind's, as the share of them that is not free pays.)
    const kinds = unitKeysOf(g.units.filter((u) => u.owner === p.id && !unitDef(u.type).civilian).map((u) => u.type));
    const free = FREE_UNITS + cities.length + total(fx, 'freeUnits'), paying = fighting > free ? (fighting - free) / fighting : 0;
    const unitRows = kinds.map(([u, n]): Cell[] => {
      const cost = unitDef(u).cost, up = (n * cost / UNIT_UPKEEP_PER) * paying * infl;
      return [{ html: `${icon(unitIcon(u))} ${esc(UNITS[u].name)}`, v: UNITS[u].name }, num(n, String(n)), num(cost, String(cost)), gold(up, '−')];
    });
    const unitTable = this.tableHtml('economy-units', [['Unit', false], ['How many', true], ['Production cost', true, 'Each'], ['Upkeep', true, 'Of them all']], unitRows, { col: 3, down: true }, 'eunits');
    const pctText = (v: number, what: string) => (v ? `; ${v > 0 ? '+' : ''}${v}% from your ${what}` : '');
    const how = `<div class="rules"><div><h4>A city</h4><p>${UPKEEP_PER_TILE} gold for each tile between it and the capital, and ${UPKEEP_PER_CITY} for each other city you have (${Math.max(0, cities.length - 1)} now); ${Math.round(100 * UPKEEP_PER_POP)}% more for each citizen past its first. A Courthouse ${COURTHOUSE_CUT === 0.5 ? 'halves' : 'cuts'} it${pctText(cityPct, 'government, policies and traits')}. The capital costs nothing.</p></div>
      <div><h4>A building</h4><p>1 gold for each whole ${BUILDING_UPKEEP_PER} production it cost: the cheaper ones cost nothing to keep${pctText(buildPct, 'government, policies and traits')}.</p></div>
      <div><h4>Units</h4><p>A fighting unit costs 1 gold for each ${UNIT_UPKEEP_PER} production it cost. ${FREE_UNITS} units and one for each city are kept for nothing: ${fighting <= free ? `all ${fighting} of yours now` : `${free} of your ${fighting} now, so you pay ${Math.round(100 * paying)}% of what they all cost`}. Civilians cost nothing.</p></div>
      <div><h4>Inflation</h4><p>All upkeep rises 1% every ${INFLATION_TURNS} turns of a standard game. It now stands at ${Math.round(100 * infl)}% of its first price, counted in every figure here.</p></div></div>`;
    return `<div class="page">${p.arrears > 0 ? `<p class="notice">In arrears: the treasury could not pay last turn's upkeep, and your cities make ${Math.round(100 * p.arrears)}% less production, science and culture.</p>` : ''}
      <div class="etotals"><div><span class="label">Treasury</span><b>${p.gold}</b></div><div><span class="label">Income</span><b class="good">+${n1(sum(income))}</b></div>
        <div><span class="label">Expenses</span><b class="${sum(expenses) > 0.04 ? 'bad' : ''}">${sum(expenses) > 0.04 ? `−${n1(sum(expenses))}` : '0'}</b></div><div><span class="label">Each turn</span><b class="${net < 0 ? 'bad' : ''}">${net >= 0 ? '+' : '−'}${n1(Math.abs(net))}</b></div></div>
      <div class="ecols"><div><h3>Income</h3>${lines(income, 'gold', '+')}</div><div><h3>Expenses</h3>${lines(expenses, 'cost', '−')}</div></div>
      <p class="note">Last turn's accounts. What the treasury cannot pay, your cities lose in proportion, in production, science and culture, and a unit deserts.</p>
      ${deals.length ? `<h3>Deals with gold in them</h3><table class="grid"><tr><th>With</th><th>You give</th><th>You get</th></tr>${deals.map((d) => `<tr><td>${esc(g.players[d.a === HUMAN ? d.b : d.a]!.name)}</td><td>${this.said(givenBy(d, HUMAN))}</td><td>${this.said(givenBy(d, d.a === HUMAN ? d.b : d.a))}</td></tr>`).join('')}</table>` : ''}
      <h3>How upkeep is reckoned</h3>${how}
      ${rows.length ? `<h3>Your cities</h3><p class="note">As they stand now. Click a heading to sort by it.</p>${cityTable}` : ''}
      ${unitRows.length ? `<h3>Your fighting units</h3>${unitTable}` : ''}
      ${(() => { const h = g.history, inc = h.income[HUMAN] ?? [], exp = h.expenses[HUMAN] ?? [];
        return this.chartHtml('gold-flow', 'Income and expenses, through the turns', [{ name: 'Income', color: 'var(--c-gold)', values: inc }, { name: 'Expenses', color: 'var(--bad)', values: exp }])
          + this.chartHtml('gold-net', 'Profit a turn, through the turns', [{ name: 'Profit a turn', color: 'var(--c-gold)', values: inc.map((v, i) => v - (exp[i] ?? 0)) }])
          + this.chartHtml('gold-held', 'The treasury, through the turns', [{ name: 'Treasury', color: 'var(--c-gold)', values: h.treasury[HUMAN] ?? [] }]); })()}</div>`;
  }

  // ---- trade ----

  private draftOffer(d: NonNullable<Sheets['draft']>): Offer {
    return { from: HUMAN, to: d.civ, give: d.give, get: d.get, ...(d.peace ? { peace: true } : {}) };
  }
  private said(list: readonly Item[]): string { return list.length ? list.map((i) => esc(itemText(this.game, i))).join(' + ') : 'nothing'; }
  // The lasting deals in force, each to be ended once it has run its least; and the luxuries they move.
  private agreementsHtml(): string {
    const g = this.game, p = this.me;
    const luxuries = g.luxuriesOf(HUMAN), imported = new Set(g.imports(HUMAN)), spare = g.spareResources(HUMAN);
    const lux = luxuries.length
      ? luxuries.map((k) => `<tr><td>${esc(resourceDef(k).name)}</td><td>${imported.has(k) && !g.ownedResources(HUMAN).has(k) ? 'Traded in' : 'Your land'}</td><td>${bonusStr(empireBonus(k, p.era))}</td><td class="num">${spare.get(k) ?? 0}</td></tr>`).join('')
      : '<tr><td colspan="4"><small>None yet: settle near luxuries, or trade for them.</small></td></tr>';
    const who = (c: number) => `<span class="swatch" style="background:${g.players[c]!.color}"></span> ${esc(g.players[c]!.name)}`;
    const deals = g.deals.map((t, i) => (partyTo(t, HUMAN) ? `<tr><td>${who(t.a === HUMAN ? t.b : t.a)}</td><td>${this.said(givenBy(t, HUMAN))}</td><td>${this.said(givenBy(t, t.a === HUMAN ? t.b : t.a))}</td><td class="num">${t.since}</td><td class="num">${t.until - g.turn}</td>
      <td><button data-do="treatyEnd" data-i="${i}" ${g.canCancel(t) ? '' : `disabled title="It can be ended once it has run ${DEAL_MIN} turns: ${Math.max(0, t.since + DEAL_MIN - g.turn)} more"`}>End it</button></td></tr>` : '')).join('');
    const strategics = [...spare].filter(([k]) => resourceDef(k).kind !== 'luxury');
    return `${this.notice ? `<p class="notice">${esc(this.notice)}</p>` : ''}<h3>Agreements in force</h3>
      ${deals ? `<table class="grid"><tr><th>With</th><th>You give</th><th>You get</th><th class="num">Signed, turn</th><th class="num">Turns left</th><th></th></tr>${deals}</table>` : '<p class="note">None. A lasting letter, signed, stands here for its thirty turns.</p>'}
      <p class="note">A lasting agreement runs ${DEAL_TURNS} turns; either side may end it after ${DEAL_MIN}, and a war ends it.</p>
      <h3>Your luxuries</h3><table class="grid"><tr><th>Luxury</th><th>From</th><th>Bonus to your civilization</th><th class="num">Spare copies</th></tr>${lux}</table>
      ${strategics.length ? `<p class="note">Spare strategic copies: ${strategics.map(([k, n]) => `${esc(resourceDef(k).name)} ×${n}`).join(', ')}.</p>` : ''}`;
  }

  // Letters: those to answer, and the one being written. A letter received is read as a letter, signed, declined
  // or written back to; one written is put together from pieces, by kind, on the right.
  private lettersHtml(others: readonly Player[]): string {
    const g = this.game, d = this.draft;
    const reading = d ? -1 : g.dealOffers.length ? 0 : -1;
    const to = others.map((o) => `<button class="dl ${d?.civ === o.id ? 'on' : ''}" data-do="tradeWith" data-civ="${o.id}"><span class="seal" style="background:${o.color}"></span><span class="who"><b>${esc(o.name)}</b><small class="${g.atWar(HUMAN, o.id) ? 'bad' : ''}">${g.atWar(HUMAN, o.id) ? 'At war' : REGARDS[regard(g, o.id, HUMAN).level]}</small></span></button>`).join('');
    const inbox = g.dealOffers.map((o, i) => `<button class="dl ${i === reading || d?.reply === o ? 'on' : ''}" data-do="letterBack"><span class="seal" style="background:${g.players[o.from]!.color}"></span><span class="who"><b>From the ${esc(g.players[o.from]!.name)}</b><small>${o.demand ? 'a demand' : o.peace ? 'an offer of peace' : 'awaits your answer'}</small></span></button>`).join('');
    const main = d ? this.draftHtml() : reading >= 0 ? this.letterHtml(g.dealOffers[reading]!, reading) : `<div class="letter empty"><p>${this.notice ? esc(this.notice) : 'No letter awaits your answer. Choose whom to write to.'}</p></div>`;
    return `<div class="dip"><div class="dlist">${inbox ? `<span class="label">To answer</span>${inbox}` : ''}<span class="label">Write to</span>${to}</div>${main}</div>`;
  }

  // What an item means for the player, in a few words, beside it in a letter received.
  private itemNote(i: Item, mine: boolean, other: Player): string {
    const g = this.game;
    switch (i.k) {
      case 'resource': return mine ? 'a spare copy: you keep one' : resourceDef(i.resource).kind === 'luxury' ? `a luxury you lack: ${bonusStr(empireBonus(i.resource, this.me.era))}` : `a ${resourceDef(i.resource).kind} resource you lack`;
      case 'gold': return mine ? `of the ${this.me.gold} in your treasury` : '';
      case 'goldPerTurn': return mine ? `of your ${g.goldRate(HUMAN)} a turn` : '';
      case 'tech': return `${g.techCost(i.tech)} science of research`;
      case 'map': return `${mapNews(g, mine ? HUMAN : other.id, mine ? other.id : HUMAN)} tiles new to ${mine ? 'them' : 'you'}`;
      case 'city': return `size ${g.cityById.get(i.city)?.pop ?? 0}`;
      case 'openBorders': return mine ? 'their armies may cross your land' : 'your armies may cross their land';
      case 'pact': return mine ? 'you go to war with whoever falls on them' : 'they go to war with whoever falls on you';
      case 'embargo': return 'no goods or gold a turn pass between the two';
      case 'warOn': return mine ? 'you declare it as you sign' : 'they declare it as you sign';
      case 'peaceWith': return 'made as you sign';
      case 'convert': return mine ? 'your state religion changes as you sign' : 'they take it up as you sign';
    }
  }
  // A letter received, to read and answer.
  private letterHtml(o: Offer, i: number): string {
    const g = this.game, from = g.players[o.from]!, lasting = [...o.give, ...o.get].some(isLasting), rg = regard(g, o.from, HUMAN);
    const lines = (list: readonly Item[], mine: boolean) => list.map((x) => `<div class="lline"><b>${esc(itemText(g, x))}</b><span>${this.itemNote(x, mine, from)}</span></div>`).join('');
    const opening = o.demand ? 'We will not ask twice.' : o.peace ? 'Let there be peace between us.' : lasting ? `We propose an agreement between our peoples, to last ${DEAL_TURNS} turns.` : 'We propose a bargain between our peoples, settled the day it is signed.';
    const block = g.offerBlock(o);
    return `<div class="letter"><div class="lhead"><span class="seal" style="background:${from.color}"></span><div><span class="label">From the ${esc(from.name)} · turn ${g.turn} · ${o.demand ? 'a demand' : o.peace ? 'a peace' : lasting ? `a lasting agreement, ${DEAL_TURNS} turns` : 'settled at once'}</span><h2>To the ${esc(this.me.name)},</h2></div>
        <span class="grow"></span><span class="pill ${rg.level <= 1 ? 'war' : rg.level >= 3 ? 'peace' : ''}">${REGARDS[rg.level]} toward you</span></div>
      <p class="lsay">${opening}</p>
      ${o.give.length ? `<h4>We will give you</h4>${lines(o.give, false)}` : ''}
      ${o.get.length ? `<h4>${o.give.length ? 'and in return we ask of you' : 'We ask of you'}</h4>${lines(o.get, true)}` : ''}
      <p class="lfine">${lasting ? `Either side may end it after ${DEAL_MIN} turns. ` : ''}${o.demand ? 'Refused or left unanswered, they will hold it against you.' : 'Unanswered, it lapses when the turn ends: nothing is held against you for that.'}${block ? ` <span class="bad">It can no longer be signed: ${esc(block)}</span>` : ''}</p>
      <p class="lsign">Signed, <b>the ${esc(from.name)}</b></p>
      <div class="lfoot"><button data-do="dealAnswer" data-i="${i}" data-yes="0">${o.demand ? 'Refuse' : 'Decline'}</button><button data-do="letterReply" data-i="${i}">Write back with other terms</button><span class="grow"></span><button class="primary" data-do="dealAnswer" data-i="${i}" data-yes="1" ${block ? 'disabled' : ''}>Sign</button></div></div>`;
  }

  // The letter being written: its text with the pieces put in it so far, and on the right every piece that side
  // could give of the kind chosen (at once, or lasting), by category, to put in or take out.
  private draftHtml(): string {
    const g = this.game, d = this.draft;
    if (!d) return '';
    const o = g.players[d.civ]!;
    if (!o.alive) return '';
    const thirds = g.players.filter((x) => x.alive && x.id !== HUMAN && x.id !== d.civ);
    const side = this.pieces, giver = side === 'give' ? HUMAN : d.civ, taker = side === 'give' ? d.civ : HUMAN;
    const can = (x: Item) => g.itemBlock(giver, taker, x) === null, picked = (x: Item) => d[side].some((y) => sameItem(y, x));
    const piece = (x: Item, label: string, note = '') => `<button class="lp ${picked(x) ? 'in' : ''}" data-do="tradeItem" data-side="${side}" data-item="${esc(JSON.stringify(x))}"><span>${esc(label)}</span><small>${picked(x) ? 'in the letter' : note}</small></button>`;
    const group = (title: string, body: string, sub = '') => (body ? `<div class="lgroup"><span class="label">${title}${sub ? ` <small>· ${sub}</small>` : ''}</span>${body}</div>` : '');
    const goldK = d.lasting ? 'goldPerTurn' : 'gold', has = (d[side].find((x) => x.k === goldK) as { n: number } | undefined)?.n ?? 0, steps = d.lasting ? [1, 5] : [10, 50];
    const gold = `<div class="lgold">${[...steps].reverse().map((n) => `<button data-do="tradeGold" data-side="${side}" data-n="${-n}">−${n}</button>`).join('')}<b>${has}</b>${steps.map((n) => `<button data-do="tradeGold" data-side="${side}" data-n="${n}">+${n}</button>`).join('')}</div>`;
    const keep = (xs: Item[]) => xs.filter((x) => can(x) || picked(x));
    const groups = d.lasting ? [
      group('Gold a turn', gold, giver === HUMAN ? `${g.goldRate(HUMAN)} a turn to spare` : ''),
      group('Resources', keep(g.tradeable(giver, taker).map((r) => ({ k: 'resource', resource: r } as Item))).map((x) => piece(x, itemText(g, x), x.k === 'resource' ? resourceDef(x.resource).kind : '')).join('')),
      group('Treaties', keep([{ k: 'openBorders' }, { k: 'pact' }]).map((x) => piece(x, x.k === 'pact' ? 'A defensive pact' : 'Open borders', 'binds both sides')).join('')),
      group('Embargoes', keep(thirds.map((x) => ({ k: 'embargo', civ: x.id } as Item))).map((x) => piece(x, `No trade with the ${x.k === 'embargo' ? g.players[x.civ]!.name : ''}`)).join('')),
    ] : [
      group('Gold', gold, giver === HUMAN ? `${this.me.gold} in the treasury` : ''),
      group('Knowledge', keep(techsFor(g, giver, taker).map((t) => ({ k: 'tech', tech: t } as Item))).map((x) => piece(x, itemText(g, x), x.k === 'tech' ? `${g.techCost(x.tech)} science` : '')).join('')),
      group('Map of the world', mapNews(g, giver, taker) > 0 || picked({ k: 'map' }) ? piece({ k: 'map' }, 'A map of the world', `${mapNews(g, giver, taker)} tiles new`) : ''),
      group('War and peace', keep(thirds.flatMap((x) => [{ k: 'warOn', civ: x.id } as Item, { k: 'peaceWith', civ: x.id } as Item])).map((x) => piece(x, x.k === 'warOn' ? `Declare war on the ${g.players[x.civ]!.name}` : `Make peace with the ${x.k === 'peaceWith' ? g.players[x.civ]!.name : ''}`)).join('')),
      group('Cities', keep(g.cities.filter((c) => c.owner === giver).map((c) => ({ k: 'city', city: c.id } as Item))).map((x) => piece(x, itemText(g, x), x.k === 'city' ? `size ${g.cityById.get(x.city)?.pop ?? 0}` : '')).join('')),
      group('Faith', keep(g.stateOptions(giver).map((r) => ({ k: 'convert', religion: r } as Item))).map((x) => piece(x, x.k === 'convert' ? `Take up ${religionDef(x.religion).name}` : '', 'as state religion')).join('')),
    ];
    const chip = (x: Item, s2: 'give' | 'get') => (x.k === 'gold' || x.k === 'goldPerTurn'
      ? `<span class="lchip">${esc(itemText(g, x))}<button data-do="tradeGold" data-side="${s2}" data-n="${-x.n}" aria-label="Take out">×</button></span>`
      : `<span class="lchip">${esc(itemText(g, x))}<button data-do="tradeItem" data-side="${s2}" data-item="${esc(JSON.stringify(x))}" aria-label="Take out">×</button></span>`);
    const chips = (s2: 'give' | 'get') => `<div class="lchips">${d[s2].map((x) => chip(x, s2)).join('')}${d[s2].length ? '' : '<span class="lslot">nothing yet: add a piece from the right</span>'}</div>`;
    const offer = this.draftOffer(d), block = g.offerBlock(offer), empty = !d.give.length && !d.get.length;
    // (How it would be read: in broad, never the odds.)
    let read = '';
    if (block && !(empty && !d.peace)) read = `<span class="bad">${esc(block)}</span>`;
    else if (!block) { const v = weigh(g, offer); read = v.why ? `“${esc(v.why)}”` : v.chance >= 0.8 ? `The ${esc(o.name)} would look kindly on this.` : v.chance <= 0.2 ? `The ${esc(o.name)} would think little of this.` : `The ${esc(o.name)} would be of two minds about this.`; }
    const kind = (lasting: boolean, label: string) => `<button data-do="tradeKind" data-kind="${lasting ? 'lasting' : 'now'}" class="${d.lasting === lasting ? 'active' : ''}" ${d.peace && lasting ? 'disabled' : ''}>${label}</button>`;
    const opening = d.peace ? 'Let there be peace between us.' : d.lasting ? `We propose an agreement between our peoples, to last ${DEAL_TURNS} turns.` : 'We propose a bargain between our peoples, settled the day it is signed.';
    const reply = d.reply ? `<div class="lreply"><span>You are writing back to the ${esc(o.name)}: their terms are below, turned round, for you to change. Their own letter is set aside when you send this.</span><button data-do="letterBack">Back to their letter</button></div>` : '';
    return `<div class="letter">${reply}<div class="lhead"><span class="seal" style="background:${this.me.color}"></span><div><span class="label">From the ${esc(this.me.name)} · turn ${g.turn}${d.reply ? ' · a counter-proposal' : ''}</span><h2>To the ${esc(o.name)},</h2></div>
        <span class="grow"></span><span class="lkind">${kind(false, 'Settled at once')}${kind(true, `Lasting, ${DEAL_TURNS} turns`)}</span></div>
      <p class="lsay">${opening}</p>
      <h4>We will give you</h4>${chips('give')}
      <h4>and in return we ask of you</h4>${chips('get')}
      <span class="grow"></span>
      ${read || this.notice ? `<p class="lread">${read}${this.notice ? ` <b>${esc(this.notice)}</b>` : ''}</p>` : ''}
      <div class="lfoot"><span class="lsign">Signed, <b>the ${esc(this.me.name)}</b></span><span class="grow"></span><button data-do="tradeCancel">Tear it up</button><button class="primary" data-do="tradePropose" ${block ? 'disabled' : ''}>Seal and send</button></div></div>
      <div class="ldrawer"><div class="lkind wide"><button data-do="pieces" data-side="give" class="${side === 'give' ? 'active' : ''}">What we give</button><button data-do="pieces" data-side="get" class="${side === 'get' ? 'active' : ''}">What they give</button></div>
        ${groups.join('') || '<p class="note">Nothing of this kind to give.</p>'}</div>`;
  }
}
