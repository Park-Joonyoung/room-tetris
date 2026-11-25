// 자동 배치 알고리즘.
//
// 방 바닥은 x ∈ [0, room.w], z ∈ [0, room.d]. 가구는 인접한 두 벽에만 붙인다.
//   벽 A: z = 0 인 벽 (x축을 따라 가구를 한 줄로 세움)
//   벽 B: x = 0 인 벽 (z축을 따라 가구를 한 줄로 세움)
// 두 벽이 만나는 모서리는 원점(0, 0).
//
// 각 가구는 벽을 따라 차지하는 길이(len)와 방 안쪽으로 튀어나오는 깊이(dep)를 가진다.
// 기본은 가로(w)가 벽을 따라가고 세로(d)가 깊이지만, 필요하면 90도 돌린다.
// 가구끼리는 x축 또는 z축 방향으로 gap 이상 떨어져야 한다.
//
// 탐색: 가구를 하나씩 골라 벽 A 또는 B의 줄 끝에 "모서리 쪽으로 최대한 붙여" 추가하는
// 깊이 우선 탐색. 모든 삽입 순서를 따지므로 모서리 근처에서 두 줄이 맞물리는 경우도 찾는다.
// 전부 놓을 수 없으면 (놓은 개수, 놓은 부피) 가 가장 큰 배치를 돌려준다.

const EPS = 1e-6;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * @param {{w:number,d:number,h:number}} room
 * @param {{id:string,w:number,d:number,h:number}[]} items
 * @param {number} gap 가구 사이 간격(cm)
 * @param {{timeLimitMs?:number, random?:()=>number}} [opts] random 을 주면 매번 다른 배치를 시도
 * @returns {{placements:{id:string,x:number,z:number,rot:0|1,wall:'A'|'B'}[], unplaced:string[], complete:boolean}}
 */
export function solve(room, items, gap = 0, opts = {}) {
  const { timeLimitMs = 800, random = null } = opts;
  gap = Math.max(0, gap);
  const best = { count: -1, volume: -1, rotations: 0, place: null };

  // 1) 회전 없이 큰 가구부터  2) 회전 허용, 큰 가구부터  3) 회전 허용, 작은 가구부터
  const passes = [
    { allowRotate: false, order: 'big', share: 0.3 },
    { allowRotate: true, order: 'big', share: 0.4 },
    { allowRotate: true, order: 'small', share: 0.3 },
  ];
  for (const pass of passes) {
    const res = search(room, items, gap, {
      ...pass,
      random,
      deadline: now() + timeLimitMs * pass.share,
      best,
    });
    if (best.count === items.length) break; // 전부 배치 성공
    // 회전까지 허용한 탐색이 끝까지 돌았거나 놓을 수 있는 가구를 전부 놓았다면 더 좋은 답은 없다.
    if (pass.allowRotate && (res.exhausted || res.done)) break;
  }

  const placements = [];
  const unplaced = [];
  items.forEach((it, i) => {
    const p = best.place && best.place[i];
    if (!p) {
      unplaced.push(it.id);
      return;
    }
    if (p.wall === 0) {
      placements.push({ id: it.id, x: round(p.pos), z: 0, rot: p.rot ? 1 : 0, wall: 'A' });
    } else {
      // 벽 B에서는 가구의 가로가 z축을 따라가므로 회전 상태가 반대가 된다.
      placements.push({ id: it.id, x: 0, z: round(p.pos), rot: p.rot ? 0 : 1, wall: 'B' });
    }
  });
  return { placements, unplaced, complete: unplaced.length === 0 };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

function search(room, items, gap, { allowRotate, order, random, deadline, best }) {
  const n = items.length;
  const limit = [room.w, room.d]; // 벽 A는 방의 가로 길이, 벽 B는 세로 길이만큼 쓸 수 있다
  const depthLimit = [room.d, room.w];

  // 가구별로 가능한 (벽, 회전) 조합
  const cand = items.map((it) => {
    const out = [];
    if (!(it.w > 0 && it.d > 0 && it.h > 0) || it.h > room.h + EPS) return out;
    const orients = [{ len: it.w, dep: it.d, rot: 0 }];
    if (allowRotate && Math.abs(it.w - it.d) > EPS) orients.push({ len: it.d, dep: it.w, rot: 1 });
    for (const o of orients) {
      for (const wall of [0, 1]) {
        if (o.len <= limit[wall] + EPS && o.dep <= depthLimit[wall] + EPS) out.push({ ...o, wall });
      }
    }
    return out;
  });
  const placeable = cand.filter((c) => c.length > 0).length;
  const minLen = cand.map((c) => (c.length ? Math.min(...c.map((o) => o.len)) : Infinity));
  const vol = items.map((it) => it.w * it.d * it.h);
  const sig = items.map((it) => `${it.w}|${it.d}|${it.h}`);

  const idx = items.map((_, i) => i).filter((i) => cand[i].length > 0);
  const byMinLen = [...idx].sort((a, b) => minLen[a] - minLen[b]);
  const byVol = [...idx].sort((a, b) => vol[b] - vol[a]);
  let itemOrder;
  if (order === 'small') {
    itemOrder = byMinLen; // 작은 것부터 채우면 놓는 개수가 많아진다
  } else if (random) {
    itemOrder = shuffle([...idx], random);
  } else {
    itemOrder = [...idx].sort((a, b) => items[b].w - items[a].w || vol[b] - vol[a]);
  }

  const rows = [[], []]; // rows[wall] = [{start, end, dep}]
  const cursor = [0, 0]; // 다음 가구가 시작할 수 있는 최소 위치(이전 가구 끝 + gap)
  const place = new Array(n).fill(null);
  let count = 0;
  let volume = 0;
  let rotations = 0;
  let nodes = 0;
  let timedOut = false;
  let done = false;
  const seen = new Set();
  const SEEN_MAX = 120000; // 메모리 사용량 제한

  // 줄 끝에 추가할 때 모서리 쪽으로 가장 붙일 수 있는 위치.
  // 반대편 벽의 가구와 겹치면(간격 포함) 그 가구의 깊이를 벗어날 때까지 밀어낸다.
  function minPos(wall, dep) {
    let p = cursor[wall];
    const other = rows[1 - wall];
    for (let k = 0; k < other.length; k++) {
      const o = other[k];
      if (o.start < dep + gap - EPS && p < o.dep + gap - EPS) p = o.dep + gap;
    }
    return p;
  }

  function isBetter() {
    if (count !== best.count) return count > best.count;
    if (Math.abs(volume - best.volume) > EPS) return volume > best.volume;
    return rotations < best.rotations;
  }

  function dfs() {
    nodes++;
    if ((nodes & 127) === 0 && now() > deadline) timedOut = true;
    if (timedOut) return;

    if (isBetter()) {
      best.count = count;
      best.volume = volume;
      best.rotations = rotations;
      best.place = place.map((p) => (p ? { ...p } : null));
    }
    if (count === placeable) {
      done = true;
      return;
    }

    // 가지치기: 남은 벽 길이로 최대 몇 개를 더 놓을 수 있는지 상한을 구한다.
    const free = limit[0] - cursor[0] + gap + (limit[1] - cursor[1] + gap);
    let extra = 0;
    let need = 0;
    for (let k = 0; k < byMinLen.length; k++) {
      const i = byMinLen[k];
      if (place[i]) continue;
      need += minLen[i] + gap;
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
        key += p ? `${p.wall}${p.rot}@${p.pos.toFixed(2)};` : '-;';
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

      const options = [...cand[i]].sort(
        (a, b) => a.rot - b.rot || (a.wall === firstWall ? 0 : 1) - (b.wall === firstWall ? 0 : 1),
      );
      for (const o of options) {
        const pos = minPos(o.wall, o.dep);
        if (pos + o.len > limit[o.wall] + EPS) continue;

        const prevCursor = cursor[o.wall];
        rows[o.wall].push({ start: pos, end: pos + o.len, dep: o.dep });
        cursor[o.wall] = pos + o.len + gap;
        place[i] = { wall: o.wall, rot: o.rot, pos };
        count++;
        volume += vol[i];
        rotations += o.rot;

        dfs();

        rotations -= o.rot;
        volume -= vol[i];
        count--;
        place[i] = null;
        cursor[o.wall] = prevCursor;
        rows[o.wall].pop();

        if (done || timedOut) return;
      }
    }
  }

  dfs();
  return { exhausted: !timedOut && !done, done };
}

function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
