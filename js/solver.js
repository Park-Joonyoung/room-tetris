// 자동 배치 알고리즘.
//
// 방 바닥은 x ∈ [0, room.w], z ∈ [0, room.d]. 가구는 인접한 두 벽에만 붙인다.
//   벽 A: z = 0 인 벽 (x축을 따라 가구를 한 줄로 세움)
//   벽 B: x = 0 인 벽 (z축을 따라 가구를 한 줄로 세움)
// 두 벽이 만나는 모서리는 원점(0, 0).
//
// 가구는 돌리지 않는다. 가로(w)는 항상 벽을 따라 놓이고, 세로(d)는 벽에서 방 안쪽으로 뻗는다.
// 가구끼리는 x축 또는 z축 방향으로 gap 이상 떨어져야 한다.
// 또 가구 앞(벽 반대쪽)으로 margin 만큼은 사람이 서거나 앉을 자리라서, 다른 가구의 몸체가 들어올 수 없다.
// 이 여유 공간은 방 안에 있어야 하고, 서로 다른 가구의 여유 공간끼리는 겹쳐도 된다(빈 바닥을 같이 쓴다).
//
// 탐색: 가구를 하나씩 골라 벽 A 또는 B의 줄 끝에 "모서리 쪽으로 최대한 붙여" 추가하는
// 깊이 우선 탐색. 모든 삽입 순서를 따지므로 모서리 근처에서 두 줄이 맞물리는 경우도 찾는다.
// 앞 여유 공간이 간격보다 크면, 두 벽의 가구가 서로 앞을 막지 않도록 모서리를 비우고 비켜서는
// 배치가 필요할 수 있어서, 아직 안 놓은 가구의 깊이만큼 미리 띄운 위치도 후보로 시도한다.
// 전부 놓을 수 없으면 (놓은 개수, 놓은 부피) 가 가장 큰 배치를 돌려준다.

const EPS = 1e-6;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const DEFAULT_TIME_LIMIT_MS = 30000;

/**
 * @param {{w:number,d:number,h:number}} room
 * @param {{id:string,w:number,d:number,h:number}[]} items
 * @param {number} gap 가구 사이 간격(cm)
 * @param {{
 *   margin?: number,                 // 가구 앞 여유 공간(cm)
 *   timeLimitMs?: number,
 *   random?: () => number,           // 주면 매번 다른 배치를 시도
 *   onProgress?: (result: object) => void, // 더 좋은 배치를 찾을 때마다(자주는 아님) 호출
 * }} [opts]
 * @returns {{placements:{id:string,x:number,z:number,rot:0|1,wall:'A'|'B'}[], unplaced:string[], complete:boolean, timedOut:boolean}}
 *   rot 은 가구가 어느 벽을 따라 놓였는지를 뜻한다(0 = 벽 A, 1 = 벽 B). 가로는 항상 벽을 따른다.
 */
export function solve(room, items, gap = 0, opts = {}) {
  const { timeLimitMs = DEFAULT_TIME_LIMIT_MS, random = null, onProgress = null } = opts;
  gap = Math.max(0, gap);
  const margin = Math.max(0, opts.margin || 0);
  const best = { count: -1, volume: -1, place: null, dirty: false, reportedAt: 0 };
  const report = onProgress
    ? () => {
        best.dirty = false;
        onProgress(toResult(items, best, false));
      }
    : null;

  // 같은 탐색 공간을 두 가지 순서로 번갈아 본다. 큰 가구부터 놓으면 "전부 들어가는 배치"를 빨리 찾고,
  // 작은 가구부터 놓으면 전부는 안 될 때 "최대한 많이 놓는 배치"를 빨리 찾는다.
  // 한 번에 쓰는 시간을 0.25초에서 시작해 두 배씩 늘려 가므로, 일찍 멈춰도 두 순서의 결과가 모두 반영돼 있다.
  const end = now() + timeLimitMs;
  let slice = Math.min(250, timeLimitMs / 4);
  let timedOut = false;
  search: for (;;) {
    for (const order of ['big', 'small']) {
      const res = runSearch(room, items, gap, { margin, order, random, deadline: Math.min(end, now() + slice), best, report });
      timedOut = res.timedOut;
      // 시간 안에 끝났다면 모든 경우를 다 봤거나 놓을 수 있는 가구를 전부 놓은 것이므로 더 좋은 답은 없다.
      if (!res.timedOut || now() >= end) break search;
    }
    slice *= 2;
  }
  return toResult(items, best, timedOut);
}

function toResult(items, best, timedOut) {
  const placements = [];
  const unplaced = [];
  items.forEach((it, i) => {
    const p = best.place && best.place[i];
    if (!p) unplaced.push(it.id);
    else if (p.wall === 0) placements.push({ id: it.id, x: round(p.pos), z: 0, rot: 0, wall: 'A' });
    else placements.push({ id: it.id, x: 0, z: round(p.pos), rot: 1, wall: 'B' });
  });
  return { placements, unplaced, complete: unplaced.length === 0, timedOut };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

function runSearch(room, items, gap, { margin, order, random, deadline, best, report }) {
  const n = items.length;
  const limit = [room.w, room.d]; // 벽 A는 방의 가로 길이, 벽 B는 세로 길이만큼 쓸 수 있다
  const depthLimit = [room.d, room.w];

  // 가구별로 놓을 수 있는 벽. 벽을 따라 w, 방 안쪽으로 d(+ 앞 여유 공간) 를 차지한다.
  const walls = items.map((it) => {
    if (!(it.w > 0 && it.d > 0 && it.h > 0) || it.h > room.h + EPS) return [];
    return [0, 1].filter((wall) => it.w <= limit[wall] + EPS && it.d + margin <= depthLimit[wall] + EPS);
  });
  const clear = Math.max(gap, margin); // 다른 벽 가구의 "앞"을 완전히 벗어나는 데 필요한 거리
  const lookahead = clear > gap + EPS; // 미리 띄운 위치도 시도해야 하는가
  const offsets = [...new Set([0, gap, clear])];
  const placeable = walls.filter((w) => w.length > 0).length;
  const vol = items.map((it) => it.w * it.d * it.h);
  const sig = items.map((it) => `${it.w}|${it.d}|${it.h}`);

  const idx = items.map((_, i) => i).filter((i) => walls[i].length > 0);
  const byLen = [...idx].sort((a, b) => items[a].w - items[b].w);
  const byVol = [...idx].sort((a, b) => vol[b] - vol[a]);
  let itemOrder;
  if (order === 'small') itemOrder = byLen; // 작은 것부터 채우면 놓는 개수가 많아진다
  else if (random) itemOrder = shuffle([...idx], random);
  else itemOrder = [...idx].sort((a, b) => items[b].w - items[a].w || vol[b] - vol[a]);

  const rows = [[], []]; // rows[wall] = [{start, dep}]
  const cursor = [0, 0]; // 다음 가구가 시작할 수 있는 최소 위치(이전 가구 끝 + gap)
  const place = new Array(n).fill(null);
  let count = 0;
  let volume = 0;
  let nodes = 0;
  let timedOut = false;
  let done = false;
  const seen = new Set();
  const SEEN_MAX = 150000; // 메모리 사용량 제한

  // 줄 끝에 추가할 때 모서리 쪽으로 가장 붙일 수 있는 위치.
  // 반대편 벽의 가구 o 와의 관계는 o 가 어디서 시작하느냐에 따라 달라진다(새 가구의 깊이 = dep).
  //   o 가 새 가구의 앞 여유 공간보다도 멀리서 시작      → 서로 무관
  //   o 가 새 가구 깊이 + 간격 뒤에서 시작(여유 공간 안)  → 새 가구가 o 의 깊이만 벗어나면 됨(대각선 배치)
  //   o 가 새 가구 깊이 바로 뒤에서 시작                  → o 의 깊이 + 간격을 벗어나야 함
  //   o 가 새 가구 깊이 안쪽에서 시작(o 의 앞을 가로막음)  → o 의 깊이 + 앞 여유 공간까지 벗어나야 함
  function minPos(wall, dep) {
    let p = cursor[wall];
    const other = rows[1 - wall];
    for (let k = 0; k < other.length; k++) {
      const o = other[k];
      let need;
      if (o.start >= dep + clear - EPS) continue;
      else if (o.start >= dep + gap - EPS) need = o.dep;
      else if (o.start >= dep - EPS) need = o.dep + gap;
      else need = o.dep + clear;
      if (p < need - EPS) p = need;
    }
    return p;
  }

  function dfs() {
    nodes++;
    if ((nodes & 127) === 0) {
      const t = now();
      if (t > deadline) timedOut = true;
      else if (report && best.dirty && t - best.reportedAt > 150) {
        // 더 좋은 배치를 찾았으면 알린다(첫 결과는 바로, 그 뒤로는 너무 자주 보내지 않게).
        best.reportedAt = t;
        report();
      }
    }
    if (timedOut) return;

    if (count > best.count || (count === best.count && volume > best.volume + EPS)) {
      best.count = count;
      best.volume = volume;
      best.place = place.map((p) => (p ? { ...p } : null));
      best.dirty = true;
    }
    if (count === placeable) {
      done = true;
      return;
    }

    // 가지치기: 남은 벽 길이로 최대 몇 개를 더 놓을 수 있는지 상한을 구한다.
    const free = limit[0] - cursor[0] + gap + (limit[1] - cursor[1] + gap);
    let extra = 0;
    let need = 0;
    for (let k = 0; k < byLen.length; k++) {
      const i = byLen[k];
      if (place[i]) continue;
      need += items[i].w + gap;
      if (need > free + EPS) break;
      extra++;
    }
    if (count + extra < best.count) return;
    if (count + extra === best.count) {
      let volBound = volume;
      let taken = 0;
      for (let k = 0; k < byVol.length && taken < extra; k++) {
        const i = byVol[k];
        if (place[i]) continue;
        volBound += vol[i];
        taken++;
      }
      if (volBound <= best.volume + EPS) return;
    }

    // 같은 상태를 다른 순서로 다시 만나면 건너뛴다.
    if (seen.size < SEEN_MAX) {
      let key = '';
      for (let i = 0; i < n; i++) {
        const p = place[i];
        key += p ? `${p.wall}@${p.pos.toFixed(2)};` : '-;';
      }
      if (seen.has(key)) return;
      seen.add(key);
    }

    // 벽은 남은 길이가 긴 쪽부터 채워서 두 벽에 고르게 나뉘도록 한다.
    let firstWall = limit[0] - cursor[0] >= limit[1] - cursor[1] ? 0 : 1;
    if (random && random() < 0.35) firstWall = 1 - firstWall;

    const triedSig = new Set();
    for (let k = 0; k < itemOrder.length; k++) {
      const i = itemOrder[k];
      if (place[i]) continue;
      if (triedSig.has(sig[i])) continue; // 크기가 같은 가구는 서로 바꿔도 같은 결과
      triedSig.add(sig[i]);

      const len = items[i].w;
      const dep = items[i].d;
      for (let s = 0; s < 2; s++) {
        const wall = s === 0 ? firstWall : 1 - firstWall;
        if (!walls[i].includes(wall)) continue;
        const base = minPos(wall, dep);
        if (base + len > limit[wall] + EPS) continue;
        // 기본은 가장 붙인 위치. 반대편 줄이 아직 이 가구의 앞 구역까지 자라지 않았다면,
        // 나중에 그 줄에 올 가구(깊이 D)를 위해 D, D + 간격, D + 여유만큼 띄운 위치도 시도한다.
        let positions = [base];
        if (lookahead && cursor[1 - wall] < dep + clear - EPS) {
          const extra = new Set();
          for (let m = 0; m < itemOrder.length; m++) {
            const j = itemOrder[m];
            if (j === i || place[j] || !walls[j].includes(1 - wall)) continue;
            for (const off of offsets) {
              const v = items[j].d + off;
              if (v > base + EPS && v + len <= limit[wall] + EPS) extra.add(round(v));
            }
          }
          if (extra.size) positions = [base, ...[...extra].sort((a, b) => a - b)];
        }
        for (const pos of positions) {

        const prevCursor = cursor[wall];
        rows[wall].push({ start: pos, dep });
        cursor[wall] = pos + len + gap;
        place[i] = { wall, pos };
        count++;
        volume += vol[i];

        dfs();

        volume -= vol[i];
        count--;
        place[i] = null;
        cursor[wall] = prevCursor;
        rows[wall].pop();

        if (done || timedOut) return;
        }
      }
    }
  }

  dfs();
  return { timedOut, done };
}

function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 시드로 만드는 난수 생성기(워커에 함수를 넘길 수 없어서 시드를 넘긴다). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
