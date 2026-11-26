// 내보내기 / 가져오기.
//
// 서버가 없으므로 가구와 배치도를 한 덩어리(JSON)로 꺼내 파일이나 링크에 담아 옮긴다.
// 가져올 때는 내용을 전부 검사한 뒤, 이미 있는 데이터와 "합친다"(지우지 않는다).
//   - 이 기기에 없는 항목(id 기준)은 추가
//   - 같은 id 가 있으면 수정 시각(updatedAt)이 더 최근인 쪽을 남김
// 화면 모드나 간격 같은 설정은 기기별 취향이라 옮기지 않는다.

const APP = 'room-tetris';
const VERSION = 1;
const MAX_FURNITURE = 2000;
const MAX_LAYOUTS = 500;
const MAX_ITEMS = 500;
const MAX_CM = 5000;
const MAX_BYTES = 5 * 1024 * 1024;
export const LINK_PARAM = 'import=';
/** 이보다 긴 링크는 메신저에서 잘릴 수 있어 파일을 권한다. */
export const LONG_LINK_CHARS = 6000;

export class TransferError extends Error {}

// ───────────────────────── 내보내기 ─────────────────────────

export function buildExport(db) {
  return {
    app: APP,
    version: VERSION,
    exportedAt: Date.now(),
    furniture: db.furniture,
    layouts: db.layouts,
  };
}

// ───────────────────────── 검사 ─────────────────────────

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function str(v, max, what) {
  if (typeof v !== 'string' || !v.trim()) throw new TransferError(`${what}이(가) 비어 있어요.`);
  return v.trim().slice(0, max);
}

function size(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_CM) throw new TransferError(`${what} 값이 올바르지 않아요.`);
  return Math.round(v * 10) / 10;
}

/** 가구의 높이: 0 은 "배치도를 만들 때 방 높이에 맞춘다"는 뜻이라 허용한다. */
function furnitureHeight(v) {
  return v === 0 ? 0 : size(v, '가구 높이');
}

function coord(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.min(Math.max(Math.round(v * 1000) / 1000, 0), MAX_CM);
}

/** 배치도에 기록된 간격·앞 여유 공간(cm). 없거나 이상하면 undefined(받는 기기의 설정을 쓰게 된다). */
function rule(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 300 ? Math.round(v * 10) / 10 : undefined;
}

const time = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const color = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '#888888');

function uniqueById(list) {
  const seen = new Set();
  return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/**
 * 가져온 내용을 검사하고, 앱이 쓰는 형태로 깨끗하게 다시 만든다.
 * 조금이라도 이상하면 TransferError 를 던지고 아무것도 돌려주지 않는다.
 */
export function parseImport(raw) {
  if (!isObj(raw) || raw.app !== APP) throw new TransferError('룸 테트리스에서 내보낸 데이터가 아니에요.');
  if (raw.version !== VERSION) throw new TransferError('지원하지 않는 버전의 데이터예요. 앱을 새로고침한 뒤 다시 시도해 주세요.');
  if (!Array.isArray(raw.furniture) || !Array.isArray(raw.layouts)) throw new TransferError('데이터 형식이 올바르지 않아요.');
  if (raw.furniture.length > MAX_FURNITURE || raw.layouts.length > MAX_LAYOUTS) throw new TransferError('데이터가 너무 많아요.');

  const furniture = raw.furniture.map((f) => {
    if (!isObj(f)) throw new TransferError('가구 데이터 형식이 올바르지 않아요.');
    const out = {
      id: str(f.id, 64, '가구 id'),
      name: str(f.name, 30, '가구 이름'),
      w: size(f.w, '가구 가로'),
      d: size(f.d, '가구 세로'),
      h: furnitureHeight(f.h),
      color: color(f.color),
      updatedAt: time(f.updatedAt),
    };
    if (f.clear === false) out.clear = false; // 앞 여유 공간이 필요 없는 가구
    return out;
  });

  const layouts = raw.layouts.map((l) => {
    if (!isObj(l) || !isObj(l.room) || !Array.isArray(l.items)) throw new TransferError('배치도 데이터 형식이 올바르지 않아요.');
    if (l.items.length > MAX_ITEMS) throw new TransferError('배치도에 가구가 너무 많아요.');
    const items = l.items.map((it) => {
      if (!isObj(it)) throw new TransferError('배치도 데이터 형식이 올바르지 않아요.');
      const out = {
        id: str(it.id, 64, '가구 id'),
        fid: typeof it.fid === 'string' ? it.fid.slice(0, 64) : '',
        name: str(it.name, 30, '가구 이름'),
        w: size(it.w, '가구 가로'),
        d: size(it.d, '가구 세로'),
        h: size(it.h, '가구 높이'),
        color: color(it.color),
        placed: it.placed === true,
        x: coord(it.x),
        z: coord(it.z),
        rot: it.rot === 2 || it.rot === 3 ? it.rot : it.rot ? 1 : 0, // 등을 댄 벽(0~3)
      };
      if (it.clear === false) out.clear = false;
      if (it.aside === true && !out.placed) out.aside = true; // 자동 배치에서 빼 둔 인벤토리 가구
      return out;
    });
    const createdAt = time(l.createdAt);
    const out = {
      id: str(l.id, 64, '배치도 id'),
      name: str(l.name, 30, '방 이름'),
      room: { w: size(l.room.w, '방 가로'), d: size(l.room.d, '방 세로'), h: size(l.room.h, '방 높이') },
      items: uniqueById(items),
      createdAt,
      updatedAt: time(l.updatedAt) || createdAt,
    };
    // 이 배치도를 배치할 때 쓴 기준. 다른 기기에서 열어도 같은 기준으로 보이도록 배치도와 함께 다닌다.
    const gap = rule(l.gap);
    const margin = rule(l.margin);
    if (gap !== undefined) out.gap = gap;
    if (margin !== undefined) out.margin = margin;
    return out;
  });

  return { furniture: uniqueById(furniture), layouts: uniqueById(layouts), exportedAt: time(raw.exportedAt) };
}

// ───────────────────────── 합치기 ─────────────────────────

function mergeList(local, incoming) {
  const result = [...local];
  const index = new Map(local.map((x, i) => [x.id, i]));
  const added = [];
  const updated = [];
  let unchanged = 0;
  for (const item of incoming) {
    const i = index.get(item.id);
    if (i === undefined) {
      added.push(item);
    } else if ((item.updatedAt || 0) > (local[i].updatedAt || 0)) {
      result[i] = item;
      updated.push(item);
    } else {
      unchanged++;
    }
  }
  return { result, added, updated, unchanged };
}

/**
 * 가져온 데이터를 지금 데이터와 합친 결과를 계산한다(실제 저장은 하지 않는다).
 * @returns {{furniture: object[], layouts: object[], summary: {furniture: {added:number, updated:number, unchanged:number}, layouts: {added:number, updated:number, unchanged:number}, changes: number}}}
 */
export function planMerge(db, incoming) {
  const f = mergeList(db.furniture, incoming.furniture);
  const l = mergeList(db.layouts, incoming.layouts);
  // 새 가구는 목록 끝에, 새 배치도는 최근에 만든 것이 위로 오도록 앞에 붙인다.
  const newLayouts = [...l.added].sort((a, b) => b.createdAt - a.createdAt);
  const count = (m) => ({ added: m.added.length, updated: m.updated.length, unchanged: m.unchanged });
  return {
    furniture: [...f.result, ...f.added],
    layouts: [...newLayouts, ...l.result],
    summary: {
      furniture: count(f),
      layouts: count(l),
      changes: f.added.length + f.updated.length + l.added.length + l.updated.length,
    },
  };
}

// ───────────────────────── 파일 ─────────────────────────

export function toFileText(data) {
  return JSON.stringify(data, null, 2);
}

export function fromFileText(text) {
  if (text.length > MAX_BYTES) throw new TransferError('파일이 너무 커요.');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TransferError('파일을 읽을 수 없어요. 룸 테트리스에서 내보낸 파일인지 확인해 주세요.');
  }
  return parseImport(raw);
}

// ───────────────────────── 링크 ─────────────────────────
// JSON → (가능하면 압축) → URL 에 넣을 수 있는 글자(base64url).
// 앞 글자로 형식을 구분한다:  "z." = deflate 압축,  "p." = 압축 없음.

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new TransferError('링크가 잘렸거나 손상됐어요.');
  let bin;
  try {
    bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    throw new TransferError('링크가 잘렸거나 손상됐어요.');
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, transform) {
  const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new TransferError('데이터가 너무 커요.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** @returns {Promise<string>} 링크의 "import=" 뒤에 붙일 문자열 */
export async function encodePayload(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream === 'function') {
    try {
      return 'z.' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
    } catch (err) {
      if (err instanceof TransferError) throw err;
      // 압축을 지원하지 않는 브라우저: 압축 없이 보낸다.
    }
  }
  return 'p.' + toBase64Url(bytes);
}

export async function decodePayload(payload) {
  const kind = payload.slice(0, 2);
  const body = fromBase64Url(payload.slice(2));
  let bytes;
  if (kind === 'p.') {
    bytes = body;
  } else if (kind === 'z.') {
    if (typeof DecompressionStream !== 'function') throw new TransferError('이 브라우저에서는 링크를 열 수 없어요. 파일로 가져와 주세요.');
    try {
      bytes = await pipe(body, new DecompressionStream('deflate-raw'));
    } catch (err) {
      if (err instanceof TransferError) throw err;
      throw new TransferError('링크가 잘렸거나 손상됐어요.');
    }
  } else {
    throw new TransferError('가져오기 링크가 아니에요.');
  }
  let raw;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new TransferError('링크가 잘렸거나 손상됐어요.');
  }
  return parseImport(raw);
}

export function makeLink(baseUrl, payload) {
  return `${baseUrl.split('#')[0]}#${LINK_PARAM}${payload}`;
}

/** 링크 전체, 주소의 # 뒷부분, 또는 코드만 붙여넣어도 코드 부분을 꺼낸다. 없으면 null. */
export function extractPayload(text) {
  const t = String(text || '').trim();
  const at = t.indexOf(LINK_PARAM);
  const rest = at >= 0 ? t.slice(at + LINK_PARAM.length) : t;
  const m = /^[zp]\.[A-Za-z0-9_-]+/.exec(rest);
  return m ? m[0] : null;
}
