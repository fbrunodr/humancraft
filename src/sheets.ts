import { HUMAN, EMBARK_TECH, DEAL_TURNS, TRUCE_TURNS, TRUCE_BREAK, VICTORIES, type Victory, type Game, type Player, type DealSide, type Deal } from './game.ts';
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
import { describe as describeEffect, describeAll, flat, type Effect } from './effects.ts';
import { ERAS, BUILDINGS, WONDERS, IMPROVEMENTS, OUTPUT_KEYS, type EraIndex, type ImprovementKey, type OutputKey } from './cities.ts';
import { UNITS, unitDef } from './rules.ts';
import { aiAcceptsDeal, resourceWorth, standing, attitude, ATTITUDES, RANKS, type Rank } from './ai.ts';
import { bonusStr, tip } from './ui.ts';
import { icon, unitIcon, YIELD_ICON } from './icons.ts';

// The empire's sheets: full-screen pages over the map, opened from the top
// bar (data-sheet: the research, politics and identity tracks, and the
// buttons; the science, cohesion, culture and faith yields open research,
// politics, identity and religion) and closed with Esc.
//   research    the tech tree: click a tech to research it (and what it needs first);
//               a box to find what gives something ("camp", "embark")
//   politics    the politics tree, likewise (governments and policies)
//   identity    the civ's identity: its paths and traits (identity.ts), to adopt
//   government  three tabs: the government in place and its policies, the
//               policy cards to slot, and the governments to adopt
//   religion    the world's religions and the civ's cities' faith
//   diplomacy   the civs met: at war or peace, declare war, offer or accept peace;
//               trade (resources, gold a turn): offers, deals in force, a proposal
//   log         the game's record of events (gameLog.ts), to download
// They change the game directly and then call `changed` (main.ts redraws).

export type SheetKind = 'research' | 'politics' | 'identity' | 'government' | 'religion' | 'diplomacy' | 'log';
const SHEETS: readonly SheetKind[] = ['research', 'politics', 'identity', 'government', 'religion', 'diplomacy', 'log'];
const isSheet = (s: string): s is SheetKind => (SHEETS as readonly string[]).includes(s);
type GovTab = 'mine' | 'policies' | 'governments';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const KIND_NAME: Record<PolicySlot, string> = { military: 'Military', economic: 'Economic', social: 'Social', wildcard: 'Wildcard' };
const TIER_NAME = ['', 'I', 'II', 'III'] as const;
// A tree's plates and the room between them (pixels). A plate is as tall as
// the tree's fullest needs: its name, then up to CHIP_ROWS rows of chips.
const NODE_W = 280, GAP_X = 56, GAP_Y = 14, TREE_TOP = 46, TREE_PAD = 8;
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
  private shown: SheetKind | null = null;   // the sheet last drawn (a tree opens scrolled to where the civ has got to)
  private readonly el: HTMLElement;
  private govTab: GovTab = 'mine';
  private find = '';                         // what the tree's box looks for
  private filter: PolicyKind | 'all' = 'all';
  private target: { slot: PolicySlot; i: number } | null = null;   // the slot a policy card will go to
  private notice = '';
  // The trade being drawn up: with whom, what each side gives.
  private draft: { civ: number; give: ResourceKey | null; get: ResourceKey | null; pay: number; paid: number } | null = null;

  constructor(private readonly game: Game, private readonly changed: () => void, private readonly downloadLog: () => void) {
    this.el = document.getElementById('sheet')!;
    document.body.addEventListener('click', (e) => {
      // (An icon is a target too: an SVG element, not an HTML one.)
      const t = e.target instanceof Element ? e.target : null;
      const btn = t?.closest<HTMLElement>('[data-sheet]');
      if (btn) { const k = btn.dataset['sheet'] ?? ''; if (isSheet(k)) { if (this.el.contains(btn)) this.show(k); else this.toggle(k); } return; }
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
      this.el.querySelectorAll<SVGPathElement>('svg.links path').forEach((p) => p.classList.toggle('lit', lit.has(p.dataset['b'] ?? '') && lit.has(p.dataset['a'] ?? '')));
    });
    // A tree's box: what is typed dims every item that does not give it.
    this.el.addEventListener('input', (e) => {
      if (!(e.target instanceof HTMLInputElement) || !e.target.matches('[data-find]')) return;
      this.find = e.target.value;
      this.applyFind(true);
    });
  }

  // Dims a tree's items that neither are nor give what the box asks for, and
  // marks the chips that do (`go`: brings the first such item into view).
  private applyFind(go: boolean): void {
    const q = this.find.trim().toLowerCase();
    let n = 0, first: HTMLElement | null = null;
    this.el.querySelectorAll<HTMLElement>('.node').forEach((node) => {
      const hit = q !== '' && (node.dataset['find'] ?? '').includes(q);
      node.classList.toggle('dim', q !== '' && !hit);
      node.querySelectorAll<HTMLElement>('.u').forEach((u) => u.classList.toggle('hit', q !== '' && (u.dataset['f'] ?? '').includes(q)));
      if (hit) { n++; first ??= node; }
    });
    const count = this.el.querySelector('.find small');
    if (count) count.textContent = q ? (n ? `${n} found` : 'nothing') : '';
    if (go && first) (first as HTMLElement).scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }

  get isOpen(): boolean { return this.open !== null; }
  private get me(): Player { return this.game.players[HUMAN]!; }

  toggle(k: SheetKind): void { this.open = this.open === k ? null : k; this.notice = ''; this.find = ''; this.render(); }
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
    const fresh = this.shown !== this.open;
    this.shown = this.open;
    const left = this.el.scrollLeft, top = this.el.scrollTop;
    const [title, sub, body] = this.page(this.open);
    // (Its head: its title, a tree's box to find things in it. The top bar goes from one sheet to another.)
    const tree = this.open === 'research' || this.open === 'politics';
    const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.matches('[data-find]');
    const find = tree ? `<label class="find">${icon('eye')}<input data-find type="text" spellcheck="false" placeholder="Find what gives… ${this.open === 'research' ? 'camp, embark, iron' : 'a policy, a government'}" value="${esc(this.find)}"><small></small></label>` : '';
    this.el.innerHTML = `<div class="head"><div class="stitle"><h2>${title}</h2><span class="sub">${sub}</span><span class="grow"></span>${find}
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
      case 'download': this.downloadLog(); return;
      default: return;
    }
    this.changed();
  }

  // ---- pages ----

  private page(k: SheetKind): [string, string, string] {
    const p = this.me;
    switch (k) {
      case 'research': return ['Research', this.trackSub('tech'), this.treeHtml('tech')];
      case 'politics': return ['Politics', this.trackSub('politics'), this.treeHtml('politics')];
      case 'identity': return ['Identity', `${Math.floor(p.identityPoints)} identity points · next trait ${this.game.nextTraitCost(p)} · ${p.ledger.income.culture} culture a turn`, this.identityHtml()];
      case 'government': return ['Government', governmentDef(p.government).name, this.governmentHtml()];
      case 'religion': return ['Religion', `${this.game.religions.size} of ${RELIGION_KEYS.length} founded`, this.religionHtml()];
      case 'diplomacy': return ['Diplomacy', 'Relations with the civilizations you have met', this.diplomacyHtml()];
      case 'log': return ['Log', `${this.game.events.length.toLocaleString()} events recorded`, this.logHtml()];
    }
  }

  private trackSub(k: 'tech' | 'politics'): string {
    const p = this.me, rate = k === 'tech' ? p.ledger.income.science : p.ledger.income.cohesion;
    const on = k === 'tech' ? (p.research ? techDef(p.research).name : null) : (p.studying ? politicsDef(p.studying).name : null);
    return `${on ? `On ${esc(on)}` : 'Nothing chosen'} · ${rate} ${k === 'tech' ? 'science' : 'cohesion'} a turn · click any item to work toward it`;
  }

  // What a tech or politics item unlocks and gives, each a named chip: a
  // unit, a building, a wonder, a government, a policy by their own signs;
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
      ...(d.units ?? []).map((u) => ({ cls: '', ic: icon(unitIcon(u)), name: UNITS[u].name, sub: unitDef(u).desc ?? 'Unit' })),
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
    return { cls: `e ${y ? YIELD_CLS[y] : ''}`, ic: icon(y ? YIELD_ICON[y] : 'up'), name, sub: text };
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
    // the item that needs it, and in; each item's own lane in that gap, so
    // lines to different items run side by side, not one over the other.
    let links = '';
    for (const k of keys) {
      const x2 = x(col.get(k)!), y2 = y(row.get(k)!) + NODE_H / 2, lane = x2 - 10 - (row.get(k)! % 5) * 8;
      for (const n of def(k).needs as readonly string[]) {
        const x1 = x(col.get(n)!) + NODE_W, y1 = y(row.get(n)!) + NODE_H / 2;
        const r = Math.min(7, Math.abs(y2 - y1) / 2), dir = Math.sign(y2 - y1);
        const d = dir === 0 ? `M${x1},${y1} H${x2}`
          : `M${x1},${y1} H${lane - r} Q${lane},${y1} ${lane},${y1 + dir * r} V${y2 - dir * r} Q${lane},${y2} ${lane + r},${y2} H${x2}`;
        const on = (k === current || queue.has(k)) && (n === current || queue.has(n));
        links += `<path class="${known.has(n) ? 'done' : on ? 'on' : ''}" data-a="${n}" data-b="${k}" d="${d}"/>`;
      }
    }
    const rows = Math.max(...keys.map((k) => row.get(k)!)) + 1;
    const width = x(cols.length) - GAP_X + TREE_PAD, height = y(rows) + 10;
    const bandHtml = bands.map((b) => `<div class="band" style="left:${x(b.from) - GAP_X / 2}px;width:${(b.to - b.from) * (NODE_W + GAP_X)}px"><span>${ERAS[b.era].name}</span></div>`).join('');
    // (Opened at the first column with something still to learn.)
    const first = Math.min(...keys.filter((k) => !known.has(k)).map((k) => col.get(k)!), cols.length - 1);
    return `<div class="tree ${kind}" data-tree="${kind}" data-start="${Math.max(0, x(first) - 80)}" style="width:${width}px;height:${height}px">${bandHtml}
      <svg class="links" width="${width}" height="${height}">${links}</svg>${keys.map(node).join('')}</div>`;
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
    const PAIRS = ['martial', 'devotion', 'commerce', 'frontier', 'maritime'] as const;
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
    const tab = (k: GovTab, label: string) => `<button class="${this.govTab === k ? 'active' : ''}" data-do="govTab" data-tab="${k}">${label}</button>`;
    const body = this.govTab === 'mine' ? this.myGovernmentHtml() : this.govTab === 'policies' ? this.policiesHtml() : this.governmentsHtml();
    return `<div class="tabs">${tab('mine', 'My government')}${tab('policies', 'Policies')}${tab('governments', 'Governments')}</div>
      ${this.notice ? `<p class="notice">${esc(this.notice)}</p>` : ''}${body}`;
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
    return `<div class="rules"><div><h4>Founding</h4><p>A religion is founded by the first civilization to adopt its faith, a trait of the Devotion path of identity (Meditation founds Hinduism). A civilization adopts one faith at most. Its religion is the one it founded, or else the one more than half of its people follow.</p></div>
      <div><h4>Spreading</h4><p>It spreads from its holy city to the cities around it, whoever owns them; Shrines and Temples press it harder. Each city following a religion gets its bonus; the founder takes 1 gold a turn from every city following it.</p></div>
      <div><h4>At war</h4><p>A civilization attacking one of its own religion fights ${Math.round(100 * FAITH_SAME)}% weaker; attacking one of another religion, ${Math.round(100 * FAITH_RIVAL)}% stronger; with no religion on either side, nothing. Its cities that follow the religion make ${HOLY_STRIFE.slice(1).map((x) => Math.round(100 * x) + '%').join(', ')} less cohesion while it is at war with one, two, three or more civilizations of its own religion.</p></div></div>
      <div class="rcards">${cards}</div>
      ${this.convertHtml()}
      ${cities ? `<h3>Your cities</h3><table class="grid"><tr><th>City</th><th>Follows</th></tr>${cities}</table>` : ''}`;
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
    if (!others.length) return this.standingsHtml() + '<p class="note">You have not met another civilization yet. Civilizations meet when their units or cities come within sight of each other.</p>';
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
    return `${this.standingsHtml()}<p class="note">How each civilization stands toward you is its own weighing of you, in broad: its plans stay its own. The columns rank it against you, in broad (no one knows another's exact figures); the computer's civilizations know of you, and of each other, the same ranks and no more. Everyone starts at peace; at peace, units cannot enter each other's tiles, and attacking a civilization declares war. A war lasts at least 8 turns before peace can be made; a peace is a truce for ${TRUCE_TURNS} turns, which can be broken at a price.</p>
      <table class="grid"><tr><th>Civilization</th><th>Toward you</th><th>Army</th><th>Technology</th><th>Production</th><th>Gold income</th><th></th><th></th></tr>${rows}</table>
      ${this.tradeHtml()}`;
  }

  // How the game is won, and where the civs you have met stand toward each way of winning it.
  private standingsHtml(): string {
    const g = this.game;
    const civs = g.players.filter((o) => o.alive && (o.id === HUMAN || g.met[HUMAN]![o.id])).sort((a, b) => g.score(b.id) - g.score(a.id));
    // (Toward each way of winning, in broad: the score, the era, a tenth of the world's people at a time.)
    const rows = civs.map((o) => `<tr><td><span class="swatch" style="background:${o.color}"></span> ${esc(o.name)}</td><td class="num">${g.score(o.id)}</td>
      <td>${ERAS[o.era].name}${o.id === HUMAN ? ` <small>${o.techs.size} of ${TECH_KEYS.length} technologies</small>` : ''}</td><td>${g.faithShare(o.id) > 0 ? `about ${Math.round(10 * g.faithShare(o.id)) * 10}%` : '—'}</td><td class="num">${g.capitalsHeld(o.id)} of the ${g.capitalsToWin} that win</td></tr>`).join('');
    return `<h3>How the game is won</h3><p class="note">${(Object.keys(VICTORIES) as Victory[]).map((k) => `<b>${VICTORIES[k].name}:</b> ${VICTORIES[k].rule}`).join(' ')} The last turn is ${g.turnLimit}.</p>
      <table class="grid"><tr><th>Civilization</th><th>Score</th><th>Era</th><th>World's people of its faith</th><th>First capitals held</th></tr>${rows}</table><h3>Relations</h3>`;
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
      <h3>Your luxuries</h3><table class="grid"><tr><th>Luxury</th><th>From</th><th>Bonus to your civilization</th><th>Spare copies</th></tr>${lux}</table>
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

  private logHtml(): string {
    const g = this.game;
    const mine = g.events.filter((e) => e.player === HUMAN && e.kind !== 'move' && e.kind !== 'summary').slice(-40).reverse();
    const rows = mine.map((e) => `<tr><td class="num">${e.turn}</td><td>${e.kind}</td><td><small>${esc(JSON.stringify(e.data))}</small></td></tr>`).join('');
    return `<p class="note">Every action of every player, human and computer, is recorded each turn (moves, research, politics, identity, policies, battles, cities, diplomacy, and a summary of each civilization's accounts). In development the record is also written to <b>logs/</b> in the project folder as the game goes.</p>
      <div class="buttons"><button data-do="download">Download the full log (JSON lines)</button></div>
      <h3>Your recent actions</h3><table class="grid"><tr><th>Turn</th><th>Kind</th><th>Details</th></tr>${rows}</table>`;
  }
}
