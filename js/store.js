// 가구 데이터베이스, 배치도, 설정을 브라우저(localStorage)에 저장한다.

const KEY = 'room-tetris:v1';

const DEFAULTS = {
  furniture: [], // { id, name, w, d, h, color }
  layouts: [], // { id, name, room:{w,d,h}, items:[{ id, fid, name, w, d, h, color, placed, x, z, rot }], createdAt, updatedAt }
  settings: { gap: 5, theme: 'system' },
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
