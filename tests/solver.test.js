import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, seededRandom } from '../js/solver.js';

const TOL = 1e-3;
const WALLS = ['A', 'B', 'C', 'D'];

// 이 파일의 검사 도구는 솔버의 코드를 쓰지 않고 규칙을 직접 다시 적은 것이다(서로 다른 구현으로 맞춰 보기 위해).

/** 벽 wall(0~3)에, 벽을 따라 t 위치에 놓인 가구의 바닥 사각형 */
function rectOn(room, wall, t, it) {
  if (wall === 0) return { x: t, z: 0, sx: it.w, sz: it.d };
  if (wall === 1) return { x: 0, z: t, sx: it.d, sz: it.w };
  if (wall === 2) return { x: t, z: room.d - it.d, sx: it.w, sz: it.d };
  return { x: room.w - it.d, z: t, sx: it.d, sz: it.w };
}

/** 가구 앞(벽 반대쪽) 여유 공간 사각형 */
function frontOf(r, wall, margin) {
  if (wall === 0) return { x: r.x, z: r.z + r.sz, sx: r.sx, sz: margin };
  if (wall === 1) return { x: r.x + r.sx, z: r.z, sx: margin, sz: r.sz };
  if (wall === 2) return { x: r.x, z: r.z - margin, sx: r.sx, sz: margin };
  return { x: r.x - margin, z: r.z, sx: margin, sz: r.sz };
}

function overlaps(a, b) {
  return a.x < b.x + b.sx - TOL && b.x < a.x + a.sx - TOL && a.z < b.z + b.sz - TOL && b.z < a.z + a.sz - TOL;
}

function inside(room, r) {
  return r.x >= -TOL && r.z >= -TOL && r.x + r.sx <= room.w + TOL && r.z + r.sz <= room.d + TOL;
}

/** 두 가구(사각형 + 벽 + 앞 공간 크기)가 함께 있어도 되는가 */
function compatible(a, b, gap) {
  const dx = Math.max(b.r.x - (a.r.x + a.r.sx), a.r.x - (b.r.x + b.r.sx));
  const dz = Math.max(b.r.z - (a.r.z + a.r.sz), a.r.z - (b.r.z + b.r.sz));
  if (dx < gap - TOL && dz < gap - TOL) return false;
  if (a.m > 0 && overlaps(frontOf(a.r, a.wall, a.m), b.r)) return false;
  if (b.m > 0 && overlaps(frontOf(b.r, b.wall, b.m), a.r)) return false;
  return true;
}

const frontNeed = (it, margin) => (it.clear === false ? 0 : margin);

/** 배치 결과가 모든 규칙을 지키는지 검사한다. */
function validate(room, items, gap, result, margin = 0) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const ids = new Set(result.placements.map((p) => p.id));
  assert.equal(ids.size, result.placements.length, '같은 가구가 두 번 배치됨');
  assert.equal(result.placements.length + result.unplaced.length, items.length);
  for (const id of result.unplaced) assert.ok(!ids.has(id));
  assert.equal(result.complete, result.unplaced.length === 0);

  const placed = result.placements.map((p) => {
    const it = byId.get(p.id);
    assert.ok(it, `unknown id ${p.id}`);
    const wall = WALLS.indexOf(p.wall);
    assert.ok(wall >= 0, `${p.id} 벽 이름이 이상함: ${p.wall}`);
    assert.equal(p.rot, wall, `${p.id} rot 과 벽이 다름`);
    // 가구는 돌리지 않는다: 가로(w)는 벽을 따라, 세로(d)는 벽에서 방 안쪽으로. 그리고 등은 벽에 붙어 있다.
    const expected = rectOn(room, wall, wall % 2 === 0 ? p.x : p.z, it);
    assert.ok(Math.abs(expected.x - p.x) <= TOL && Math.abs(expected.z - p.z) <= TOL, `${p.id} 벽 ${p.wall} 에 붙어 있지 않음 (${p.x}, ${p.z})`);
    assert.ok(inside(room, expected), `${p.id} 방 밖으로 나감`);
    assert.ok(it.h <= room.h + TOL, `${p.id} 높이 초과`);
    const m = frontNeed(it, margin);
    if (m > 0) assert.ok(inside(room, frontOf(expected, wall, m)), `${p.id} 앞 여유 공간이 방 밖으로 나감`);
    return { id: p.id, r: expected, wall, m };
  });
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      assert.ok(compatible(placed[i], placed[j], gap), `${placed[i].id}, ${placed[j].id} 가 간격이나 앞 여유 공간을 어김`);
    }
  }
}

/**
 * 솔버와 전혀 다른 방식의 전수 탐색: 가구마다 (안 놓음 / 네 벽) × 격자 위의 모든 위치를 시도하고
 * 규칙을 직접 검사한다. "모서리 쪽으로 붙인다" 같은 가정을 쓰지 않는다.
 */
function gridMax(room, items, gap, margin, step) {
  const n = items.length;
  let best = 0;
  const placed = [];
  const rec = (i, count) => {
    if (best === n || count + (n - i) <= best) return;
    if (i === n) {
      best = count;
      return;
    }
    const it = items[i];
    const m = frontNeed(it, margin);
    if (it.h <= room.h) {
      for (let wall = 0; wall < 4; wall++) {
        const L = wall % 2 === 0 ? room.w : room.d;
        for (let t = 0; t + it.w <= L; t += step) {
          const cand = { r: rectOn(room, wall, t, it), wall, m };
          if (!inside(room, cand.r) || (m > 0 && !inside(room, frontOf(cand.r, wall, m)))) continue;
          if (!placed.every((o) => compatible(cand, o, gap))) continue;
          placed.push(cand);
          rec(i + 1, count + 1);
          placed.pop();
        }
      }
    }
    rec(i + 1, count);
  };
  rec(0, 0);
  return best;
}

const mk = (id, w, d, h = 100, extra = {}) => ({ id, w, d, h, ...extra });
const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test('가구가 없으면 빈 배치', () => {
  const r = solve({ w: 300, d: 300, h: 240 }, [], 5);
  assert.deepEqual(r.placements, []);
  assert.equal(r.complete, true);
});

test('가구 하나는 모서리에 놓인다', () => {
  const room = { w: 300, d: 300, h: 240 };
  const items = [mk('a', 100, 50)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.complete, true);
  assert.deepEqual([r.placements[0].x, r.placements[0].z], [0, 0]);
});

test('넉넉한 방에는 전부 배치', () => {
  const room = { w: 400, d: 300, h: 240 };
  const items = [mk('bed', 200, 100, 45), mk('ward', 120, 60, 200), mk('desk', 120, 60, 75), mk('shelf', 80, 30, 180)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.complete, true);
});

test('두 벽으로 충분하면 안쪽 두 벽(A, B)만 쓴다', () => {
  const room = { w: 500, d: 400, h: 240 };
  const items = [mk('a', 200, 60), mk('b', 150, 60), mk('c', 100, 40), mk('d', 80, 40)];
  const r = solve(room, items, 5, { margin: 60 });
  validate(room, items, 5, r, 60);
  assert.equal(r.complete, true);
  assert.ok(r.placements.every((p) => p.wall === 'A' || p.wall === 'B'), JSON.stringify(r.placements.map((p) => p.wall)));
});

test('두 벽으로 모자라면 나머지 벽(C, D)도 쓴다', () => {
  // 벽 길이 200 인 정사각형 방에 180 짜리 가구 넷: 벽마다 하나씩 놓아야 한다.
  const room = { w: 400, d: 400, h: 240 };
  const items = [mk('a', 300, 40), mk('b', 300, 40), mk('c', 300, 40), mk('d', 300, 40)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.complete, true);
  assert.deepEqual([...new Set(r.placements.map((p) => p.wall))].sort(), ['A', 'B', 'C', 'D']);
});

test('방보다 높은 가구는 배치하지 않는다', () => {
  const room = { w: 300, d: 300, h: 200 };
  const items = [mk('tall', 50, 50, 250), mk('ok', 50, 50, 100)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.deepEqual(r.unplaced, ['tall']);
  assert.equal(r.complete, false);
});

test('방보다 큰 가구는 배치하지 않는다', () => {
  const room = { w: 100, d: 100, h: 240 };
  const r = solve(room, [mk('huge', 150, 150)], 0);
  assert.deepEqual(r.unplaced, ['huge']);
});

test('가구를 돌리지 않는다: 돌려야만 들어가는 가구는 남긴다', () => {
  // 가로 250 은 긴 벽(300)에만 들어간다. 긴 벽 둘에 하나씩 놓으면 깊이 80+80 > 방 세로 150 이라 서로 부딪히고,
  // 90도 돌리면(벽을 따라 80) 여유가 있지만 회전은 하지 않으므로 하나만 배치된다.
  const room = { w: 300, d: 150, h: 240 };
  const items = [mk('a', 250, 80), mk('b', 250, 80)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.placements.length, 1);
  assert.equal(r.timedOut, false);
  assert.equal(gridMax(room, items, 5, 0, 5), 1);
});

test('마주 보는 벽의 가구는 서로의 앞을 막지 않는다', () => {
  // 방 세로 200. 벽 A 와 C 에 깊이 60 짜리를 마주 놓으면 사이가 80 남는다.
  const room = { w: 300, d: 200, h: 240 };
  const items = [mk('a', 280, 60), mk('b', 280, 60)];
  // 앞 여유 60: 80 ≥ 60 이라 마주 볼 수 있다.
  const ok = solve(room, items, 5, { margin: 60 });
  validate(room, items, 5, ok, 60);
  assert.equal(ok.complete, true);
  // 앞 여유 100: 마주 보면 서로의 앞 공간에 들어간다. 짧은 벽(200)에는 280 이 안 들어가므로 하나만 놓인다.
  const tight = solve(room, items, 5, { margin: 100 });
  validate(room, items, 5, tight, 100);
  assert.equal(tight.placements.length, 1);
  assert.equal(gridMax(room, items, 5, 100, 5), 1);
});

test('불가능하면 최대한 많이 배치하고 나머지는 남긴다', () => {
  const room = { w: 200, d: 200, h: 240 };
  const items = [mk('a', 100, 100), mk('b', 100, 100), mk('c', 100, 100), mk('d', 100, 100), mk('e', 100, 100)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.complete, false);
  assert.equal(r.placements.length, gridMax(room, items.slice(0, 4), 5, 0, 5));
});

test('개수를 최대화한다: 큰 것 하나보다 작은 것 여러 개', () => {
  const room = { w: 300, d: 100, h: 240 };
  // 긴 벽에 big(280) 을 놓으면 맞은편 벽까지 막혀 나머지를 놓을 수 없다. 작은 것 셋은 한 벽에 들어간다.
  const items = [mk('big', 280, 90), mk('s1', 90, 90), mk('s2', 90, 90), mk('s3', 90, 90)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.placements.length, 3);
  assert.deepEqual(r.unplaced, ['big']);
});

test('크기가 같은 가구 여러 개', () => {
  const room = { w: 500, d: 400, h: 240 };
  const items = Array.from({ length: 12 }, (_, i) => mk(`c${i}`, 80, 40));
  const r = solve(room, items, 10);
  validate(room, items, 10, r);
  assert.equal(r.complete, true);
});

// ───────────── 가구 앞 여유 공간 ─────────────

test('앞 여유 공간: 가구 깊이 + 여유가 방에 안 들어가면 그 벽에는 놓지 않는다', () => {
  // 긴 벽(A, C)에 놓으면 깊이 100 + 여유 60 = 160 > 방 세로 150. 짧은 벽(B, D)에 놓으면 160 ≤ 방 가로 300.
  const room = { w: 300, d: 150, h: 240 };
  const items = [mk('a', 120, 100)];
  const r = solve(room, items, 5, { margin: 60 });
  validate(room, items, 5, r, 60);
  assert.equal(r.complete, true);
  assert.ok(['B', 'D'].includes(r.placements[0].wall));
  assert.equal(solve({ w: 150, d: 150, h: 240 }, items, 5, { margin: 60 }).complete, false);
});

test('앞 여유 공간: 두 벽의 가구가 모서리를 비우고 서로 비켜선다', () => {
  // 벽마다 300 짜리 가구가 하나씩. 모서리에 붙이면 옆 벽 가구의 앞을 막으므로, 넷이 바람개비처럼 비켜서야 한다.
  // 모서리마다 한쪽은 60(옆 가구의 깊이), 다른 쪽은 65(깊이 + 간격)만큼 비켜야 하므로 벽에 125 의 여유가 필요하다.
  const items = [mk('a', 300, 60), mk('b', 300, 60), mk('c', 300, 60), mk('d', 300, 60)];
  const roomy = { w: 450, d: 450, h: 240 }; // 여유 150
  const r = solve(roomy, items, 5, { margin: 80 });
  validate(roomy, items, 5, r, 80);
  assert.equal(r.complete, true);
  // 여유가 100 뿐인 방에서는 넷을 다 놓을 수 없다(같은 문제를 1/5 로 줄여 격자 전수 탐색으로 확인).
  const tight = { w: 400, d: 400, h: 240 };
  const r2 = solve(tight, items, 5, { margin: 80 });
  validate(tight, items, 5, r2, 80);
  const small = items.map((it) => mk(it.id, it.w / 5, it.d / 5));
  assert.equal(r2.placements.length, gridMax({ w: 80, d: 80, h: 240 }, small, 1, 16, 1));
  assert.equal(r2.complete, false);
});

test('앞 여유 공간: 같은 벽에 나란히 선 가구에는 영향이 없다', () => {
  const room = { w: 300, d: 200, h: 240 };
  const items = [mk('a', 100, 50), mk('b', 100, 50), mk('c', 90, 50)];
  const r = solve(room, items, 5, { margin: 100 });
  validate(room, items, 5, r, 100);
  assert.equal(r.complete, true);
});

test('앞 여유 공간이 필요 없는 가구(clear: false)는 앞을 비워 두지 않아도 된다', () => {
  // 방 세로 150. 깊이 100 짜리 침대는 여유 60 을 두면 긴 벽에 못 놓지만, 여유가 필요 없으면 놓을 수 있다.
  const room = { w: 300, d: 150, h: 240 };
  const need = solve(room, [mk('bed', 250, 100)], 5, { margin: 60 });
  assert.equal(need.complete, false);
  const bed = [mk('bed', 250, 100, 45, { clear: false })];
  const free = solve(room, bed, 5, { margin: 60 });
  validate(room, bed, 5, free, 60);
  assert.equal(free.complete, true);
});

test('앞 여유 공간이 필요 없는 가구도 다른 가구의 앞은 막지 못한다', () => {
  // 벽 A 에 책상(앞 60 필요), 맞은편 벽 C 에 침대(앞 공간 불필요). 사이가 여유보다 좁으면 마주 볼 수 없다.
  const room = { w: 300, d: 200, h: 240 };
  const items = [mk('desk', 280, 60), mk('bed', 280, 100, 45, { clear: false })];
  const r = solve(room, items, 5, { margin: 60 }); // 200 - 60 - 100 = 40 < 60
  validate(room, items, 5, r, 60);
  assert.equal(r.placements.length, 1);
  assert.equal(gridMax(room, items, 5, 60, 5), 1);
  // 책상도 앞 공간이 필요 없으면 간격만 지키면 되므로 둘 다 놓인다.
  const both = [mk('desk', 280, 60, 75, { clear: false }), items[1]];
  const r2 = solve(room, both, 5, { margin: 60 });
  validate(room, both, 5, r2, 60);
  assert.equal(r2.complete, true);
});

test('앞 여유 공간이 0 이면 여유 없이 배치한 결과와 같다', () => {
  const rnd = lcg(31337);
  for (let t = 0; t < 40; t++) {
    const room = { w: 150 + Math.floor(rnd() * 300), d: 150 + Math.floor(rnd() * 300), h: 240 };
    const items = Array.from({ length: 2 + Math.floor(rnd() * 5) }, (_, i) => mk(`i${i}`, 30 + Math.floor(rnd() * 140), 20 + Math.floor(rnd() * 90)));
    assert.deepEqual(solve(room, items, 5, { margin: 0 }).placements, solve(room, items, 5).placements);
  }
});

// ───────────── 무작위 검증 ─────────────

test('무작위 입력에서도 항상 규칙을 지킨다', () => {
  const rnd = lcg(12345);
  for (let t = 0; t < 150; t++) {
    const room = { w: 150 + Math.floor(rnd() * 450), d: 150 + Math.floor(rnd() * 450), h: 220 + Math.floor(rnd() * 60) };
    const n = 1 + Math.floor(rnd() * 11);
    const items = Array.from({ length: n }, (_, i) =>
      mk(`i${i}`, 20 + Math.floor(rnd() * 200), 20 + Math.floor(rnd() * 100), 30 + Math.floor(rnd() * 250), rnd() < 0.25 ? { clear: false } : {}),
    );
    const gap = Math.floor(rnd() * 4) * 5;
    const margin = Math.floor(rnd() * 4) * 30;
    const r = solve(room, items, gap, { margin, timeLimitMs: 60 });
    validate(room, items, gap, r, margin);
    const shuffled = solve(room, items, gap, { margin, timeLimitMs: 60, random: rnd });
    validate(room, items, gap, shuffled, margin);
  }
});

test('제한 시간을 지키고, 그동안 찾은 가장 좋은 배치를 돌려준다', () => {
  const rnd = lcg(4242);
  const room = { w: 500, d: 400, h: 240 };
  const items = Array.from({ length: 40 }, (_, i) => mk(`i${i}`, 40 + Math.floor(rnd() * 90), 30 + Math.floor(rnd() * 60)));
  const seen = [];
  const t0 = performance.now();
  const r = solve(room, items, 5, { margin: 40, timeLimitMs: 300, onProgress: (p) => seen.push(p.placements.length) });
  const elapsed = performance.now() - t0;
  validate(room, items, 5, r, 40);
  assert.ok(elapsed < 1500, `너무 오래 걸림: ${elapsed}ms`);
  assert.equal(r.timedOut, true);
  assert.ok(seen.length > 0, '진행 상황이 보고되지 않음');
  assert.ok(r.placements.length >= Math.max(...seen), '최종 결과가 중간 결과보다 나쁨');
});

test('같은 시드는 같은 난수열을 만든다', () => {
  const a = seededRandom(123);
  const b = seededRandom(123);
  const c = seededRandom(124);
  const xs = Array.from({ length: 5 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b()));
  assert.notDeepEqual(xs, Array.from({ length: 5 }, () => c()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('작은 입력은 격자 전수 탐색과 같은 개수를 배치한다(네 벽, 간격, 앞 여유 공간, 가구별 여유 여부)', () => {
  // 모든 치수를 10cm 단위로 만들면 최적 배치의 좌표도 10cm 단위가 되므로,
  // 10cm 격자의 모든 위치를 다 놓아 보는 탐색과 결과가 같아야 한다.
  const rnd = lcg(777);
  const ten = (lo, hi) => 10 * (lo + Math.floor(rnd() * (hi - lo + 1)));
  for (let t = 0; t < 160; t++) {
    const room = { w: ten(10, 24), d: ten(10, 24), h: 240 };
    const n = 2 + Math.floor(rnd() * 3);
    const items = Array.from({ length: n }, (_, i) => mk(`i${i}`, ten(3, 16), ten(2, 9), 100, rnd() < 0.25 ? { clear: false } : {}));
    const gap = 10 * Math.floor(rnd() * 2);
    const margin = t % 4 === 0 ? 0 : 20 * Math.floor(rnd() * 5);
    const r = solve(room, items, gap, { margin, timeLimitMs: 8000 });
    validate(room, items, gap, r, margin);
    assert.equal(r.timedOut, false, `case ${t} 시간 초과`);
    const expected = gridMax(room, items, gap, margin, 10);
    assert.equal(
      r.placements.length,
      expected,
      `case ${t}: room ${room.w}x${room.d} gap=${gap} margin=${margin} items=${items.map((i) => `${i.w}x${i.d}${i.clear === false ? '*' : ''}`).join(',')}`,
    );
  }
});

// ───────────── 우선순위 ─────────────

/** 우선순위 등급(작은 숫자가 먼저, 없으면 맨 뒤)별로 놓인 가구 수 */
function tallyOf(items, placedIds) {
  const key = (it) => (Number.isInteger(it.priority) ? it.priority : Infinity);
  const levels = [...new Set(items.map(key))].sort((a, b) => a - b);
  return levels.map((lv) => items.filter((it) => key(it) === lv && placedIds.has(it.id)).length);
}

function lexCompare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** 격자 전수 탐색으로 구한 "가장 좋은 등급별 개수"(높은 등급부터 비교). 솔버와 무관한 구현. */
function gridBestTally(room, items, gap, margin, step) {
  const n = items.length;
  let best = null;
  const placed = [];
  const chosen = new Set();
  const rec = (i) => {
    // 남은 가구를 전부 놓는다고 쳐도 최고 기록을 못 넘으면 그만둔다.
    if (best) {
      const optimistic = new Set(chosen);
      for (let k = i; k < n; k++) optimistic.add(items[k].id);
      if (lexCompare(tallyOf(items, optimistic), best) <= 0) return;
    }
    if (i === n) {
      best = tallyOf(items, chosen);
      return;
    }
    const it = items[i];
    const m = frontNeed(it, margin);
    if (it.h <= room.h) {
      for (let wall = 0; wall < 4; wall++) {
        const L = wall % 2 === 0 ? room.w : room.d;
        for (let t = 0; t + it.w <= L; t += step) {
          const cand = { r: rectOn(room, wall, t, it), wall, m };
          if (!inside(room, cand.r) || (m > 0 && !inside(room, frontOf(cand.r, wall, m)))) continue;
          if (!placed.every((o) => compatible(cand, o, gap))) continue;
          placed.push(cand);
          chosen.add(it.id);
          rec(i + 1);
          chosen.delete(it.id);
          placed.pop();
        }
      }
    }
    rec(i + 1);
  };
  rec(0);
  return best;
}

test('우선순위: 하나만 들어갈 때 우선순위가 높은(숫자가 작은) 가구가 들어간다', () => {
  const room = { w: 300, d: 100, h: 240 };
  const items = [mk('low', 280, 90, 100, { priority: 2 }), mk('high', 280, 90, 100, { priority: 1 })];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.deepEqual(r.placements.map((p) => p.id), ['high']);
  // 순서를 바꿔도 같다.
  assert.deepEqual(solve(room, [items[1], items[0]], 5).placements.map((p) => p.id), ['high']);
});

test('우선순위: 우선순위가 높은 가구 하나가 우선순위 낮은 가구 여럿보다 먼저다', () => {
  // 우선순위가 없을 때는 작은 것 셋을 놓지만(개수 최대화), big 에 우선순위를 주면 big 이 먼저 들어간다.
  const room = { w: 300, d: 100, h: 240 };
  const plain = [mk('big', 280, 90), mk('s1', 90, 90), mk('s2', 90, 90), mk('s3', 90, 90)];
  assert.deepEqual(solve(room, plain, 5).unplaced, ['big']);
  const ranked = [mk('big', 280, 90, 100, { priority: 1 }), ...plain.slice(1)];
  const r = solve(room, ranked, 5);
  validate(room, ranked, 5, r);
  assert.ok(r.placements.some((p) => p.id === 'big'));
  // 작은 것들에도 우선순위를 주되 big 보다 낮게 하면 여전히 big 이 먼저다.
  const lower = [ranked[0], ...plain.slice(1).map((it) => ({ ...it, priority: 5 }))];
  assert.ok(solve(room, lower, 5).placements.some((p) => p.id === 'big'));
  // 작은 것들의 우선순위가 더 높으면 작은 것 셋이 들어간다.
  const flipped = [{ ...plain[0], priority: 9 }, ...plain.slice(1).map((it) => ({ ...it, priority: 2 }))];
  assert.deepEqual(solve(room, flipped, 5).unplaced, ['big']);
});

test('우선순위: 우선순위를 준 가구가 우선순위 없는 가구보다 먼저다', () => {
  const room = { w: 300, d: 100, h: 240 };
  const items = [mk('none', 280, 90), mk('p99', 280, 90, 100, { priority: 99 })];
  assert.deepEqual(solve(room, items, 5).placements.map((p) => p.id), ['p99']);
});

test('우선순위: 범위를 벗어난 값은 우선순위가 없는 것으로 본다', () => {
  const room = { w: 300, d: 100, h: 240 };
  for (const bad of [0, 100, 1.5, '1', null]) {
    const items = [mk('bad', 280, 90, 100, { priority: bad }), mk('p50', 280, 90, 100, { priority: 50 })];
    assert.deepEqual(solve(room, items, 5).placements.map((p) => p.id), ['p50'], String(bad));
  }
});

test('우선순위: 다 들어가면 우선순위와 상관없이 전부 배치한다', () => {
  const room = { w: 500, d: 400, h: 240 };
  const items = [mk('a', 200, 60, 100, { priority: 3 }), mk('b', 150, 60), mk('c', 100, 40, 100, { priority: 1 }), mk('d', 80, 40, 100, { priority: 1 })];
  const r = solve(room, items, 5, { margin: 60 });
  validate(room, items, 5, r, 60);
  assert.equal(r.complete, true);
});

test('우선순위: 작은 입력에서 격자 전수 탐색과 같은 등급별 개수를 낸다', () => {
  const rnd = lcg(2468);
  const ten = (lo, hi) => 10 * (lo + Math.floor(rnd() * (hi - lo + 1)));
  const prios = [undefined, undefined, 1, 2, 3];
  for (let t = 0; t < 130; t++) {
    const room = { w: ten(9, 20), d: ten(9, 20), h: 240 };
    const n = 3 + Math.floor(rnd() * 2);
    const items = Array.from({ length: n }, (_, i) => {
      const extra = rnd() < 0.2 ? { clear: false } : {};
      const priority = prios[Math.floor(rnd() * prios.length)];
      if (priority) extra.priority = priority;
      return mk(`i${i}`, ten(3, 14), ten(2, 8), 100, extra);
    });
    const gap = 10 * Math.floor(rnd() * 2);
    const margin = t % 3 === 0 ? 0 : 20 * Math.floor(rnd() * 4);
    const r = solve(room, items, gap, { margin, timeLimitMs: 8000 });
    validate(room, items, gap, r, margin);
    assert.equal(r.timedOut, false, `case ${t} 시간 초과`);
    const got = tallyOf(items, new Set(r.placements.map((p) => p.id)));
    const expected = gridBestTally(room, items, gap, margin, 10);
    assert.deepEqual(
      got,
      expected,
      `case ${t}: room ${room.w}x${room.d} gap=${gap} margin=${margin} items=${items.map((i) => `${i.w}x${i.d}p${i.priority ?? '-'}${i.clear === false ? '*' : ''}`).join(',')}`,
    );
  }
});
