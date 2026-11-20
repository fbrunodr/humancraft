import { HUMAN, EMBARK_TECH, FAITH_VICTORY, UNITS_PER_SOURCE, DEAL_TURNS, TRUCE_TURNS, TRUCE_BREAK, VICTORIES, type Victory, type Game, type Player, type DealSide, type Deal } from './game.ts';
import { TECH_KEYS, STAGE_TECHS, techDef, techPath, type TechKey, type TechDef } from './techs.ts';
import {
  POLITICS_KEYS, politicsDef, politicsPath, GOVERNMENT_KEYS, governmentDef, policyDef, fits, SLOT_KINDS, POLICY_KINDS, POLICY_KEYS,
  type PoliticsKey, type PoliticsDef, type GovernmentKey, type PolicyKey, type PolicySlot, type PolicyKind,
} from './politics.ts';
import {
  PATHS, FAITH_KEYS, PAIR_SLOTS, MAX_TRAITS, openSlots, traitDef, pathTraits, traitBlock, pathLevels, epithet, traitOfReligion, BLOCK_TEXT, isTraitKey,
  type PathKey, type TraitKey,
} from './identity.ts';
import { RELIGION_KEYS, religionDef, FAITH_SAME, FAITH_RIVAL, HOLY_STRIFE, CONVERT_PER_POP, DEVOUT_TURNS } from './religion.ts';
import { RESOURCE_KEYS, resourceDef, empireBonus, type ResourceKey } from './resources.ts';
import { describe as describeEffect, describeAll, flat, yieldBonus, total, type Effect } from './effects.ts';
import { ERAS, BUILDINGS, WONDERS, IMPROVEMENTS, OUTPUT_KEYS, type EraIndex, type ImprovementKey, type OutputKey } from './cities.ts';
import { UNITS, unitDef } from './rules.ts';
import { FREE_UNITS, UPKEEP_PER_TILE, UPKEEP_PER_CITY, UPKEEP_PER_POP, COURTHOUSE_CUT, BUILDING_UPKEEP_PER, UNIT_UPKEEP_PER, INFLATION_TURNS, buildingUpkeep } from './economy.ts';
import { aiAcceptsDeal, resourceWorth, standing, attitude, ATTITUDES, RANKS, type Rank } from './ai.ts';
import { bonusStr, tip } from './ui.ts';
import { icon, unitIcon, resourceIcon, YIELD_ICON } from './icons.ts';

// The empire's sheets: full-screen pages over the map, opened from the top
// bar (data-sheet: the research, politics and identity tracks, and the
// buttons; the gold, science, cohesion, culture and faith yields open the
// economy, research, politics, identity and religion; the resources beside
// them, theirs; the turn, victory)
// and closed with Esc.
//   economy     the treasury's accounts: what comes in, what goes out, city by city
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

export type SheetKind = 'economy' | 'resources' | 'research' | 'politics' | 'identity' | 'government' | 'religion' | 'diplomacy' | 'victory';
const SHEETS: readonly SheetKind[] = ['economy', 'resources', 'research', 'politics', 'identity', 'government', 'religion', 'diplomacy', 'victory'];
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
  private draft: { civ: number; give: ResourceKey | null; get: ResourceKey | null; pay: number; paid: number } | null = null;

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
    const body = from ? this.sourcesHtml(from) : this.open === 'victory' || this.open === 'diplomacy' || this.open === 'government' ? `<div class="page">${main}</div>` : main;
    const govTab = (k: GovTab, label: string) => `<button class="${this.govTab === k ? 'active' : ''}" data-do="govTab" data-tab="${k}">${label}</button>`;
    const tabs = this.open === 'government' ? `<nav class="htabs">${govTab('mine', 'My government')}${govTab('policies', 'Policies')}${govTab('governments', 'Governments')}</nav>`
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
      case 'tradeWith': this.draft = { civ: Number(d['civ']), give: null, get: null, pay: 0, paid: 0 }; break;
      case 'tradePick': {
        if (!this.draft) return;
        const k = (d['key'] ?? '') as ResourceKey, side = d['side'] === 'give' ? 'give' : 'get';
        this.draft[side] = this.draft[side] === k ? null : k;
        break;
      }
      case 'tradeGold': {
        if (!this.draft) return;
        const side = d['side'] === 'pay' ? 'pay' : 'paid';
        this.draft[side] = Math.max(0, this.draft[side] + Number(d['n']));
        break;
      }
      case 'tradeCancel': this.draft = null; break;
      case 'tradePropose': {
        if (!this.draft) return;
        const sides = this.draftSides(this.draft);
        const who = g.players[this.draft.civ]!.name;
        if (g.proposeDeal(sides)) { this.draft = null; this.notice = `The ${who} signed.`; }
        else this.notice = g.dealBlock(sides) ?? `The ${who} decline: offer them more.`;
        break;
      }
      case 'dealAnswer': g.answerDeal(Number(d['i']), d['yes'] === '1'); break;
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
      ...(k === EMBARK_TECH ? [lock('Land units embark', 'Your land units can take to the water and cross it')] : []),
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

  // The rules in three short parts, then a card to each religion: its
  // faith, what a city following it gets, and who founded it, where, how far
  // it has gone (a founded one lit).
  private religionHtml(): string {
    const g = this.game, p = this.me;
    const cards = RELIGION_KEYS.map((r) => {
      const d = religionDef(r), f = g.religions.get(r);
      const holy = f?.holyCity != null ? g.cityById.get(f.holyCity) : undefined;
      const followers = g.cities.filter((c) => c.religion === r).length;
      const by = f ? g.players[f.founder]! : null;
      const state = by ? `<span><span class="swatch" style="background:${by.color}"></span>Founded by ${by.id === p.id ? 'you' : `the ${esc(by.name)}`}</span>${holy ? `<span>Holy city ${esc(holy.name)}</span>` : ''}<span>${followers === 1 ? '1 city follows it' : `${followers} cities follow it`}</span>`
        : `<span>Not yet founded</span>${followers ? `<span>${followers} cities follow it</span>` : ''}`;
      return `<div class="rcard ${f ? 'founded' : ''}"><div class="rhead"><span class="seal" style="background:${d.color}"></span><div><b>${d.name}</b><small>Faith: ${esc(traitDef(traitOfReligion(r)).name)}</small></div></div>
        <div class="rbonus">${bonusStr(flat(d.follower, 'follower'))}<small>in each city following it</small></div><div class="rfoot">${state}</div></div>`;
    }).join('');
    const mine = g.cities.filter((c) => c.owner === p.id);
    const cities = mine.length ? mine.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.religion ? religionDef(c.religion).name : '<small>none</small>'}</td></tr>`).join('') : '';
    return `<div class="page"><div class="rules"><div><h4>Founding</h4><p>A religion is founded by the first civilization to adopt its faith, a trait of the Devotion path of identity (Meditation founds Hinduism). A civilization adopts one faith at most. Its religion is the one it founded, or else the one more than half of its people follow.</p></div>
      <div><h4>Spreading</h4><p>It spreads from its holy city to the cities around it, whoever owns them; Shrines and Temples press it harder. Each city following a religion gets its bonus; the founder takes 1 gold a turn from every city following it.</p></div>
      <div><h4>At war</h4><p>A civilization attacking one of its own religion fights ${Math.round(100 * FAITH_SAME)}% weaker; attacking one of another religion, ${Math.round(100 * FAITH_RIVAL)}% stronger; with no religion on either side, nothing. Its cities that follow the religion make ${HOLY_STRIFE.slice(1).map((x) => Math.round(100 * x) + '%').join(', ')} less cohesion while it is at war with one, two, three or more civilizations of its own religion.</p></div></div>
      <div class="rcards">${cards}</div>
      ${this.convertHtml()}
      ${cities ? `<h3>Your cities</h3><table class="grid"><tr><th>City</th><th>Follows</th></tr>${cities}</table>` : ''}</div>`;
  }

  // What the founder of a religion does with its faith: missionaries.
  private convertHtml(): string {
    const g = this.game, mine = g.foundedBy(HUMAN);
    if (!mine) return '';
    const out = g.units.filter((u) => u.owner === HUMAN && u.type === 'missionary').length;
    return `<h3>Missionaries</h3><p class="note">As the founder of ${religionDef(mine.religion).name} you raise missionaries with faith (${g.missionaryCost}; you have ${this.me.faith}) in your cities that follow it: the button is in the city's panel. A missionary goes where you send it, over land and sea, and preaches in a city it stands in or beside, anyone's, for ${g.paced(CONVERT_PER_POP)} faith a citizen there; the city keeps to your religion for ${DEVOUT_TURNS} turns whatever presses on it, and the missionary is spent. Not in another religion's holy city.${out ? ` You have ${out} on the map.` : ''}</p>`;
  }

  private diplomacyHtml(): string {
    const g = this.game;
    const others = g.players.filter((o) => o.id !== HUMAN && o.alive && g.met[HUMAN]![o.id]);
    if (!others.length) return '<p class="note">You have not met another civilization yet. Civilizations meet when their units or cities come within sight of each other.</p>';
    // (How each compares with you: what anyone who has met them can see; the computer civs weigh the same.)
    const cmp = (x: Rank) => `<span class="${x >= 3 ? 'bad' : x <= 1 ? 'good' : ''}">${RANKS[x]}</span>`;
    const rows = others.map((o) => {
      const r = g.relations[HUMAN]![o.id]!, war = r.war, st = standing(g, HUMAN, o.id), mood = attitude(g, o, HUMAN);
      const offered = g.peaceOffers.has(`${o.id}>${HUMAN}`);
      const wait = war ? Math.max(0, r.since + 8 - g.turn) : 0, truce = g.truceLeft(HUMAN, o.id);
      const action = !war ? `<button class="danger" data-do="war" data-civ="${o.id}" ${truce ? tip('Break the truce', `It has ${truce} turns to run: break it and your people make ${Math.round(100 * TRUCE_BREAK)}% less cohesion for as long`) : ''}>Declare war${truce ? ` <small>truce: ${truce}</small>` : ''}</button>`
        : offered ? `<button class="primary" data-do="accept" data-civ="${o.id}">Accept peace</button>`
        : g.canMakePeace(HUMAN, o.id) ? `<button data-do="peace" data-civ="${o.id}">Offer peace</button>` : `<small>Peace possible in ${wait} turns</small>`;
      const known = epithet(o.identity), faith = g.faithOf(o.id);
      const trade = g.canTrade(HUMAN, o.id) ? `<button data-do="tradeWith" data-civ="${o.id}" class="${this.draft?.civ === o.id ? 'active' : ''}">Trade</button>` : '';
      return `<tr><td><span class="swatch" style="background:${o.color}"></span> ${esc(o.name)}${known ? ` <small>${esc(known)}</small>` : ''}<br><small>${esc(governmentDef(o.government).name)}${faith ? ` · ${religionDef(faith).name}` : ''}</small></td>
        <td><span class="pill ${mood === 'war' || mood === 'hostile' ? 'war' : mood === 'friendly' ? 'peace' : ''}" ${tip(ATTITUDES[mood].name, ATTITUDES[mood].tells)}>${ATTITUDES[mood].name}</span>${war ? ` <small>since turn ${r.since}</small>` : ''}</td>
        <td>${cmp(st.army)}</td><td>${cmp(st.tech)}</td><td>${cmp(st.prod)}</td><td>${cmp(st.gold)}</td><td>${trade}</td><td>${action}</td></tr>`;
    }).join('');
    return `<p class="note">How each civilization stands toward you is its own weighing of you, in broad: its plans stay its own. The columns rank it against you, in broad (no one knows another's exact figures); the computer's civilizations know of you, and of each other, the same ranks and no more. Everyone starts at peace; at peace, units cannot enter each other's tiles, and attacking a civilization declares war. A war lasts at least 8 turns before peace can be made; a peace is a truce for ${TRUCE_TURNS} turns, which can be broken at a price.</p>
      <table class="grid"><tr><th>Civilization</th><th>Toward you</th><th>Army</th><th>Technology</th><th>Production</th><th>Gold income</th><th></th><th></th></tr>${rows}</table>
      ${this.tradeHtml()}`;
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
    const tenth = (id: number) => Math.round(10 * g.faithShare(id)) * 10;
    const caps = first((o) => g.capitalsHeld(o.id)), era = first((o) => o.era), faith = first((o) => g.faithShare(o.id));
    const rank = civs.findIndex((o) => o.id === p.id) + 1;
    const cards = [
      card('conquest', `You hold ${g.capitalsHeld(p.id)} of the ${g.capitalsToWin} first capitals that win`, g.capitalsHeld(p.id) / g.capitalsToWin,
        caps.id === p.id ? 'No one you have met holds more' : `The ${esc(caps.name)} hold ${g.capitalsHeld(caps.id)}`),
      card('science', `You know ${p.techs.size} of the ${TECH_KEYS.length} technologies`, p.techs.size / TECH_KEYS.length,
        era.id === p.id ? `No one you have met is past the ${ERAS[p.era].name} era` : `The ${esc(era.name)} are in the ${ERAS[era.era].name} era`),
      card('religion', g.foundedBy(HUMAN) ? `About ${tenth(p.id)}% of the world's people follow your religion` : 'You have founded no religion', g.faithShare(p.id) / FAITH_VICTORY,
        faith.id === p.id || g.faithShare(faith.id) <= 0 ? 'No one you have met has more followers' : `The religion of the ${esc(faith.name)}: about ${tenth(faith.id)}%`),
      card('time', `${g.score(p.id)} points: ${civs.length === 1 ? 'you have met no one to compare' : `${rank === 1 ? 'the best score' : `${rank}${['th', 'st', 'nd', 'rd'][rank] ?? 'th'}`} of the ${civs.length} you know of`}`, g.turn / g.turnLimit,
        `${Math.max(0, g.turnLimit - g.turn)} turns left: the last is ${g.turnLimit}`),
    ].join('');
    // (Toward each way of winning, in broad: the score, the era, a tenth of the world's people at a time.)
    const rows = civs.map((o) => `<tr><td><span class="swatch" style="background:${o.color}"></span> ${esc(o.name)}</td><td class="num">${g.score(o.id)}</td>
      <td>${ERAS[o.era].name}${o.id === HUMAN ? ` <small>${o.techs.size} of ${TECH_KEYS.length} technologies</small>` : ''}</td><td>${g.faithShare(o.id) > 0 ? `about ${tenth(o.id)}%` : '—'}</td><td class="num">${g.capitalsHeld(o.id)} of the ${g.capitalsToWin} that win</td></tr>`).join('');
    return `<div class="vcards">${cards}</div>
      <h3>Standings</h3><p class="note">You and the civilizations you have met, the best score first. Of the others you know these things in broad, no more.</p>
      <table class="grid"><tr><th>Civilization</th><th class="num">Score</th><th>Era</th><th>World's people of its faith</th><th class="num">First capitals held</th></tr>${rows}</table>`;
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
      ['religion', 'Religion', 'What each city gets from the religion it follows'],
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
      ${rows.length ? `<h3>Your cities</h3>${table}` : ''}</div>`;
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
      ['Tithes', l.tithes, 'From every city following the religion you founded'],
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
    const deals = g.deals.filter((d) => d.sides.some((x) => x.civ === HUMAN) && d.sides.some((x) => x.gold > 0));
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
      ${deals.length ? `<h3>Deals with gold in them</h3><table class="grid">${deals.map((d) => `<tr><td>${this.dealText(d)}</td></tr>`).join('')}</table>` : ''}
      <h3>How upkeep is reckoned</h3>${how}
      ${rows.length ? `<h3>Your cities</h3><p class="note">As they stand now. Click a heading to sort by it.</p>${cityTable}` : ''}
      ${unitRows.length ? `<h3>Your fighting units</h3>${unitTable}` : ''}</div>`;
  }

  // ---- trade ----

  private draftSides(d: NonNullable<Sheets['draft']>): [DealSide, DealSide] {
    return [{ civ: HUMAN, resource: d.give, gold: d.pay }, { civ: d.civ, resource: d.get, gold: d.paid }];
  }
  private dealText(d: Deal): string {
    const side = (s: DealSide) => [s.resource ? resourceDef(s.resource).name : '', s.gold ? `${s.gold} gold a turn` : ''].filter(Boolean).join(' + ') || 'nothing';
    const mine = d.sides.find((s) => s.civ === HUMAN)!, theirs = d.sides.find((s) => s.civ !== HUMAN)!;
    return `<td><span class="swatch" style="background:${this.game.players[theirs.civ]!.color}"></span> ${esc(this.game.players[theirs.civ]!.name)}</td><td>${side(mine)}</td><td>${side(theirs)}</td>`;
  }
  // What a resource does for whoever takes it.
  private goodsNote(k: ResourceKey, to: Player): string {
    const d = resourceDef(k);
    return d.kind === 'luxury' ? bonusStr(empireBonus(k, to.era)) : `<small>${d.kind}${resourceWorth(this.game, to, k) > 2 ? ' · needed' : ''}</small>`;
  }

  private tradeHtml(): string {
    const g = this.game, p = this.me;
    const luxuries = g.luxuriesOf(HUMAN), imported = new Set(g.imports(HUMAN)), spare = g.spareResources(HUMAN);
    const lux = luxuries.length
      ? luxuries.map((k) => `<tr><td>${esc(resourceDef(k).name)}</td><td>${imported.has(k) && !g.ownedResources(HUMAN).has(k) ? 'Traded in' : 'Your land'}</td><td>${bonusStr(empireBonus(k, p.era))}</td><td class="num">${spare.get(k) ?? 0}</td></tr>`).join('')
      : '<tr><td colspan="4"><small>None yet: settle near luxuries, or trade for them.</small></td></tr>';
    const offers = g.dealOffers.map((d, i) => `<tr>${this.dealText(d)}<td><small>${DEAL_TURNS} turns</small></td><td><button class="primary" data-do="dealAnswer" data-i="${i}" data-yes="1">Accept</button> <button data-do="dealAnswer" data-i="${i}" data-yes="0">Decline</button></td></tr>`).join('');
    const mine = g.deals.filter((d) => d.sides.some((s) => s.civ === HUMAN));
    const deals = mine.map((d) => `<tr>${this.dealText(d)}<td class="num">${d.until - g.turn}</td></tr>`).join('');
    const strategics = [...spare].filter(([k]) => resourceDef(k).kind !== 'luxury');
    return `<h3>Trade</h3>${!this.draft && this.notice ? `<p class="notice">${esc(this.notice)}</p>` : ''}
      <p class="note">The first copy of each luxury gives your whole civilization its bonus every turn, mostly cohesion, and it grows with the era. More copies add nothing, so you can trade them: a spare copy (you always keep one) for another civilization's goods or for gold a turn, for ${DEAL_TURNS} turns. A strategic resource you trade for lets you build what needs it. A war, losing the spare tile, or a payer running out of gold ends a deal.</p>
      ${offers ? `<h3>Offers to you</h3><table class="grid"><tr><th>From</th><th>You give</th><th>You get</th><th>Term</th><th></th></tr>${offers}</table>` : ''}
      ${this.draftHtml()}
      <h3>Your luxuries</h3><table class="grid"><tr><th>Luxury</th><th>From</th><th>Bonus to your civilization</th><th class="num">Spare copies</th></tr>${lux}</table>
      ${strategics.length ? `<p class="note">Spare strategic copies: ${strategics.map(([k, n]) => `${esc(resourceDef(k).name)} ×${n}`).join(', ')}.</p>` : ''}
      ${deals ? `<h3>Deals in force</h3><table class="grid"><tr><th>With</th><th>You give</th><th>You get</th><th>Turns left</th></tr>${deals}</table>` : ''}`;
  }

  private draftHtml(): string {
    const g = this.game, d = this.draft;
    if (!d || !g.canTrade(HUMAN, d.civ)) return '';
    const o = g.players[d.civ]!;
    const chips = (keys: ResourceKey[], side: 'give' | 'get', to: Player) => keys.length
      ? keys.map((k) => `<button class="tchip ${d[side] === k ? 'picked' : ''}" data-do="tradePick" data-side="${side}" data-key="${k}"><b>${esc(resourceDef(k).name)}</b> ${this.goodsNote(k, to)}</button>`).join('')
      : '<small class="none">No spare goods the other side lacks.</small>';
    const gold = (side: 'pay' | 'paid') => `<div class="tgold"><span>Gold a turn</span>${[-5, -1].map((n) => `<button data-do="tradeGold" data-side="${side}" data-n="${n}">${n}</button>`).join('')}<b>${d[side]}</b>${[1, 5].map((n) => `<button data-do="tradeGold" data-side="${side}" data-n="${n}">+${n}</button>`).join('')}</div>`;
    const sides = this.draftSides(d), block = g.dealBlock(sides);
    const verdict = block ?? (aiAcceptsDeal(g, o, sides) ? `The ${esc(o.name)} would accept.` : `The ${esc(o.name)} want more.`);
    return `<h3>Trade with the ${esc(o.name)}</h3>
      <div class="tradebox">
        <div class="tside"><span class="label">You give</span><div class="tchips">${chips(g.tradeable(HUMAN, o.id), 'give', o)}</div>${gold('pay')}</div>
        <div class="tside"><span class="label">The ${esc(o.name)} give</span><div class="tchips">${chips(g.tradeable(o.id, HUMAN), 'get', this.me)}</div>${gold('paid')}</div>
      </div>
      <div class="tfoot"><span class="${block ? 'bad' : ''}">${verdict}</span>${this.notice ? ` <b>${esc(this.notice)}</b>` : ''}<span class="grow"></span><button data-do="tradeCancel">Cancel</button> <button class="primary" data-do="tradePropose" ${block ? 'disabled' : ''}>Propose for ${DEAL_TURNS} turns</button></div>`;
  }
}
