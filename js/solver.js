// 자동 배치 알고리즘.
//
// 방 바닥은 x ∈ [0, room.w], z ∈ [0, room.d]. 가구는 네 벽 중 하나에 등을 붙이고 선다.
//   벽 A (0): z = 0      앞은 +z 쪽      벽 C (2): z = room.d   앞은 -z 쪽
//   벽 B (1): x = 0      앞은 +x 쪽      벽 D (3): x = room.w   앞은 -x 쪽
// 벽 A·C 에서는 x 축을, 벽 B·D 에서는 z 축을 따라 가구가 늘어선다.
//
// 규칙
//   - 가구는 돌리지 않는다. 가로(w)는 항상 벽을 따라 놓이고, 세로(d)는 벽에서 방 안쪽으로 뻗는다.
//   - 가구끼리는 x 축 또는 z 축 방향으로 gap 이상 떨어져야 한다.
//   - 가구 앞(벽 반대쪽)으로 margin 만큼은 사람이 서거나 앉을 자리라서 다른 가구의 몸체가 들어올 수 없다.
//     이 공간은 방 안에 있어야 하고, 서로 다른 가구의 앞 공간끼리는 겹쳐도 된다(빈 바닥을 같이 쓴다).
//     가구마다 이 공간이 필요 없다고 표시할 수 있다(item.clear === false: 침대, 문 등).
//
// 탐색
//   가구를 하나씩 골라 (벽, 그 벽의 어느 쪽 끝에서부터) 를 정하고, 그 끝에서부터 "들어갈 수 있는
//   가장 가까운 자리"에 놓는 깊이 우선 탐색이다. 모든 순서를 따지므로 모서리에서 두 벽의 가구가
//   맞물리는 경우도 찾는다. 앞 공간이 간격보다 크면 두 벽의 가구가 모서리를 비우고 서로 비켜서야
//   할 때가 있어서, 아직 안 놓은 가구의 깊이만큼 미리 띄운 자리도 후보로 시도한다.
//   전부 놓을 수 없으면 (놓은 개수, 놓은 부피) 가 가장 큰 배치를 돌려준다.

const EPS = 1e-6;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const WALL_NAMES = ['A', 'B', 'C', 'D'];

export const DEFAULT_TIME_LIMIT_MS = 30000;

/**
 * @param {{w:number,d:number,h:number}} room
 * @param {{id:string,w:number,d:number,h:number,clear?:boolean}[]} items clear === false 면 앞 여유 공간이 필요 없는 가구
 * @param {number} gap 가구 사이 간격(cm)
 * @param {{
 *   margin?: number,                 // 가구 앞 여유 공간(cm)
 *   timeLimitMs?: number,
 *   random?: () => number,           // 주면 매번 다른 배치를 시도
 *   onProgress?: (result: object) => void, // 더 좋은 배치를 찾을 때마다(자주는 아님) 호출
 * }} [opts]
 * @returns {{placements:{id:string,x:number,z:number,rot:0|1|2|3,wall:'A'|'B'|'C'|'D'}[], unplaced:string[], complete:boolean, timedOut:boolean}}
 *   rot 은 가구가 등을 붙인 벽의 번호(0 = A, 1 = B, 2 = C, 3 = D)다.
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
    else placements.push({ id: it.id, x: round(p.x), z: round(p.z), rot: p.wall, wall: WALL_NAMES[p.wall] });
  });
  return { placements, unplaced, complete: unplaced.length === 0, timedOut };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

function runSearch(room, items, gap, { margin, order, random, deadline, best, report }) {
  const n = items.length;
  const W = room.w;
  const D = room.d;
  const wallLen = [W, D, W, D]; // 벽을 따라 쓸 수 있는 길이
  const wallDepth = [D, W, D, W]; // 벽에서 맞은편 벽까지의 거리

  // 가구마다 필요한 앞 공간(필요 없는 가구는 0)
  const front = items.map((it) => (it.clear === false ? 0 : margin));
  // 가구별로 놓을 수 있는 벽. 벽을 따라 w, 방 안쪽으로 d(+ 앞 공간) 를 차지한다.
  const walls = items.map((it, i) => {
    if (!(it.w > 0 && it.d > 0 && it.h > 0) || it.h > room.h + EPS) return [];
    return [0, 1, 2, 3].filter((wall) => it.w <= wallLen[wall] + EPS && it.d + front[i] <= wallDepth[wall] + EPS);
  });
  const clear = Math.max(gap, margin); // 다른 벽 가구의 "앞"을 완전히 벗어나는 데 필요한 거리
  const lookahead = clear > gap + EPS; // 미리 띄운 자리도 시도해야 하는가
  const offsets = [...new Set([0, gap, clear])];

  const placeable = walls.filter((w) => w.length > 0).length;
  const vol = items.map((it) => it.w * it.d * it.h);
  const sig = items.map((it) => `${it.w}|${it.d}|${it.h}|${it.clear === false ? 0 : 1}`);

  const idx = items.map((_, i) => i).filter((i) => walls[i].length > 0);
  const byLen = [...idx].sort((a, b) => items[a].w - items[b].w);
  const byVol = [...idx].sort((a, b) => vol[b] - vol[a]);
  let itemOrder;
  if (order === 'small') itemOrder = byLen; // 작은 것부터 채우면 놓는 개수가 많아진다
  else if (random) itemOrder = shuffle([...idx], random);
  else itemOrder = [...idx].sort((a, b) => items[b].w - items[a].w || vol[b] - vol[a]);

  // 놓인 가구들: 몸체 b 와 앞 공간 zone 을 [x0, x1, z0, z1] 로 적어 둔다(앞 공간이 없으면 zone 은 null).
  const placed = [];
  const used = [0, 0, 0, 0]; // 벽마다 쓴 길이(가구 길이 + 간격의 합)
  const place = new Array(n).fill(null);
  let count = 0;
  let volume = 0;
  let nodes = 0;
  let timedOut = false;
  let done = false;
  const seen = new Set();
  const SEEN_MAX = 150000; // 메모리 사용량 제한

  /** 벽 wall 에서 벽을 따라 t 위치에 놓인 가구의 몸체와 앞 공간 */
  function shape(wall, t, len, dep, m) {
    switch (wall) {
      case 0:
        return { b: [t, t + len, 0, dep], zone: m > 0 ? [t, t + len, dep, dep + m] : null };
      case 1:
        return { b: [0, dep, t, t + len], zone: m > 0 ? [dep, dep + m, t, t + len] : null };
      case 2:
        return { b: [t, t + len, D - dep, D], zone: m > 0 ? [t, t + len, D - dep - m, D - dep] : null };
      default:
        return { b: [W - dep, W, t, t + len], zone: m > 0 ? [W - dep - m, W - dep, t, t + len] : null };
    }
  }

  /**
   * 벽 wall 의 fromEnd 쪽 끝(0 = 좌표가 작은 쪽, 1 = 큰 쪽)에서 offset 만큼 떨어진 곳부터 찾아,
   * 길이 len·깊이 dep·앞 공간 m 인 가구가 들어갈 수 있는 가장 가까운 자리를 구한다. 없으면 null.
   *
   * 벽을 따라 미끄러뜨릴 때 놓인 가구 하나가 막는 범위는 t 에 대한 구간으로 나온다:
   *   간격       — 벽에 수직인 방향으로 간격보다 가까운 가구와는, 벽 방향으로 간격만큼 떨어져야 한다.
   *   내 앞 공간 — 내 앞 공간 깊이에 걸친 가구와는, 벽 방향으로 겹치면 안 된다.
   *   남의 앞 공간 — 내 몸체 깊이에 걸친 남의 앞 공간과는, 벽 방향으로 겹치면 안 된다.
   * 막힌 구간 안에 있으면 그 구간 끝으로 옮기기를, 더 옮길 필요가 없을 때까지 되풀이한다.
   */
  function findSpot(wall, fromEnd, len, dep, m, offset) {
    const L = wallLen[wall];
    const si = (wall & 1) * 2; // 벽을 따르는 축의 범위가 들어 있는 자리(x 면 0, z 면 2)
    const pi = 2 - si; // 벽에 수직인 축
    let bp0; // 내 몸체가 수직 방향으로 차지하는 범위
    let bp1;
    let zp0; // 내 앞 공간이 수직 방향으로 차지하는 범위
    let zp1;
    if (wall < 2) {
      bp0 = 0;
      bp1 = dep;
      zp0 = dep;
      zp1 = dep + m;
    } else {
      const far = wallDepth[wall];
      bp0 = far - dep;
      bp1 = far;
      zp0 = far - dep - m;
      zp1 = far - dep;
    }

    let t = fromEnd === 0 ? offset : L - len - offset;
    for (let guard = placed.length * 3 + 2; guard > 0; guard--) {
      let moved = false;
      for (let k = 0; k < placed.length; k++) {
        const o = placed[k];
        const os0 = o.b[si];
        const os1 = o.b[si + 1];
        const op0 = o.b[pi];
        const op1 = o.b[pi + 1];
        let lo = Infinity;
        let hi = -Infinity;
        // 간격
        if (Math.max(op0 - bp1, bp0 - op1) < gap - EPS) {
          lo = os0 - gap - len;
          hi = os1 + gap;
        }
        // 내 앞 공간을 o 의 몸체가 막는 경우
        if (m > 0 && zp0 < op1 - EPS && op0 < zp1 - EPS) {
          lo = Math.min(lo, os0 - len);
          hi = Math.max(hi, os1);
        }
        if (t > lo + EPS && t < hi - EPS) {
          t = fromEnd === 0 ? hi : lo;
          moved = true;
        }
        // o 의 앞 공간을 내 몸체가 막는 경우(위의 구간과 떨어져 있을 수 있어 따로 본다)
        const oz = o.zone;
        if (oz && bp0 < oz[pi + 1] - EPS && oz[pi] < bp1 - EPS) {
          const zlo = oz[si] - len;
          const zhi = oz[si + 1];
          if (t > zlo + EPS && t < zhi - EPS) {
            t = fromEnd === 0 ? zhi : zlo;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    if (t < -EPS || t + len > L + EPS) return null;
    return t < 0 ? 0 : t;
  }

  /**
   * 벽 wall 의 fromEnd 쪽 모서리에서 재어, 그 벽에 앞으로 놓일 가구가 시작할 수 있는 가장 가까운 거리.
   * 모서리부터 이미 가구가 빈틈없이(가장 짧은 남은 가구도 못 들어가게) 차 있으면 그만큼 멀어진다.
   */
  function openFrom(wall, fromEnd, minLen) {
    const L = wallLen[wall];
    const si = (wall & 1) * 2;
    const spans = [];
    for (let i = 0; i < n; i++) {
      const p = place[i];
      if (!p || p.wall !== wall) continue;
      const s0 = p.t;
      const s1 = p.t + items[i].w;
      spans.push(fromEnd === 0 ? [s0, s1] : [L - s1, L - s0]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let cover = 0;
    for (const [s0, s1] of spans) {
      if (s0 - cover >= minLen - EPS) break; // 여기 빈틈에 가구가 들어갈 수 있다
      cover = Math.max(cover, s1 + gap);
    }
    return cover;
  }

  function dfs() {
    nodes++;
    if ((nodes & 7) === 0) {
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
    let free = 0;
    for (let w = 0; w < 4; w++) free += wallLen[w] + gap - used[w];
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
        key += p ? `${p.wall}@${p.t.toFixed(2)};` : '-;';
      }
      if (seen.has(key)) return;
      seen.add(key);
    }

    // 벽을 고르는 순서. 기본 시점에서 잘 보이는 안쪽 두 벽(A, B)을 먼저 채우고, 모자라면 나머지(C, D)를 쓴다.
    // 같은 묶음 안에서는 남은 길이가 긴 벽부터.
    let wallOrder = [0, 1, 2, 3];
    const first = count === 0;
    if (first) {
      // 방은 좌우·앞뒤로 뒤집어도 같은 문제이므로, 맨 처음 가구는 벽 A·B 의 작은 좌표 쪽 끝에만 놓아 본다.
      wallOrder = [0, 1];
    } else if (random) {
      shuffle(wallOrder, random);
    } else {
      wallOrder.sort((a, b) => (a >> 1) - (b >> 1) || wallLen[b] - used[b] - (wallLen[a] - used[a]));
    }

    const triedSig = new Set();
    for (let k = 0; k < itemOrder.length; k++) {
      const i = itemOrder[k];
      if (place[i]) continue;
      if (triedSig.has(sig[i])) continue; // 크기가 같은 가구는 서로 바꿔도 같은 결과
      triedSig.add(sig[i]);

      const len = items[i].w;
      const dep = items[i].d;
      const m = front[i];
      const triedSpot = new Set();
      let minOtherLen = Infinity; // 이 가구를 뺀 남은 가구 중 가장 짧은 것
      if (lookahead) {
        for (let q = 0; q < byLen.length; q++) {
          const j = byLen[q];
          if (j !== i && !place[j]) {
            minOtherLen = items[j].w;
            break;
          }
        }
      }
      for (let s = 0; s < wallOrder.length; s++) {
        const wall = wallOrder[s];
        if (!walls[i].includes(wall)) continue;
        for (let fromEnd = 0; fromEnd < (first ? 1 : 2); fromEnd++) {
          // 끝에서 바로 찾는 자리가 기본. 여기에 더해, 이 모서리에서 만나는 옆 벽에 나중에 올 가구(깊이 d)를
          // 위해 d, d + 간격, d + 앞 공간만큼 띄운 자리도 시도한다.
          const base = findSpot(wall, fromEnd, len, dep, m, 0);
          if (base === null) continue; // 끝에서부터 찾아도 자리가 없으면 더 띄워도 없다
          const baseDist = fromEnd === 0 ? base : wallLen[wall] - len - base; // 모서리에서 떨어진 거리
          let starts = [0];
          if (lookahead && minOtherLen < Infinity) {
            const neighbor = wall & 1 ? (fromEnd === 0 ? 0 : 2) : fromEnd === 0 ? 1 : 3;
            // 옆 벽의 이 모서리 쪽 끝. (벽 A·C 의 작은 좌표 끝은 벽 B, 큰 좌표 끝은 벽 D 와 만나고,
            //  그 벽들에서 보면 벽 A 쪽이 작은 좌표 끝, 벽 C 쪽이 큰 좌표 끝이다. 벽 B·D 도 마찬가지.)
            const neighborEnd = wall < 2 ? 0 : 1;
            // 옆 벽에 앞으로 올 가구가 이 가구의 깊이 + 앞 공간 안쪽에서 시작할 수 없다면 미리 띄울 이유가 없다.
            if (openFrom(neighbor, neighborEnd, minOtherLen) < dep + clear - EPS) {
              const extraStarts = new Set();
              for (let q = 0; q < itemOrder.length; q++) {
                const j = itemOrder[q];
                if (j === i || place[j] || !walls[j].includes(neighbor)) continue;
                for (const off of offsets) {
                  const v = round(items[j].d + off);
                  if (v > baseDist + EPS) extraStarts.add(v); // 기본 자리보다 가까운 값은 같은 자리가 된다
                }
              }
              if (extraStarts.size) starts = [0, ...[...extraStarts].sort((a, b) => a - b)];
            }
          }
          for (const start of starts) {
            const t = start === 0 ? base : findSpot(wall, fromEnd, len, dep, m, start);
            if (t === null) continue;
            const spot = `${wall}@${t.toFixed(2)}`;
            if (triedSpot.has(spot)) continue;
            triedSpot.add(spot);

            const sh = shape(wall, t, len, dep, m);
            placed.push(sh);
            used[wall] += len + gap;
            place[i] = { wall, t, x: sh.b[0], z: sh.b[2] };
            count++;
            volume += vol[i];

            dfs();

            volume -= vol[i];
            count--;
            place[i] = null;
            used[wall] -= len + gap;
            placed.pop();

            if (done || timedOut) return;
          }
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
