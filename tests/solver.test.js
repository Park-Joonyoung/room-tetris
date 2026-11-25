import test from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../js/solver.js';
import { footprint } from '../js/geom.js';

const TOL = 1e-3;

/** 배치 결과가 모든 규칙을 지키는지 검사한다. */
function validate(room, items, gap, result) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const rects = result.placements.map((p) => {
    const it = byId.get(p.id);
    assert.ok(it, `unknown id ${p.id}`);
    const { sx, sz } = footprint({ ...it, rot: p.rot });
    return { id: p.id, x: p.x, z: p.z, sx, sz, h: it.h };
  });
  const ids = new Set(result.placements.map((p) => p.id));
  assert.equal(ids.size, result.placements.length, '같은 가구가 두 번 배치됨');
  assert.equal(result.placements.length + result.unplaced.length, items.length);
  for (const id of result.unplaced) assert.ok(!ids.has(id));
  assert.equal(result.complete, result.unplaced.length === 0);

  for (const r of rects) {
    assert.ok(r.x >= -TOL && r.z >= -TOL, `${r.id} 방 밖(음수)`);
    assert.ok(r.x + r.sx <= room.w + TOL, `${r.id} 가로 초과`);
    assert.ok(r.z + r.sz <= room.d + TOL, `${r.id} 세로 초과`);
    assert.ok(r.h <= room.h + TOL, `${r.id} 높이 초과`);
    assert.ok(Math.abs(r.x) <= TOL || Math.abs(r.z) <= TOL, `${r.id} 벽에 붙어 있지 않음`);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const dx = Math.max(b.x - (a.x + a.sx), a.x - (b.x + b.sx));
      const dz = Math.max(b.z - (a.z + a.sz), a.z - (b.z + b.sz));
      assert.ok(
        dx >= gap - TOL || dz >= gap - TOL,
        `${a.id}, ${b.id} 간격 부족 (dx=${dx}, dz=${dz}, gap=${gap})`,
      );
    }
  }
}

const mk = (id, w, d, h = 100) => ({ id, w, d, h });

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
  assert.equal(r.placements[0].x, 0);
  assert.equal(r.placements[0].z, 0);
});

test('넉넉한 방에는 전부 배치', () => {
  const room = { w: 400, d: 300, h: 240 };
  const items = [mk('bed', 200, 100, 45), mk('ward', 120, 60, 200), mk('desk', 120, 60, 75), mk('shelf', 80, 30, 180)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.complete, true);
});

test('간격 때문에 한 벽에 못 들어가면 두 벽으로 나눈다', () => {
  const room = { w: 200, d: 200, h: 240 };
  // 한 벽에 100 + 100 은 간격 10 때문에 불가능. 두 번째는 다른 벽으로 가야 한다.
  const items = [mk('a', 100, 40), mk('b', 100, 40)];
  const r = solve(room, items, 10);
  validate(room, items, 10, r);
  assert.equal(r.complete, true);
  assert.notEqual(r.placements[0].wall, r.placements[1].wall);
});

test('간격이 0이면 딱 맞게 붙는다', () => {
  const room = { w: 200, d: 100, h: 240 };
  const items = [mk('a', 100, 40), mk('b', 100, 40)];
  const r = solve(room, items, 0);
  validate(room, items, 0, r);
  assert.equal(r.complete, true);
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
  const items = [mk('huge', 150, 150)];
  const r = solve(room, items, 0);
  assert.deepEqual(r.unplaced, ['huge']);
});

test('돌려야만 들어가는 가구는 돌려서 배치', () => {
  // 벽 A(200)에는 120 짜리가 하나만 들어가고, 벽 B(110)에는 120 이 안 들어간다.
  // 두 번째 가구를 돌려서(벽을 따라 50) 벽 B의 z=55~105 에 놓아야 전부 들어간다.
  const room = { w: 200, d: 110, h: 240 };
  const items = [mk('a', 120, 50), mk('b', 120, 50)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.complete, true);
});

test('불가능하면 최대한 많이 배치하고 나머지는 남긴다', () => {
  const room = { w: 200, d: 200, h: 240 };
  // 벽마다 100 짜리 하나씩(모서리 손실 고려) 정도만 가능한 상황에 5개
  const items = [mk('a', 100, 100), mk('b', 100, 100), mk('c', 100, 100), mk('d', 100, 100), mk('e', 100, 100)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.complete, false);
  // 모서리에 하나, 그 옆(x 방향)과 아래(z 방향)로 하나씩은 들어갈 수 없다(105+100 > 200) → 최대 1개... 가 아니라
  // 벽 A에 하나(0~100), 벽 B는 z=105 에서 시작해야 해서 205 > 200 불가 → 정확히 1개
  assert.equal(r.placements.length, 1);
});

test('개수를 최대화한다: 큰 것 하나보다 작은 것 여러 개', () => {
  const room = { w: 300, d: 100, h: 240 };
  // 벽 A 길이 300. big(280) 하나를 놓으면 나머지를 놓을 수 없다. 작은 것 셋은 들어간다.
  const items = [mk('big', 280, 90), mk('s1', 90, 90), mk('s2', 90, 90), mk('s3', 90, 90)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.placements.length, 3);
  assert.deepEqual(r.unplaced, ['big']);
});

test('모서리 맞물림: 얕은 가구를 모서리에 둬야 전부 들어가는 경우', () => {
  // 벽 A(300): deep(200x150) + thin(95x30) = 200+5+95 = 300 딱 맞음.
  // 벽 B(260): 모서리에 thin(깊이 30)이 오면 z=35 부터 쓸 수 있어 b(220) 가 들어간다(35+220=255).
  // 모서리에 deep(깊이 150)이 오면 z=155 부터라 b 가 못 들어간다.
  const room = { w: 300, d: 260, h: 240 };
  const items = [mk('deep', 200, 150), mk('thin', 95, 30), mk('b', 220, 90)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.complete, true);
});

test('크기가 같은 가구 여러 개', () => {
  const room = { w: 500, d: 400, h: 240 };
  const items = Array.from({ length: 8 }, (_, i) => mk(`c${i}`, 80, 40));
  const r = solve(room, items, 10);
  validate(room, items, 10, r);
  // 벽 A: 80*5 + 10*4 = 440 → 5개. 벽 B: z=50 부터 80,90.. → (400-50+10)/90 = 4개. 총 9칸 ≥ 8
  assert.equal(r.complete, true);
});

test('무작위 입력에서도 항상 규칙을 지킨다', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let t = 0; t < 150; t++) {
    const room = { w: 150 + Math.floor(rnd() * 450), d: 150 + Math.floor(rnd() * 450), h: 220 + Math.floor(rnd() * 60) };
    const n = 1 + Math.floor(rnd() * 9);
    const items = Array.from({ length: n }, (_, i) =>
      mk(`i${i}`, 20 + Math.floor(rnd() * 200), 20 + Math.floor(rnd() * 100), 30 + Math.floor(rnd() * 250)),
    );
    const gap = Math.floor(rnd() * 4) * 5;
    const r = solve(room, items, gap, { timeLimitMs: 60 });
    validate(room, items, gap, r);
    const shuffled = solve(room, items, gap, { timeLimitMs: 60, random: rnd });
    validate(room, items, gap, shuffled);
  }
});

test('작은 입력은 전수 조사 결과와 같은 개수를 배치한다', () => {
  let seed = 777;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let t = 0; t < 60; t++) {
    const room = { w: 120 + Math.floor(rnd() * 200), d: 120 + Math.floor(rnd() * 200), h: 240 };
    const n = 2 + Math.floor(rnd() * 4);
    const items = Array.from({ length: n }, (_, i) => mk(`i${i}`, 30 + Math.floor(rnd() * 140), 20 + Math.floor(rnd() * 90)));
    const gap = Math.floor(rnd() * 3) * 5;
    const r = solve(room, items, gap, { timeLimitMs: 300 });
    validate(room, items, gap, r);
    assert.equal(r.placements.length, bruteForceMax(room, items, gap), `case ${t}`);
  }
});

/**
 * 독립적인 방식의 전수 조사: 각 가구를 (안 놓음 / 벽 A / 벽 B) × 회전으로 나누고,
 * 벽마다 모든 순서를 시도한 뒤, 두 줄을 번갈아 모서리 쪽으로 미는 대신
 * 후보 좌표 집합(다른 가구의 끝 + gap, 깊이 + gap)에서 직접 위치를 고른다.
 */
function bruteForceMax(room, items, gap) {
  const n = items.length;
  let best = 0;
  const rects = [];

  const ok = (r) => {
    if (r.x + r.sx > room.w + 1e-6 || r.z + r.sz > room.d + 1e-6) return false;
    for (const o of rects) {
      const dx = Math.max(o.x - (r.x + r.sx), r.x - (o.x + o.sx));
      const dz = Math.max(o.z - (r.z + r.sz), r.z - (o.z + o.sz));
      if (dx < gap - 1e-6 && dz < gap - 1e-6) return false;
    }
    return true;
  };

  const rec = (i, count) => {
    if (count + (n - i) <= best) return;
    if (i === n) {
      best = Math.max(best, count);
      return;
    }
    const it = items[i];
    const cands = new Set([0]);
    for (const o of rects) {
      cands.add(o.x + o.sx + gap);
      cands.add(o.z + o.sz + gap);
    }
    for (const rot of [0, 1]) {
      const len = rot ? it.d : it.w;
      const dep = rot ? it.w : it.d;
      for (const pos of cands) {
        const a = { x: pos, z: 0, sx: len, sz: dep }; // 벽 A
        if (ok(a)) {
          rects.push(a);
          rec(i + 1, count + 1);
          rects.pop();
        }
        const b = { x: 0, z: pos, sx: dep, sz: len }; // 벽 B
        if (ok(b)) {
          rects.push(b);
          rec(i + 1, count + 1);
          rects.pop();
        }
      }
    }
    rec(i + 1, count);
  };

  // 가구를 놓는 순서에 따라 후보 좌표가 달라지므로 모든 순열을 시도한다.
  const perm = (arr, k) => {
    if (k === arr.length) {
      const saved = items.slice();
      for (let i = 0; i < n; i++) items[i] = arr[i];
      rec(0, 0);
      for (let i = 0; i < n; i++) items[i] = saved[i];
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      perm(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  perm(items.slice(), 0);
  return best;
}
