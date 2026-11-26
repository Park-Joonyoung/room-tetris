// 화면 구성: 가구 관리 / 배치도 관리 / 배치도 편집 / 설정

import { db, save, uid, nextColor, saveBackup, readBackup, restoreBackup } from './store.js';
import { solve, seededRandom } from './solver.js';
import { rectOf, clamp } from './geom.js';
import { TransferError, LINK_PARAM, LONG_LINK_CHARS, buildExport, planMerge, toFileText, fromFileText, encodePayload, decodePayload, makeLink, extractPayload } from './transfer.js';

// 안드로이드 앱(WebView) 안에서 열렸을 때만 있는 기능 모음. 브라우저에서는 null.
// WebView 는 파일 내려받기·공유를 스스로 못 해서 앱이 대신 해 준다(android/ 의 MainActivity).
const nativeApp = typeof window.RoomTetrisApp === 'object' && window.RoomTetrisApp ? window.RoomTetrisApp : null;

const app = document.getElementById('app');
const overlayRoot = document.getElementById('overlay-root');
const toastRoot = document.getElementById('toast-root');

// ───────────────────────── 작은 도구들 ─────────────────────────

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v; // 고정된 아이콘·SVG 문자열에만 사용
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k !== 'form' && k in el) el[k] = v; // form 은 읽기 전용 속성이라 attribute 로 넣는다
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid);
  }
  return el;
}

const ICON_PATHS = {
  sofa: '<path d="M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M6 18v2M18 18v2"/>',
  cube: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>',
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
};

function icon(name) {
  return h('span', {
    class: 'icon',
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`,
  });
}

const num = (v) => String(Math.round(v * 10) / 10);
// 가구의 높이 0 은 "배치도를 만들 때 방 높이에 맞춘다"는 뜻이다(천장까지 닿는 붙박이장 등).
const dimsText = (o) => (o.h === 0 ? `${num(o.w)} × ${num(o.d)} cm × 높이 최대` : `${num(o.w)} × ${num(o.d)} × ${num(o.h)} cm`);
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#888888');

function parseCm(text) {
  const v = Number(String(text).trim().replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : NaN;
}

let toastTimer = 0;
function toast(message, ms = 2600) {
  toastRoot.replaceChildren(h('div', { class: 'toast', role: 'status' }, message));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastRoot.replaceChildren(), ms);
}

function persist() {
  if (!save()) toast('저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
}

/** 모달(휴대폰에서는 아래에서 올라오는 시트). @returns {{close: () => void}} */
function openModal({ title, body, footer, wide = false, stack = false, onDismiss = null }) {
  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };
  const dismiss = () => {
    close();
    onDismiss?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') dismiss();
  };
  const sheet = h(
    'div',
    { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'header',
      { class: 'modal-head' },
      h('h2', null, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: dismiss }, icon('close')),
    ),
    h('div', { class: 'modal-body' }, body),
    footer ? h('footer', { class: `modal-foot${stack ? ' stack' : ''}` }, footer) : null,
  );
  const backdrop = h('div', { class: 'backdrop', onpointerdown: (e) => e.target === backdrop && dismiss() }, sheet);
  overlayRoot.append(backdrop);
  document.addEventListener('keydown', onKey);
  const first = sheet.querySelector('input:not([type=color]):not([type=checkbox])');
  // 휴대폰에서는 자동으로 키보드가 올라오지 않게, 마우스 환경에서만 첫 칸에 포커스
  if (first && matchMedia('(pointer: fine)').matches) first.focus();
  return { close };
}

function confirmDialog(title, message, okLabel = '삭제') {
  return new Promise((resolve) => {
    let modal;
    const done = (v) => {
      modal.close();
      resolve(v);
    };
    modal = openModal({
      title,
      body: h('p', { class: 'modal-text' }, message),
      footer: [
        h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, '취소'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => done(true) }, okLabel),
      ],
    });
  });
}

function field(label, input, unit) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: `field-box${unit ? ' has-unit' : ''}` }, input, unit ? h('em', null, unit) : null));
}

function cmInput(value, placeholder) {
  return h('input', { type: 'text', inputMode: 'decimal', autocomplete: 'off', value: value ?? '', placeholder, class: 'input' });
}

/** 가로·세로·높이 입력값을 읽어 검증한다. 잘못된 칸이 있으면 표시하고 null. */
function readDims(inputs, { zeroHeight = false } = {}) {
  const out = {};
  let ok = true;
  for (const [key, input] of Object.entries(inputs)) {
    const v = parseCm(input.value);
    // 가구의 높이만 0 을 받는다(방 높이에 맞춤). 그 밖의 값은 0 보다 커야 한다.
    // 빈칸은 0 으로 읽히지 않게 따로 막는다.
    const filled = input.value.trim() !== '';
    const valid = filled && (v > 0 || (zeroHeight && key === 'h' && v === 0)) && v <= 5000;
    input.classList.toggle('invalid', !valid);
    if (!valid) ok = false;
    out[key] = v;
  }
  return ok ? out : null;
}

// ───────────────────────── 테마 ─────────────────────────

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const pref = db.settings.theme;
  const dark = pref === 'dark' || (pref !== 'light' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#12141a' : '#ffffff');
  editor?.view?.applyTheme();
}
darkQuery.addEventListener('change', applyTheme);

// ───────────────────────── 라우터 ─────────────────────────

let editor = null; // 열려 있는 배치도 편집 화면
let pendingNotice = null; // 배치도를 막 만들었을 때 편집 화면에서 보여 줄 결과

const NAV = [
  { key: 'furniture', label: '가구 관리', icon: 'sofa' },
  { key: 'layouts', label: '배치도 관리', icon: 'cube' },
  { key: 'settings', label: '설정', icon: 'gear' },
];

function route() {
  // 저장하지 않은 내용이 있는데 편집 화면을 벗어나려 하면(뒤로가기 포함),
  // 일단 편집 화면 주소로 되돌려 놓고 나갈지 물어본다.
  if (editor && !editor.leaving && editor.isDirty() && location.hash !== editor.hash) {
    history.pushState(null, '', editor.hash);
    editor.confirmLeave(() => history.back());
    return;
  }

  // 가져오기 링크(#import=...)로 들어온 경우: 주소에서 데이터를 지우고 배치도 목록 위에 확인 창을 띄운다.
  let importPayload = null;
  if (location.hash.startsWith(`#${LINK_PARAM}`)) {
    importPayload = location.hash.slice(1 + LINK_PARAM.length);
    history.replaceState(null, '', '#/layouts');
  }

  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  activeSolve?.abandon();
  overlayRoot.replaceChildren();
  toastRoot.replaceChildren();
  if (editor) {
    editor.destroy();
    editor = null;
  }
  document.body.classList.remove('editing');

  if (name === 'layout') {
    const layout = db.layouts.find((l) => l.id === arg);
    if (layout) return void openEditor(layout);
    location.replace('#/layouts');
    return;
  }
  const key = NAV.some((n) => n.key === name) ? name : db.furniture.length ? 'layouts' : 'furniture';
  const page = h('main', { class: 'page' });
  app.replaceChildren(
    h(
      'div',
      { class: 'shell' },
      h(
        'nav',
        { class: 'nav', 'aria-label': '메뉴' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('cube')), h('b', null, '룸 테트리스')),
        NAV.map((n) =>
          h('a', { class: `nav-link${n.key === key ? ' active' : ''}`, href: `#/${n.key}`, 'aria-current': n.key === key ? 'page' : null }, icon(n.icon), h('span', null, n.label)),
        ),
      ),
      page,
    ),
  );
  ({ furniture: renderFurniture, layouts: renderLayouts, settings: renderSettings })[key](page);
  window.scrollTo(0, 0);
  if (importPayload !== null) importFromPayload(importPayload);
}

// ───────────────────────── 가구 관리 ─────────────────────────

/** 가구(또는 배치도 안의 가구)에 앞 여유 공간이 필요한지 적는다. 필요하면 표시를 지우고, 필요 없으면 clear: false. */
function setClear(target, needed) {
  if (needed) delete target.clear;
  else target.clear = false;
}

/**
 * 가구 관리에서 "앞 여유 공간 적용"을 바꾸면, 그 가구가 들어 있는 기존 배치도에도 똑같이 반영한다.
 * @returns {number} 바뀐 배치도 수
 */
function applyClearToLayouts(furnitureId, needed, at) {
  let changed = 0;
  for (const layout of db.layouts) {
    let touched = false;
    for (const it of layout.items) {
      if (it.fid !== furnitureId || (it.clear !== false) === needed) continue;
      setClear(it, needed);
      touched = true;
    }
    if (touched) {
      layout.updatedAt = at; // 다른 기기로 옮길 때 이 변경이 최신으로 넘어가도록
      changed++;
    }
  }
  return changed;
}

function renderFurniture(page) {
  const list = db.furniture;
  page.replaceChildren(
    h('header', { class: 'page-head' }, h('h1', null, '가구 관리'), h('p', null, '가구의 가로·세로·높이를 등록해 두면 배치도를 만들 때 골라 쓸 수 있어요.')),
    h('button', { class: 'btn primary big', type: 'button', onclick: () => openFurnitureForm(null, () => renderFurniture(page)) }, icon('plus'), '가구 생성'),
    list.length
      ? h(
          'ul',
          { class: 'cards' },
          list.map((f) =>
            h(
              'li',
              { class: 'card' },
              h(
                'button',
                { class: 'card-main', type: 'button', onclick: () => openFurnitureForm(f, () => renderFurniture(page)) },
                h('span', { class: 'swatch', style: { background: safeColor(f.color) } }),
                h('span', { class: 'card-text' }, h('b', null, f.name), h('small', null, f.h === 0 ? `가로 ${num(f.w)} · 세로 ${num(f.d)} cm · 높이 최대(방 높이)` : `가로 ${num(f.w)} · 세로 ${num(f.d)} · 높이 ${num(f.h)} cm`, f.clear === false ? h('span', { class: 'badge' }, '앞 여유 공간 없음') : null)),
              ),
              h(
                'button',
                {
                  class: 'icon-btn danger',
                  type: 'button',
                  'aria-label': `${f.name} 삭제`,
                  onclick: async () => {
                    if (!(await confirmDialog('가구 삭제', `'${f.name}'을(를) 삭제할까요? 이미 만든 배치도에는 그대로 남아 있어요.`))) return;
                    db.furniture = db.furniture.filter((x) => x.id !== f.id);
                    persist();
                    renderFurniture(page);
                  },
                },
                icon('trash'),
              ),
            ),
          ),
        )
      : h('div', { class: 'empty' }, icon('sofa'), h('b', null, '아직 등록한 가구가 없어요'), h('p', null, '위의 가구 생성 버튼으로 침대, 옷장, 책상 같은 가구를 추가해 보세요.')),
  );
}

function openFurnitureForm(existing, onDone) {
  const name = h('input', { type: 'text', class: 'input', value: existing?.name ?? '', placeholder: '예: 침대', maxLength: 30, autocomplete: 'off' });
  const dims = { w: cmInput(existing?.w, '예: 200'), d: cmInput(existing?.d, '예: 100'), h: cmInput(existing?.h, '예: 45') };
  const clearBox = h('input', { type: 'checkbox', checked: existing ? existing.clear !== false : true });
  const color = h('input', { type: 'color', class: 'color-input', value: safeColor(existing?.color ?? nextColor(db.furniture.map((f) => f.color))) });
  let modal;
  const form = h(
    'form',
    {
      class: 'form',
      id: 'furniture-form',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const nm = name.value.trim();
        name.classList.toggle('invalid', !nm);
        const d = readDims(dims, { zeroHeight: true });
        if (!nm || !d) return toast('이름과 크기를 확인해 주세요. 가로·세로는 0보다 커야 하고, 높이는 0(방 높이에 맞춤) 이상이어야 해요.', 4500);
        const updatedAt = Date.now(); // 다른 기기와 합칠 때 어느 쪽이 최신인지 판단하는 기준
        const needsClear = clearBox.checked;
        let changedLayouts = 0;
        if (existing) {
          const before = existing.clear !== false;
          Object.assign(existing, { name: nm, ...d, color: color.value, updatedAt });
          setClear(existing, needsClear);
          if (before !== needsClear) changedLayouts = applyClearToLayouts(existing.id, needsClear, updatedAt);
        } else {
          const created = { id: uid(), name: nm, ...d, color: color.value, updatedAt };
          setClear(created, needsClear);
          db.furniture.push(created);
        }
        persist();
        if (changedLayouts) toast(`이 가구가 들어 있는 배치도 ${changedLayouts}개에서도 앞 여유 공간 적용을 ${needsClear ? '켰어요' : '껐어요'}.`, 4000);
        modal.close();
        onDone();
      },
    },
    field('이름', name),
    h('div', { class: 'field-row' }, field('가로', dims.w, 'cm'), field('세로', dims.d, 'cm'), field('높이', dims.h, 'cm')),
    h('p', { class: 'hint' }, '가로는 벽을 따라 놓이는 길이, 세로는 벽에서 방 안쪽으로 나오는 깊이예요.'),
    h('p', { class: 'hint' }, '높이에 0을 넣으면 배치도를 만들 때 그 방의 높이(최대)로 맞춰져요. 천장까지 닿는 가구에 쓰세요.'),
    h('label', { class: 'field color-field' }, h('span', { class: 'field-label' }, '색'), color, h('small', null, '배치도에서 이 색으로 표시돼요.')),
    h('label', { class: 'switch-row' }, clearBox, h('span', null, h('b', null, '앞 여유 공간 적용'), h('small', null, '끄면 이 가구 앞에는 자리를 비워 두지 않아요. 침대나 문처럼 앞에 설 자리가 필요 없는 가구에 쓰세요.'))),
    existing ? h('p', { class: 'hint' }, '이 설정을 바꾸면 이 가구가 들어 있는 기존 배치도에도 함께 반영돼요.') : null,
  );
  modal = openModal({
    title: existing ? '가구 수정' : '가구 생성',
    body: form,
    footer: [
      h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, '취소'),
      h('button', { class: 'btn primary', type: 'submit', form: 'furniture-form' }, existing ? '저장' : '생성'),
    ],
  });
}

// ───────────────────────── 배치도 관리 ─────────────────────────

function thumbnail(layout) {
  const { w, d } = layout.room;
  const pad = Math.max(w, d) * 0.05;
  const sw = Math.max(w, d) * 0.03;
  const rects = layout.items
    .filter((it) => it.placed)
    .map((it) => {
      const r = rectOf(it);
      return `<rect x="${r.x.toFixed(1)}" y="${r.z.toFixed(1)}" width="${r.sx.toFixed(1)}" height="${r.sz.toFixed(1)}" rx="${(sw * 0.6).toFixed(1)}" fill="${safeColor(it.color)}"/>`;
    })
    .join('');
  return h('span', {
    class: 'thumb',
    'aria-hidden': 'true',
    html: `<svg viewBox="${-pad} ${-pad} ${w + pad * 2} ${d + pad * 2}" preserveAspectRatio="xMidYMid meet"><rect class="thumb-floor" x="0" y="0" width="${Number(w)}" height="${Number(d)}"/>${rects}<path class="thumb-wall" d="M0 0H${Number(w)}V${Number(d)}H0Z" fill="none" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  });
}

function renderLayouts(page) {
  const list = db.layouts;
  page.replaceChildren(
    h('header', { class: 'page-head' }, h('h1', null, '배치도 관리'), h('p', null, '방 크기를 입력하면 가구를 벽면에 자동으로 배치해 드려요.')),
    h('button', { class: 'btn primary big', type: 'button', onclick: () => openLayoutWizard() }, icon('plus'), '배치도 생성'),
    list.length
      ? h(
          'ul',
          { class: 'cards' },
          list.map((l) => {
            const placed = l.items.filter((it) => it.placed).length;
            const stored = l.items.length - placed;
            return h(
              'li',
              { class: 'card' },
              h(
                'a',
                { class: 'card-main', href: `#/layout/${l.id}` },
                thumbnail(l),
                h(
                  'span',
                  { class: 'card-text' },
                  h('b', null, l.name),
                  h('small', null, dimsText(l.room)),
                  h('small', null, `배치 ${placed}개`, stored ? h('span', { class: 'badge' }, `인벤토리 ${stored}개`) : null),
                ),
              ),
              h(
                'button',
                {
                  class: 'icon-btn danger',
                  type: 'button',
                  'aria-label': `${l.name} 삭제`,
                  onclick: async () => {
                    if (!(await confirmDialog('배치도 삭제', `'${l.name}' 배치도를 삭제할까요?`))) return;
                    db.layouts = db.layouts.filter((x) => x.id !== l.id);
                    persist();
                    renderLayouts(page);
                  },
                },
                icon('trash'),
              ),
            );
          }),
        )
      : h('div', { class: 'empty' }, icon('cube'), h('b', null, '아직 만든 배치도가 없어요'), h('p', null, '배치도 생성을 눌러 방 크기를 입력해 보세요.')),
  );
}

function openLayoutWizard() {
  if (!db.furniture.length) {
    let modal;
    modal = openModal({
      title: '가구를 먼저 등록해 주세요',
      body: h('p', { class: 'modal-text' }, '배치할 가구가 아직 없어요. 가구 관리에서 가구를 만든 다음 배치도를 생성해 주세요.'),
      footer: [
        h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, '닫기'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => ((location.hash = '#/furniture'), modal.close()) }, '가구 관리로 이동'),
      ],
    });
    return;
  }
  const draft = { name: '', w: '', d: '', h: '', selected: new Set(db.furniture.map((f) => f.id)) };
  wizardRoomStep(draft);
}

// 1단계: 방 이름과 크기
function wizardRoomStep(draft) {
  const name = h('input', { type: 'text', class: 'input', value: draft.name, placeholder: '예: 침실', maxLength: 30, autocomplete: 'off' });
  const dims = { w: cmInput(draft.w, '예: 400'), d: cmInput(draft.d, '예: 300'), h: cmInput(draft.h, '예: 240') };
  let modal;
  const form = h(
    'form',
    {
      class: 'form',
      id: 'room-form',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const nm = name.value.trim();
        name.classList.toggle('invalid', !nm);
        const d = readDims(dims);
        if (!nm || !d) return toast('방 이름과 크기(0보다 큰 숫자)를 확인해 주세요.');
        Object.assign(draft, { name: nm, ...d });
        modal.close();
        wizardFurnitureStep(draft);
      },
    },
    h('p', { class: 'steps' }, h('b', null, '1'), ' 방 정보 ', h('i', null, '›'), ' 2 가구 선택'),
    field('방 이름', name),
    h('div', { class: 'field-row' }, field('가로', dims.w, 'cm'), field('세로', dims.d, 'cm'), field('높이', dims.h, 'cm')),
    h('p', { class: 'hint' }, '가구는 방의 네 벽면을 따라 배치돼요. 안쪽 두 벽부터 채우고, 모자라면 나머지 두 벽도 써요.'),
  );
  modal = openModal({
    title: '배치도 생성',
    body: form,
    footer: [
      h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, '취소'),
      h('button', { class: 'btn primary', type: 'submit', form: 'room-form' }, '다음'),
    ],
  });
}

// 2단계: 포함할 가구 선택(기본은 전체 선택)
function wizardFurnitureStep(draft) {
  let modal;
  const count = h('b', null);
  const create = h('button', { class: 'btn primary', type: 'button' }, '배치도 생성');
  const rows = db.furniture.map((f) => {
    const box = h('input', { type: 'checkbox', checked: draft.selected.has(f.id) });
    box.addEventListener('change', () => {
      if (box.checked) draft.selected.add(f.id);
      else draft.selected.delete(f.id);
      sync();
    });
    return {
      f,
      box,
      el: h(
        'label',
        { class: 'pick' },
        box,
        h('span', { class: 'swatch', style: { background: safeColor(f.color) } }),
        h('span', { class: 'card-text' }, h('b', null, f.name), h('small', null, dimsText(f))),
        h('span', { class: 'pick-check' }, icon('check')),
      ),
    };
  });
  const sync = () => {
    count.textContent = `${draft.selected.size} / ${db.furniture.length}개 선택`;
    for (const r of rows) {
      r.box.checked = draft.selected.has(r.f.id);
      r.el.classList.toggle('on', r.box.checked);
    }
  };
  const setAll = (on) => {
    draft.selected = new Set(on ? db.furniture.map((f) => f.id) : []);
    sync();
  };
  create.addEventListener('click', async () => {
    modal.close();
    const layout = await createLayout(draft);
    if (layout) location.hash = `#/layout/${layout.id}`;
    else wizardFurnitureStep(draft); // 계산을 취소하면 가구 선택으로 돌아온다
  });
  sync();
  modal = openModal({
    title: '배치도 생성',
    wide: true,
    body: h(
      'div',
      { class: 'form' },
      h('p', { class: 'steps' }, '1 방 정보 ', h('i', null, '›'), h('b', null, ' 2'), ' 가구 선택'),
      h(
        'div',
        { class: 'pick-bar' },
        count,
        h('span', { class: 'pick-actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => setAll(true) }, '전체 선택'), h('button', { class: 'btn small', type: 'button', onclick: () => setAll(false) }, '전체 해제')),
      ),
      h('p', { class: 'hint' }, '선택하지 않은 가구는 인벤토리에 들어가요. 나중에 방으로 끌어다 놓을 수 있어요.'),
      h('div', { class: 'pick-list' }, rows.map((r) => r.el)),
    ),
    footer: [
      h('button', { class: 'btn', type: 'button', onclick: () => (modal.close(), wizardRoomStep(draft)) }, '이전'),
      create,
    ],
  });
}

async function createLayout(draft) {
  const room = { w: draft.w, d: draft.d, h: draft.h };
  // 선택하지 않은 가구도 버리지 않고 인벤토리에 넣어 둔다(aside: 자동 배치에서 빼 둔 가구).
  // 나중에 마음이 바뀌면 방으로 끌어다 놓을 수 있다.
  const items = db.furniture.map((f) => ({
    id: uid(),
    fid: f.id,
    name: f.name,
    w: f.w,
    d: f.d,
    h: f.h === 0 ? room.h : f.h, // 높이 0 으로 등록한 가구는 이 방의 높이(놓을 수 있는 최대 높이)로 맞춘다
    color: f.color,
    placed: false,
    x: 0,
    z: 0,
    rot: 0,
    ...(f.clear === false ? { clear: false } : {}),
    ...(draft.selected.has(f.id) ? {} : { aside: true }),
  }));
  const chosen = items.filter((it) => !it.aside);
  // 배치할 때 쓴 간격·앞 여유 공간을 배치도에 함께 적어 둔다.
  // 설정이 다른 기기에서 열어도 이 배치도는 같은 기준으로 보인다.
  const rules = { gap: db.settings.gap, margin: db.settings.margin };
  const result = await runSolver(room, chosen, rules);
  if (!result) return null; // 사용자가 취소함
  applyPlacements(chosen, result);
  const now = Date.now();
  const layout = { id: uid(), name: draft.name, room, ...rules, items, createdAt: now, updatedAt: now };
  db.layouts.unshift(layout);
  persist();
  const message = resultMessage(result, chosen.length);
  const left = items.length - chosen.length;
  if (left) message.text += ` 선택하지 않은 가구 ${left}개는 인벤토리에 넣어 두었어요.`;
  pendingNotice = { id: layout.id, message };
  return layout;
}

/** 자동 배치 결과를 가구 목록에 반영한다. 못 놓은 가구는 인벤토리로. */
function applyPlacements(items, result) {
  const byId = new Map(result.placements.map((p) => [p.id, p]));
  for (const it of items) {
    const p = byId.get(it.id);
    if (p) Object.assign(it, { placed: true, x: p.x, z: p.z, rot: p.rot });
    else it.placed = false;
  }
}

function resultMessage(result, total) {
  const placed = result.placements.length;
  if (total === 0) return { ok: true, text: '가구 없이 빈 방으로 만들었어요.' };
  if (placed === total) return { ok: true, text: `가구 ${total}개를 모두 배치했어요.` };
  const rest = `${total}개 중 ${placed}개만 배치하고, 남은 ${total - placed}개는 인벤토리에 두었어요.`;
  // 시간이 다 됐거나 중간에 멈춘 경우에는 "불가능"이라고 단정할 수 없다.
  if (result.timedOut) return { ok: false, text: `제한 시간 안에 모두 놓는 방법을 찾지 못했어요. ${rest}` };
  return { ok: false, text: `배치 불가능: 선택한 가구를 벽면에 모두 놓을 수 없어요. ${rest}` };
}

// ───────────────────────── 자동 배치 계산 ─────────────────────────
// 계산은 백그라운드(Web Worker)에서 돌린다. 최대 30초까지 더 좋은 배치를 찾고,
// 그동안 화면은 멈추지 않아서 취소하거나 뒤로 갈 수 있다.

const SOLVE_LIMIT_MS = 30000;
let activeSolve = null;

/**
 * @returns {Promise<object|null>} 배치 결과. 사용자가 취소하면 null.
 *   화면을 떠나서 중단된 경우에는 끝나지 않는다(이어서 할 일이 없으므로).
 */
function runSolver(room, items, { shuffle = false, gap = db.settings.gap, margin = db.settings.margin } = {}) {
  const job = {
    room,
    items: items.map(({ id, w, d, h: height, clear }) => ({ id, w, d, h: height, clear: clear !== false })),
    gap,
    margin,
    timeLimitMs: SOLVE_LIMIT_MS,
    seed: shuffle ? Math.floor(Math.random() * 0xffffffff) : null,
  };
  const total = items.length;

  return new Promise((resolve) => {
    const started = Date.now();
    let worker = null;
    let latest = null; // 지금까지 찾은 가장 좋은 배치
    let modal = null;
    let settled = false;
    let showTimer = 0;
    let tick = 0;

    const status = h('p', { class: 'solve-status' }, '가구를 놓을 방법을 찾고 있어요…');
    const clock = h('small', { class: 'solve-clock' });
    const bar = h('i', null);
    const useNow = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => finish(latest && { ...latest, timedOut: true }) }, '지금 결과 사용');

    const cleanup = () => {
      settled = true;
      clearTimeout(showTimer);
      clearInterval(tick);
      worker?.terminate();
      modal?.close();
      activeSolve = null;
    };
    const finish = (result) => {
      if (settled) return;
      cleanup();
      resolve(result);
    };
    const update = () => {
      const sec = Math.min(SOLVE_LIMIT_MS, Date.now() - started) / 1000;
      clock.textContent = `${Math.floor(sec)}초 / 최대 ${SOLVE_LIMIT_MS / 1000}초`;
      bar.style.width = `${(sec / (SOLVE_LIMIT_MS / 1000)) * 100}%`;
      if (latest) {
        status.textContent = `지금까지 ${total}개 중 ${latest.placements.length}개를 놓는 방법을 찾았어요. 더 좋은 방법을 찾는 중…`;
        useNow.disabled = false;
      }
    };
    const showProgress = () => {
      if (settled) return;
      modal = openModal({
        title: '자동 배치 중',
        body: h('div', { class: 'solve' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), status, h('div', { class: 'solve-bar' }, bar), clock),
        footer: [h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, '취소'), useNow],
        onDismiss: () => finish(null),
      });
      update();
      tick = setInterval(update, 250);
    };
    // 워커를 쓸 수 없는 브라우저에서는 화면이 멈추므로 짧게만 계산한다.
    const fallback = () => {
      worker?.terminate();
      worker = null;
      setTimeout(() => {
        if (settled) return;
        const random = job.seed == null ? null : seededRandom(job.seed);
        finish(solve(job.room, job.items, job.gap, { margin: job.margin, timeLimitMs: 3000, random }));
      }, 30);
    };

    activeSolve = { abandon: cleanup };
    try {
      worker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
    } catch {
      return fallback();
    }
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        latest = e.data.result;
        if (modal) update();
      } else {
        finish(e.data.result);
      }
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      if (!settled) fallback();
    };
    worker.postMessage(job);
    showTimer = setTimeout(showProgress, 400); // 금방 끝나는 계산에는 창을 띄우지 않는다
  });
}

// ───────────────────────── 배치도 편집 ─────────────────────────

async function openEditor(layout) {
  document.body.classList.add('editing');
  const { room } = layout;
  const hash = `#/layout/${layout.id}`;
  // 편집은 작업본에서 하고, 저장하기를 눌러야 실제 배치도에 반영된다.
  let items = structuredClone(layout.items);
  // 이 배치도가 배치될 때 쓴 간격·앞 여유 공간. 화면 표시와 달라붙기는 이 값을 따른다.
  // (이 값이 생기기 전에 만든 배치도는 이 기기의 설정을 쓴다.)
  const rules = { gap: layout.gap ?? db.settings.gap, margin: layout.margin ?? db.settings.margin };
  const stateJson = () => JSON.stringify(items);
  let savedJson = stateJson();
  // 배치도의 간격이나 앞 여유 공간이 이 기기의 설정과 다르면 보기만 할 수 있다.
  // 다른 기준으로 섞어 고치면 배치가 어느 기준에도 맞지 않게 되기 때문이다.
  const mismatches = [
    { name: '간격', own: layout.gap, device: db.settings.gap },
    { name: '앞 여유 공간', own: layout.margin, device: db.settings.margin },
  ].filter((m) => m.own !== undefined && m.own !== m.device);
  const readOnly = mismatches.length > 0;
  const readOnlyText = `읽기 전용: 이 배치도의 ${mismatches.map((m) => `${m.name}(${num(m.own)}cm)`).join('과 ')}이 이 기기의 설정(${mismatches.map((m) => `${num(m.device)}cm`).join(', ')})과 달라서 수정할 수 없어요. 수정하려면 배치도를 새로 만들어 주세요.`;
  const blockedEdit = () => toast(readOnlyText, 5000);
  const history = [];
  let view = null;
  let destroyed = false;
  let leaveModal = null;

  const isDirty = () => stateJson() !== savedJson;

  const stage = h('div', { class: 'ed-stage' });
  const banner = h('div', { class: 'ed-banner', hidden: true });
  const invList = h('div', { class: 'inv-list' });
  const invCount = h('span', { class: 'badge' });
  const inventory = h('aside', { class: 'ed-inv' }, h('div', { class: 'inv-head' }, h('b', null, '인벤토리'), invCount, h('small', null, '끌어서 방에 놓기')), invList);
  const undoBtn = h('button', { class: 'tool', type: 'button', disabled: true, title: '되돌리기', 'aria-label': '되돌리기', onclick: () => undo() }, icon('undo'), h('span', null, '되돌리기'));
  const arrangeBtn = h('button', { class: 'tool', type: 'button', title: '가구를 벽면에 다시 자동 배치', 'aria-label': '자동 배치', onclick: () => rearrange() }, icon('shuffle'), h('span', null, '자동 배치'));
  const saveBtn = h('button', { class: 'tool save', type: 'button', disabled: true, title: '변경한 배치를 저장', onclick: () => save() }, icon('check'), h('span', null, '저장하기'));
  const backBtn = h(
    'a',
    {
      class: 'icon-btn',
      href: '#/layouts',
      'aria-label': '배치도 목록으로',
      onclick: (e) => {
        if (!isDirty()) return;
        e.preventDefault();
        confirmLeave(() => (location.hash = '#/layouts'));
      },
    },
    icon('back'),
  );
  const subtitle = h('small', null, dimsText(room));

  // 손으로 옮길 때 간격과 앞 여유 공간을 지킬지. 기본은 둘 다 켜짐이고, 끄면 그 제한 없이 움직인다.
  const enforce = { gap: true, margin: true };
  const ruleToggle = (key, label, value) => {
    const button = h(
      'button',
      {
        class: 'rule-toggle',
        type: 'button',
        disabled: readOnly,
        'aria-pressed': 'true',
        title: `${label}을 지키며 옮기기`,
        onclick: () => {
          enforce[key] = !enforce[key];
          button.setAttribute('aria-pressed', String(enforce[key]));
          view?.setEnforce(enforce);
          toast(enforce[key] ? `${label}을 지키도록 켰어요. 이보다 가까이는 움직이지 않아요.` : `${label} 제한을 껐어요. 자유롭게 움직일 수 있어요.`);
        },
      },
      h('span', { class: 'rule-check' }, icon('check')),
      `${label} ${num(value)}cm`,
    );
    return button;
  };
  const rulesBar = h('div', { class: 'ed-rules', role: 'group', 'aria-label': '옮길 때 지킬 규칙' }, ruleToggle('gap', '간격', rules.gap), ruleToggle('margin', '앞 여유 공간', rules.margin));
  // 앱 안에서는 항상 손가락으로 쓰므로 터치용 안내를 보여 준다.
  const touch = !!nativeApp || matchMedia('(pointer: coarse)').matches;
  const hint = h(
    'p',
    { class: 'ed-hint' },
    touch
      ? '가구를 누르면 이름 · 끌면 이동 · 빈 곳을 밀면 시점 회전 · 두 손가락으로 확대/축소'
      : '가구 클릭: 이름 · 드래그: 이동 · 빈 곳 드래그: 시점 회전 · Ctrl+스크롤: 확대/축소',
  );
  let wheelHintAt = 0;

  app.replaceChildren(
    h(
      'div',
      { class: 'editor' },
      h('header', { class: 'ed-bar' }, backBtn, h('div', { class: 'ed-title' }, h('b', null, layout.name), subtitle), h('div', { class: 'ed-tools' }, readOnly ? h('span', { class: 'badge warn' }, '읽기 전용') : [undoBtn, arrangeBtn, saveBtn])),
      h(
        'div',
        { class: 'ed-main' },
        stage,
        rulesBar,
        banner,
        hint,
        h(
          'div',
          { class: 'ed-zoom' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': '확대', onclick: () => view?.zoomBy(1.25) }, icon('plus')),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': '축소', onclick: () => view?.zoomBy(0.8) }, icon('minus')),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': '기본 시점으로', onclick: () => view?.resetView() }, icon('home')),
        ),
      ),
      inventory,
    ),
  );

  // 탭을 닫거나 새로고침할 때도 저장하지 않은 내용이 있으면 브라우저가 한 번 물어본다.
  const onBeforeUnload = (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  editor = {
    view: null,
    hash,
    leaving: false,
    isDirty,
    confirmLeave,
    destroy() {
      destroyed = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      view?.dispose();
    },
  };

  const item = (id) => items.find((it) => it.id === id);
  const snapshot = () => {
    history.push(stateJson());
    if (history.length > 60) history.shift();
  };
  /** 작업본이 바뀐 뒤 화면을 맞춘다. 저장은 하지 않고 저장하기 버튼만 켠다. */
  const refresh = () => {
    view?.setItems(items);
    renderInventory();
    undoBtn.disabled = history.length === 0;
    const dirty = isDirty();
    saveBtn.disabled = !dirty;
    saveBtn.classList.toggle('dirty', dirty);
  };
  // 사용자가 인벤토리로 보낸 가구는 자동 배치에서 빼 둔다(aside). 방으로 다시 꺼내면 포함된다.
  // (자동 배치가 자리를 못 찾아 남긴 가구는 aside 가 아니라서, 다시 자동 배치하면 또 시도한다.)
  const stash = (ids) => {
    for (const id of ids) {
      const it = item(id);
      if (it) Object.assign(it, { placed: false, aside: true });
    }
  };
  const displacedToast = (ids) => {
    if (!ids.length) return;
    const names = ids.map((id) => item(id)?.name).filter(Boolean);
    toast(`${names.join(', ')}을(를) 인벤토리로 옮겼어요.`);
  };

  function save() {
    if (!isDirty()) return;
    layout.items = structuredClone(items);
    layout.gap = rules.gap;
    layout.margin = rules.margin;
    layout.updatedAt = Date.now();
    savedJson = stateJson();
    persist();
    refresh();
    toast('배치도를 저장했어요.');
  }

  /** 저장하지 않은 내용이 있을 때 나가려 하면 물어본다. go 는 실제로 나가는 동작. */
  function confirmLeave(go) {
    if (leaveModal) return;
    const done = (action) => {
      leaveModal.close();
      leaveModal = null;
      if (!action) return;
      if (action === 'save') save();
      editor.leaving = true;
      go();
    };
    leaveModal = openModal({
      title: '저장하지 않은 내용이 있어요',
      body: h('p', { class: 'modal-text' }, '바꾼 배치가 아직 저장되지 않았어요. 저장하지 않고 나갈까요?'),
      stack: true,
      footer: [
        h('button', { class: 'btn primary', type: 'button', onclick: () => done('save') }, '저장하고 나가기'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => done('discard') }, '저장하지 않고 나가기'),
        h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, '계속 편집'),
      ],
      onDismiss: () => (leaveModal = null),
    });
  }

  function undo() {
    const prev = history.pop();
    if (!prev) return;
    items = JSON.parse(prev);
    refresh();
  }

  async function rearrange() {
    // 인벤토리에 빼 둔 가구(선택하지 않았거나 직접 보낸 것)는 건드리지 않는다.
    const active = items.filter((it) => !it.aside);
    if (!active.length) return toast('자동 배치할 가구가 없어요. 인벤토리의 가구를 방에 끌어다 놓으면 포함돼요.', 4000);
    arrangeBtn.disabled = true;
    // 이 배치도의 간격·앞 여유 공간으로 다시 배치한다.
    // (기기 설정과 다르면 읽기 전용이라 여기까지 오지 않으므로, 기기 설정과 같은 값이다.)
    const result = await runSolver(room, active, { shuffle: true, ...rules });
    arrangeBtn.disabled = false;
    if (!result || destroyed) return;
    snapshot();
    applyPlacements(active, result);
    refresh();
    showBanner(resultMessage(result, active.length));
  }

  let bannerTimer = 0;
  function showBanner({ ok, text }) {
    clearTimeout(bannerTimer);
    banner.className = `ed-banner ${ok ? 'ok' : 'warn'}`;
    banner.replaceChildren(h('span', null, text), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: () => (banner.hidden = true) }, icon('close')));
    banner.hidden = false;
    if (ok) bannerTimer = setTimeout(() => (banner.hidden = true), 3500);
  }

  function renderInventory() {
    const stored = items.filter((it) => !it.placed);
    invCount.textContent = String(stored.length);
    invList.replaceChildren(
      ...(stored.length
        ? stored.map((it) => {
            const chip = h(
              'div',
              { class: 'chip', title: '방으로 끌어다 놓으세요' },
              h('span', { class: 'swatch', style: { background: safeColor(it.color) } }),
              h('span', { class: 'card-text' }, h('b', null, it.name), h('small', null, dimsText(it))),
            );
            bindChipDrag(chip, it);
            return chip;
          })
        : [h('p', { class: 'inv-empty' }, '모든 가구가 방에 배치되어 있어요.')]),
    );
  }

  // 인벤토리의 가구를 끌어서 방에 놓기
  function bindChipDrag(chip, it) {
    let st = null;
    chip.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dragging: false, ghost: null };
      try {
        chip.setPointerCapture(e.pointerId);
      } catch {
        /* 무시 */
      }
    });
    chip.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id || !view) return;
      if (!st.dragging) {
        if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < 8) return;
        if (readOnly) {
          st = null;
          blockedEdit();
          return;
        }
        if (!view.externalStart(it)) {
          st = null;
          toast('이 가구는 방보다 커서 놓을 수 없어요.');
          return;
        }
        st.dragging = true;
        chip.classList.add('lifting');
        st.ghost = chip.cloneNode(true);
        st.ghost.className = 'chip drag-ghost';
        document.body.append(st.ghost);
      }
      e.preventDefault();
      const over = view.externalMove(e.clientX, e.clientY);
      st.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -130%)`;
      st.ghost.classList.toggle('over-stage', over);
    });
    const end = (e, cancelled) => {
      if (!st || e.pointerId !== st.id) return;
      const s = st;
      st = null;
      if (!s.dragging) {
        if (!cancelled) readOnly ? blockedEdit() : toast('가구를 끌어서 방에 놓아 보세요.');
        return;
      }
      s.ghost.remove();
      chip.classList.remove('lifting');
      if (cancelled) return void view.externalCancel();
      const res = view.externalEnd(e.clientX, e.clientY);
      if (!res) return;
      if (res.blocked) return void toast('간격이나 앞 여유 공간 때문에 여기에는 놓을 수 없어요. 다른 자리에 놓거나, 위의 버튼으로 제한을 꺼 주세요.', 4500);
      snapshot();
      Object.assign(it, { placed: true, x: res.x, z: res.z, rot: res.rot });
      delete it.aside;
      stash(res.displaced);
      displacedToast(res.displaced);
      refresh();
      view.select(it.id);
    };
    chip.addEventListener('pointerup', (e) => end(e, false));
    chip.addEventListener('pointercancel', (e) => end(e, true));
  }

  const overInventory = (x, y) => {
    const r = inventory.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  refresh();

  let RoomView;
  try {
    ({ RoomView } = await import('./room-view.js'));
    if (destroyed) return;
    view = new RoomView(stage, {
      getGap: () => rules.gap,
      getMargin: () => rules.margin,
      isReadOnly: () => readOnly,
      onBlockedEdit: blockedEdit,
      onInteract: () => hint.classList.add('gone'),
      onPlainWheel() {
        if (Date.now() - wheelHintAt < 4000) return;
        wheelHintAt = Date.now();
        toast('Ctrl 키를 누른 채 스크롤하면 확대·축소돼요.');
      },
      isOverInventory: overInventory,
      onInventoryHover: (over) => inventory.classList.toggle('drop-target', over),
      onMove(id, x, z, rot, displaced) {
        const it = item(id);
        if (!it) return;
        snapshot();
        Object.assign(it, { x, z, rot });
        stash(displaced); // 옮긴 자리에 원래 있던 가구는 인벤토리로
        displacedToast(displaced);
        refresh();
      },
      onStash(id) {
        if (!item(id)) return;
        snapshot();
        stash([id]);
        refresh();
      },
    });
  } catch (err) {
    console.error(err);
    if (!destroyed) stage.replaceChildren(h('div', { class: 'empty' }, icon('cube'), h('b', null, '3D 화면을 표시할 수 없어요'), h('p', null, '이 브라우저에서 WebGL을 사용할 수 없어요. 다른 브라우저로 열어 보세요.')));
    return;
  }
  editor.view = view;
  view.setRoom(room);
  view.setItems(items);

  if (readOnly) showBanner({ ok: false, text: readOnlyText });
  else if (pendingNotice && pendingNotice.id === layout.id) showBanner(pendingNotice.message);
  pendingNotice = null;
}

// ───────────────────────── 내보내기 / 가져오기 ─────────────────────────

function showMessage(title, text) {
  let modal;
  modal = openModal({
    title,
    body: h('p', { class: 'modal-text' }, text),
    footer: [h('button', { class: 'btn primary', type: 'button', onclick: () => modal.close() }, '확인')],
  });
}

function importFailed(err) {
  if (!(err instanceof TransferError)) console.error(err);
  showMessage('가져올 수 없어요', err instanceof TransferError ? err.message : '데이터를 읽는 중 문제가 생겼어요.');
}

async function importFromPayload(payload) {
  try {
    confirmImport(await decodePayload(payload));
  } catch (err) {
    importFailed(err);
  }
}

/** 가져올 내용과 합친 결과를 미리 보여 주고, 확인하면 합친다. */
function confirmImport(data) {
  if (!data.furniture.length && !data.layouts.length) return showMessage('가져올 내용이 없어요', '비어 있는 데이터예요.');
  const plan = planMerge(db, data);
  const { furniture: f, layouts: l, changes } = plan.summary;
  if (changes === 0) {
    return showMessage('새로 가져올 내용이 없어요', '들어 있는 가구와 배치도가 이미 이 기기에 있고, 이 기기의 내용이 같거나 더 최신이에요.');
  }
  const row = (label, a, b) => (a || b ? h('li', null, h('span', null, label), h('b', null, [a ? `가구 ${a}개` : null, b ? `배치도 ${b}개` : null].filter(Boolean).join(' · '))) : null);
  let modal;
  modal = openModal({
    title: '데이터 가져오기',
    body: h(
      'div',
      { class: 'form' },
      h('p', { class: 'modal-text' }, `가구 ${data.furniture.length}개, 배치도 ${data.layouts.length}개가 들어 있어요. 이 기기의 데이터와 합칠까요?`),
      h('ul', { class: 'merge-list' }, row('새로 추가', f.added, l.added), row('더 최신 내용으로 바꿈', f.updated, l.updated), row('그대로 둠', f.unchanged, l.unchanged)),
      h('p', { class: 'hint' }, '이 기기에 있던 가구와 배치도는 지워지지 않아요. 가져온 뒤에도 설정에서 되돌릴 수 있어요.'),
    ),
    footer: [
      h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, '취소'),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: () => {
            modal.close();
            saveBackup(); // 가져오기 직전 상태를 보관해 두어 되돌릴 수 있게 한다
            db.furniture = plan.furniture;
            db.layouts = plan.layouts;
            persist();
            route();
            toast(`가져왔어요. 가구 ${f.added + f.updated}개, 배치도 ${l.added + l.updated}개가 반영됐어요.`);
          },
        },
        '합치기',
      ),
    ],
  });
}

function downloadFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function hasData() {
  if (db.furniture.length || db.layouts.length) return true;
  toast('내보낼 가구나 배치도가 아직 없어요.');
  return false;
}

function exportFile() {
  if (!hasData()) return;
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const name = `room-tetris-${stamp}.json`;
  const text = toFileText(buildExport(db));
  // 앱에서는 저장할 위치를 고르는 화면이 뜨고, 저장이 끝나면 앱이 알려 준다.
  if (nativeApp?.saveFile) return void nativeApp.saveFile(name, text);
  downloadFile(name, text);
  toast('파일로 저장했어요. 다른 기기로 옮긴 뒤 설정에서 가져오세요.');
}

async function exportLink() {
  return makeLink(location.href, await encodePayload(buildExport(db)));
}

/** 복사가 막힌 브라우저에서는 링크를 직접 보여 준다. */
function showLink(link, note) {
  const box = h('textarea', { class: 'input link-box', readOnly: true, rows: 4, value: link, onfocus: () => box.select() });
  let modal;
  modal = openModal({
    title: '내보내기 링크',
    body: h('div', { class: 'form' }, h('p', { class: 'modal-text' }, note), box),
    footer: [h('button', { class: 'btn primary', type: 'button', onclick: () => modal.close() }, '닫기')],
  });
}

const LONG_LINK_NOTE = '데이터가 많아서 링크가 길어요. 메신저에 따라 링크가 잘릴 수 있으니, 잘 안 되면 파일로 저장해서 옮겨 주세요.';

async function copyLink() {
  if (!hasData()) return;
  try {
    const link = await exportLink();
    if (nativeApp?.copy) {
      nativeApp.copy(link);
    } else {
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        return showLink(link, '아래 링크를 길게 눌러 복사한 뒤 다른 기기로 보내 주세요.');
      }
    }
    if (link.length > LONG_LINK_CHARS) showMessage('링크를 복사했어요', LONG_LINK_NOTE);
    else toast('링크를 복사했어요. 다른 기기로 보내서 열어 주세요.');
  } catch (err) {
    importFailed(err);
  }
}

async function shareLink() {
  if (!hasData()) return;
  try {
    const link = await exportLink();
    if (nativeApp?.share) return void nativeApp.share(link);
    await navigator.share({ title: '룸 테트리스 데이터', url: link });
  } catch (err) {
    if (err?.name !== 'AbortError') toast('공유하지 못했어요. 링크 복사를 이용해 주세요.');
  }
}

async function importFile(file) {
  try {
    if (file.size > 5 * 1024 * 1024) throw new TransferError('파일이 너무 커요.');
    confirmImport(fromFileText(await file.text()));
  } catch (err) {
    importFailed(err);
  }
}

// ───────────────────────── 설정 ─────────────────────────

/** 설정의 숫자 항목(cm): 직접 입력 + 줄이기/늘리기 버튼 */
function cmStepper(key, step, name) {
  const input = h('input', { type: 'text', inputMode: 'decimal', class: 'input', value: num(db.settings[key]), autocomplete: 'off', 'aria-label': `${name}(cm)` });
  const set = (v) => {
    if (!(v >= 0 && v <= 300)) {
      input.classList.add('invalid');
      return;
    }
    input.classList.remove('invalid');
    db.settings[key] = Math.round(v * 10) / 10;
    persist();
  };
  input.addEventListener('input', () => set(parseCm(input.value)));
  input.addEventListener('blur', () => {
    input.value = num(db.settings[key]);
    input.classList.remove('invalid');
  });
  const bump = (delta) => {
    set(clamp(db.settings[key] + delta, 0, 300));
    input.value = num(db.settings[key]);
  };
  return h(
    'div',
    { class: 'stepper' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${name} 줄이기`, onclick: () => bump(-step) }, icon('minus')),
    h('span', { class: 'field-box' }, input, h('em', null, 'cm')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${name} 늘리기`, onclick: () => bump(step) }, icon('plus')),
  );
}

function renderSettings(page) {
  const themes = [
    { key: 'system', label: '시스템 설정' },
    { key: 'light', label: '라이트' },
    { key: 'dark', label: '다크' },
  ];
  const themeButtons = themes.map((t) =>
    h(
      'button',
      {
        class: 'seg-btn',
        type: 'button',
        'aria-pressed': String(db.settings.theme === t.key),
        onclick: () => {
          db.settings.theme = t.key;
          persist();
          applyTheme();
          themeButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(themes[i].key === t.key)));
        },
      },
      t.label,
    ),
  );

  page.replaceChildren(
    h('header', { class: 'page-head' }, h('h1', null, '설정')),
    h(
      'section',
      { class: 'panel' },
      h('h2', null, '가구 사이 간격'),
      h('p', null, '자동 배치할 때 가구와 가구 사이를 이만큼 띄워요. 배치도에서 가구를 직접 끌 때도 이보다 가까이는 붙지 않아요.'),
      cmStepper('gap', 1, '가구 사이 간격'),
    ),
    h(
      'section',
      { class: 'panel' },
      h('h2', null, '가구 앞 여유 공간'),
      h('p', null, '가구를 쓰려면 앞에 서거나 앉을 자리가 필요해요. 자동 배치할 때 가구 앞(벽 반대쪽)으로 이만큼은 다른 가구가 들어오지 않게 비워 둬요. 0으로 두면 여유 없이 배치해요.'),
      cmStepper('margin', 5, '가구 앞 여유 공간'),
      h('p', { class: 'hint' }, '침대나 문처럼 앞에 설 자리가 필요 없는 가구는 가구 관리에서 "앞 여유 공간 적용"을 끄면 돼요.'),
      h('p', { class: 'hint' }, '배치도에서 가구를 누르면 이 공간이 바닥에 옅게 표시돼요. 가구를 직접 끌 때도 간격과 이 공간을 침범하는 자리로는 움직이지 않고, 편집 화면 위쪽의 버튼으로 각각 끌 수 있어요.'),
      h('p', { class: 'hint' }, '간격과 여유 공간은 배치도를 만들 때의 값이 그 배치도에 함께 저장돼요. 그래서 설정을 바꾸거나 다른 기기에서 열어도 이미 만든 배치도는 그대로예요. 다만 간격이나 앞 여유 공간이 지금 설정과 다른 배치도는 읽기 전용으로 열려서 볼 수만 있어요. 고치려면 설정을 맞추거나 배치도를 새로 만들어 주세요.'),
    ),
    h('section', { class: 'panel' }, h('h2', null, '화면 모드'), h('div', { class: 'seg', role: 'group', 'aria-label': '화면 모드' }, themeButtons)),
    renderDataPanel(page),
  );
}

function renderDataPanel(page) {
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onchange: () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) importFile(file);
    },
  });
  const paste = h('input', { type: 'text', class: 'input', placeholder: '받은 링크 붙여넣기', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': '가져오기 링크' });
  const importPasted = () => {
    const payload = extractPayload(paste.value);
    if (!payload) {
      paste.classList.add('invalid');
      return toast('가져오기 링크가 아니에요. 링크 전체를 붙여넣어 주세요.');
    }
    paste.classList.remove('invalid');
    paste.value = '';
    importFromPayload(payload);
  };
  paste.addEventListener('keydown', (e) => e.key === 'Enter' && importPasted());

  const backup = readBackup();
  const when = backup ? new Date(backup.at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  return h(
    'section',
    { class: 'panel' },
    fileInput,
    h('h2', null, '데이터 옮기기'),
    h('p', null, '가구와 배치도는 이 기기의 브라우저에만 저장돼요. 다른 기기에서도 쓰려면 여기서 내보낸 뒤 그 기기에서 가져오세요.'),
    h('h3', null, '내보내기', h('small', null, `가구 ${db.furniture.length}개 · 배치도 ${db.layouts.length}개`)),
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn', type: 'button', onclick: exportFile }, '파일로 저장'),
      h('button', { class: 'btn', type: 'button', onclick: copyLink }, '링크 복사'),
      typeof navigator.share === 'function' || nativeApp?.share ? h('button', { class: 'btn', type: 'button', onclick: shareLink }, '링크 공유') : null,
    ),
    h('h3', null, '가져오기'),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, '파일 선택')),
    h('div', { class: 'paste-row' }, paste, h('button', { class: 'btn', type: 'button', onclick: importPasted }, '가져오기')),
    h(
      'p',
      { class: 'hint' },
      '가져온 내용은 지금 데이터에 합쳐져요. 없는 것은 추가되고, 같은 항목은 더 최근에 고친 쪽이 남아요. 받은 링크를 눌렀을 때 카카오톡 같은 다른 앱 안의 화면으로 열리면 거기에만 저장되니, 그럴 때는 링크를 복사해서 여기에 붙여넣어 주세요.',
    ),
    backup
      ? h(
          'div',
          { class: 'btn-row' },
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: async () => {
                if (!(await confirmDialog('마지막 가져오기 되돌리기', `${when}에 가져오기 직전 상태로 되돌려요. 그 뒤에 바꾼 내용은 사라져요.`, '되돌리기'))) return;
                if (restoreBackup()) toast('가져오기 전 상태로 되돌렸어요.');
                else toast('되돌리지 못했어요.');
                renderSettings(page);
              },
            },
            '마지막 가져오기 되돌리기',
          ),
        )
      : null,
  );
}

// ───────────────────────── 시작 ─────────────────────────

applyTheme();
window.addEventListener('hashchange', route);
route();
