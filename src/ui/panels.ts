// Couple-layer dialogs: mailbox, Memory Tree, and "while you were away".
// Text from the partner is always inserted with textContent, never as HTML.
import { t } from '../i18n';
import { STORY_BEATS } from '../sim/milestones';
import { LETTER_MAX, MEMORY_TITLE_MAX, awaySummary, type Letter } from '../sim/couple';
import { now } from '../clock';
import { vnDay, type FarmState } from '../sim/farm';
import { RECIPES, canCook } from '../sim/kitchen';
import { haveCount } from '../sim/orders';
import { sellPrice } from '../sim/species';
import { ROLE_IDS, hasSynergy, rankFor, rankProgress, titleKey, type RoleId } from '../sim/roles';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export interface PanelHandlers {
  /** Resolve true when saved, so the text is only cleared on success. */
  sendLetter(text: string): Promise<boolean>;
  readLetters(): void;
  addMemory(date: string, title: string): Promise<boolean>;
  chooseRole(role: RoleId): void;
  cook(recipeId: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function when(ts: number) {
  return new Date(ts).toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export class Panels {
  constructor(private h: PanelHandlers) {
    for (const id of ['mail', 'tree', 'away', 'roles', 'kitchen']) {
      $(`#${id}-close`).addEventListener('click', () => ($(`#${id}`).hidden = true));
    }
    $('#mail-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const box = $<HTMLTextAreaElement>('#mail-text');
      if (!box.value.trim()) return;
      void this.h.sendLetter(box.value).then((ok) => ok && (box.value = ''));
    });
    $('#tree-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const title = $<HTMLInputElement>('#tree-title');
      const date = $<HTMLInputElement>('#tree-date');
      if (!title.value.trim() || !date.value) return;
      void this.h.addMemory(date.value, title.value).then((ok) => ok && (title.value = ''));
    });
    $<HTMLTextAreaElement>('#mail-text').maxLength = LETTER_MAX;
    $<HTMLInputElement>('#tree-title').maxLength = MEMORY_TITLE_MAX;
  }

  get mailOpen() {
    return !$('#mail').hidden;
  }

  get treeOpen() {
    return !$('#tree').hidden;
  }

  get rolesOpen() {
    return !$('#roles').hidden;
  }

  get kitchenOpen() {
    return !$('#kitchen').hidden;
  }

  /** Recipes with what you have of each ingredient and a Cook button. */
  openKitchen(s: FarmState, icon: (cv: HTMLCanvasElement, id: string) => void) {
    this.labels();
    $('#kitchen-list').replaceChildren(
      ...RECIPES.map((r) => {
        const row = el('div', 'shop-row recipe');
        const cv = el('canvas');
        cv.width = cv.height = 16;
        icon(cv, r.id);
        const name = el('span', 'nm', `${t(`sp.${r.id}`)}`);
        const need = Object.entries(r.inputs)
          .map(([item, n]) => `${t(`sp.${item}`)} ${Math.min(haveCount(s, item), n)}/${n}`)
          .join(' · ');
        name.append(el('small', '', `${need} · ${sellPrice(r.id, 1)} ${t('coins')}`));
        const b = el('button', '', t('cook'));
        b.disabled = !canCook(s, r);
        b.addEventListener('click', () => this.h.cook(r.id));
        row.append(cv, name, b);
        return row;
      }),
    );
    $('#kitchen').hidden = false;
  }

  /** Role cards: what each role is good at, your rank, perks by rank, and who has it. */
  openRoles(s: FarmState, uid: string, names: Record<string, string>) {
    this.labels();
    const me = s.players[uid];
    $('#roles-title').textContent = `${t(titleKey(me))}${hasSynergy(s) ? ` · ${t('synergy_on')}` : ''}`;
    $('#roles-list').replaceChildren(
      ...ROLE_IDS.map((role) => {
        const xp = me?.roleXp[role] ?? 0;
        const rank = rankFor(xp);
        const mine = me?.role === role;
        const card = el('article', `role${mine ? ' mine' : ''}`);
        const head = el('header');
        head.append(el('b', '', t(`role.${role}`)), el('span', '', `${t(`rank.${rank}`)} · ${rank}/5`));
        const bar = el('i');
        bar.style.setProperty('--p', `${Math.round(rankProgress(xp) * 100)}%`);
        const perks = el('ul');
        for (let r = 2; r <= 5; r++) {
          perks.append(el('li', rank >= r ? 'got' : '', `${r}. ${t(`perk.${role}.${r}`)}`));
        }
        const holders = Object.entries(s.players)
          .filter(([, p]) => p.role === role)
          .map(([u]) => names[u] ?? '♥');
        const foot = el('footer');
        foot.append(el('small', '', holders.length ? `${t('role_held_by')} ${holders.join(', ')}` : ''));
        const pick = el('button', '', mine ? t('role_current') : t('role_pick'));
        pick.disabled = mine;
        pick.addEventListener('click', () => this.h.chooseRole(role));
        foot.append(pick);
        card.append(head, el('p', 'muted', t(`role_desc.${role}`)), bar, perks, foot);
        return card;
      }),
    );
    $('#roles').hidden = false;
  }

  close() {
    for (const id of ['mail', 'tree', 'away', 'roles', 'kitchen']) $(`#${id}`).hidden = true;
  }

  private labels() {
    for (const e of document.querySelectorAll<HTMLElement>(
      '#mail [data-t], #tree [data-t], #away [data-t], #roles [data-t], #kitchen [data-t]',
    )) {
      e.textContent = t(e.dataset.t!);
    }
    $<HTMLTextAreaElement>('#mail-text').placeholder = t('mail_placeholder');
    $<HTMLInputElement>('#tree-title').placeholder = t('tree_placeholder');
  }

  openMail(s: FarmState, uid: string, names: Record<string, string>) {
    this.labels();
    const list = $('#mail-list');
    const letters: Letter[] = s.letters;
    // Story letters from the villagers sit above the couple's letters, newest first.
    const story = STORY_BEATS.slice(0, s.story?.beat ?? 0)
      .map((b, i) => {
        const card = el('article', `letter story${i >= (s.story?.read[uid] ?? 0) ? ' unread' : ''}`);
        card.append(el('header', '', `${t(`npc.${b.npc}`)} · ${t('story_chapter')}`), el('p', '', t(`story.${i + 1}`)));
        return card;
      })
      .reverse();
    list.replaceChildren(
      ...story,
      ...(letters.length
        ? letters.map((l) => {
            const card = el(
              'article',
              `letter${l.from === uid ? ' mine' : ''}${!l.read && l.from !== uid ? ' unread' : ''}`,
            );
            card.append(el('header', '', `${names[l.from] ?? '♥'} · ${when(l.t)}`), el('p', '', l.text));
            return card;
          })
        : story.length
          ? []
          : [el('p', 'muted', t('mail_empty'))]),
    );
    $('#mail').hidden = false;
    this.h.readLetters();
  }

  openTree(s: FarmState, names: Record<string, string>) {
    this.labels();
    const date = $<HTMLInputElement>('#tree-date');
    if (!date.value) date.value = vnDay(now()); // Vietnam calendar day, not UTC
    $('#tree-count').textContent = t('tree_count', { n: s.memories.length });
    $('#tree-list').replaceChildren(
      ...(s.memories.length
        ? [...s.memories].reverse().map((m) => {
            const row = el('li');
            row.append(el('time', '', m.date), el('span', '', m.title), el('small', '', names[m.by] ?? ''));
            return row;
          })
        : [el('li', 'muted', t('tree_empty'))]),
    );
    $('#tree').hidden = false;
  }

  /** Shows what the partner did since `since`; returns false if nothing happened. */
  openAway(s: FarmState, uid: string, since: number, partnerName: string): boolean {
    const summary = awaySummary(s, uid, since);
    const entries = Object.entries(summary);
    if (!entries.length) return false;
    this.labels();
    $('#away-title').textContent = t('away_title', { name: partnerName });
    $('#away-list').replaceChildren(...entries.map(([msg, n]) => el('li', '', t(`away.${msg}`, { n }))));
    $('#away').hidden = false;
    return true;
  }
}
