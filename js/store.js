// 가구 데이터베이스, 배치도, 설정을 브라우저(localStorage)에 저장한다.

const KEY = 'room-tetris:v1';

const DEFAULTS = {
  // h 가 0 이면 배치도를 만들 때 방 높이에 맞춘다. clear: false = 앞 여유 공간 불필요. priority: 1~99(작을수록 먼저 배치), 없으면 맨 뒤.
  furniture: [], // { id, name, w, d, h, color, updatedAt, clear?, priority? }
  // gap, margin: 이 배치도를 배치할 때 쓴 간격·앞 여유 공간(설정이 다른 기기에서 열어도 같은 기준으로 보이게)
  // items 의 clear: false = 앞 여유 공간이 필요 없는 가구, aside: true = 자동 배치에서 빼 둔 인벤토리 가구,
  // locked: true = 위치를 고정한 가구(끌어도 안 움직이고, 자동 배치를 다시 해도 그 자리에 남는다)
  layouts: [], // { id, name, room:{w,d,h}, gap, margin, items:[{ id, fid, name, w, d, h, color, placed, x, z, rot, clear?, priority?, aside?, locked? }], createdAt, updatedAt }
  settings: { gap: 5, margin: 60, theme: 'system' }, // gap: 가구 사이 간격, margin: 가구 앞 여유 공간(cm)
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return structuredClone(DEFAULTS);
    return {
      furniture: Array.isArray(raw.furniture) ? raw.furniture : [],
      layouts: Array.isArray(raw.layouts) ? raw.layouts : [],
      settings: { ...DEFAULTS.settings, ...(raw.settings || {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const db = load();

/** @returns {boolean} 저장 성공 여부 */
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

// 가져오기를 되돌릴 수 있도록 직전 상태를 한 벌 따로 보관한다.
const BACKUP_KEY = 'room-tetris:backup';

export function saveBackup() {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: Date.now(), furniture: db.furniture, layouts: db.layouts }));
  } catch {
    /* 저장 공간이 부족하면 되돌리기 없이 진행한다 */
  }
}

/** @returns {{at:number, furniture:object[], layouts:object[]} | null} */
export function readBackup() {
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
    return b && Array.isArray(b.furniture) && Array.isArray(b.layouts) ? b : null;
  } catch {
    return null;
  }
}

export function restoreBackup() {
  const b = readBackup();
  if (!b) return false;
  db.furniture = b.furniture;
  db.layouts = b.layouts;
  if (!save()) return false;
  localStorage.removeItem(BACKUP_KEY);
  return true;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 서로 구분이 잘 되도록 색상환에서 멀리 떨어진 순서로 나열한 기본 색.
const PALETTE = [
  '#e5484d', '#3b82f6', '#22a55b', '#f59e0b', '#8b5cf6', '#14b8a6',
  '#ec4899', '#84cc16', '#f97316', '#0ea5e9', '#a16207', '#6366f1',
  '#d946ef', '#10b981', '#be123c', '#64748b',
];

/** 아직 쓰지 않은 색을 고른다. 다 썼으면 황금각으로 색상을 돌려 가며 새 색을 만든다. */
export function nextColor(used) {
  const taken = new Set(used.map((c) => String(c).toLowerCase()));
  const free = PALETTE.find((c) => !taken.has(c));
  if (free) return free;
  const hue = (used.length * 137.508) % 360;
  return hslToHex(hue, 62, 52);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
