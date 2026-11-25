import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, seededRandom } from '../js/solver.js';
import { footprint } from '../js/geom.js';

const TOL = 1e-3;

/** 가구 앞(벽 반대쪽) 여유 공간 사각형 */
function frontZone(r, margin) {
  return r.wall === 'A' ? { x: r.x, z: r.z + r.sz, sx: r.sx, sz: margin } : { x: r.x + r.sx, z: r.z, sx: margin, sz: r.sz };
}

function overlaps(a, b) {
  return a.x < b.x + b.sx - TOL && b.x < a.x + a.sx - TOL && a.z < b.z + b.sz - TOL && b.z < a.z + a.sz - TOL;
}

/** 배치 결과가 모든 규칙을 지키는지 검사한다. */
function validate(room, items, gap, result, margin = 0) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const rects = result.placements.map((p) => {
    const it = byId.get(p.id);
    assert.ok(it, `unknown id ${p.id}`);
    const { sx, sz } = footprint({ ...it, rot: p.rot });
    return { id: p.id, x: p.x, z: p.z, sx, sz, h: it.h, wall: p.wall };
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
    const zone = frontZone(r, margin);
    assert.ok(zone.x + zone.sx <= room.w + TOL && zone.z + zone.sz <= room.d + TOL, `${r.id} 앞 여유 공간이 방 밖으로 나감`);
  }
  // 가구는 돌리지 않는다: 가로(w)는 벽을 따라, 세로(d)는 벽에서 방 안쪽으로.
  for (const p of result.placements) {
    const it = byId.get(p.id);
    const r = rects.find((x) => x.id === p.id);
    if (p.wall === 'A') {
      assert.ok(Math.abs(p.z) <= TOL && p.rot === 0, `${p.id} 벽 A 방향이 아님`);
      assert.ok(Math.abs(r.sx - it.w) <= TOL && Math.abs(r.sz - it.d) <= TOL, `${p.id} 벽 A에서 가로가 벽을 따르지 않음`);
    } else {
      assert.equal(p.wall, 'B');
      assert.ok(Math.abs(p.x) <= TOL && p.rot === 1, `${p.id} 벽 B 방향이 아님`);
      assert.ok(Math.abs(r.sz - it.w) <= TOL && Math.abs(r.sx - it.d) <= TOL, `${p.id} 벽 B에서 가로가 벽을 따르지 않음`);
    }
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const a = rects[i];
      const b = rects[j];
      if (i < j) {
        const dx = Math.max(b.x - (a.x + a.sx), a.x - (b.x + b.sx));
        const dz = Math.max(b.z - (a.z + a.sz), a.z - (b.z + b.sz));
        assert.ok(dx >= gap - TOL || dz >= gap - TOL, `${a.id}, ${b.id} 간격 부족 (dx=${dx}, dz=${dz}, gap=${gap})`);
      }
      if (margin > 0) assert.ok(!overlaps(frontZone(a, margin), b), `${b.id} 이(가) ${a.id} 의 앞 여유 공간을 막음`);
    }
  }
}

const mk = (id, w, d, h = 100) => ({ id, w, d, h });
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

test('가구를 돌리지 않는다: 돌려야만 들어가는 가구는 남긴다', () => {
  // 벽 A(200)에는 120 짜리가 하나만 들어가고, 벽 B(110)에는 120 이 안 들어간다.
  // 두 번째 가구를 90도 돌리면(벽을 따라 50) 벽 B에 들어가지만, 회전은 하지 않으므로 하나만 배치된다.
  const room = { w: 200, d: 110, h: 240 };
  const items = [mk('a', 120, 50), mk('b', 120, 50)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.complete, false);
  assert.equal(r.placements.length, 1);
  assert.equal(r.timedOut, false);
});

test('불가능하면 최대한 많이 배치하고 나머지는 남긴다', () => {
  const room = { w: 200, d: 200, h: 240 };
  // 벽 A에 하나(0~100)를 놓으면 그 옆은 105+100 > 200, 벽 B는 z=105 에서 시작해야 해서 역시 불가 → 정확히 1개
  const items = [mk('a', 100, 100), mk('b', 100, 100), mk('c', 100, 100), mk('d', 100, 100), mk('e', 100, 100)];
  const r = solve(room, items, 5);
  validate(room, items, 5, r);
  assert.equal(r.complete, false);
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

// ───────────── 가구 앞 여유 공간 ─────────────

test('앞 여유 공간: 가구 깊이 + 여유가 방에 안 들어가면 그 벽에는 놓지 않는다', () => {
  // 벽 A에 놓으면 깊이 100 + 여유 60 = 160 > 방 세로 150. 벽 B에 놓으면 160 ≤ 방 가로 300 이라 가능.
  const room = { w: 300, d: 150, h: 240 };
  const items = [mk('a', 120, 100)];
  const r = solve(room, items, 5, { margin: 60 });
  validate(room, items, 5, r, 60);
  assert.equal(r.complete, true);
  assert.equal(r.placements[0].wall, 'B');
  // 여유를 더 늘리면 어느 벽에도 놓을 수 없다.
  assert.equal(solve({ w: 150, d: 150, h: 240 }, items, 5, { margin: 60 }).complete, false);
});

test('앞 여유 공간: 다른 벽의 가구가 앞을 막지 않도록 띄운다', () => {
  const room = { w: 400, d: 400, h: 240 };
  // 두 가구가 각 벽의 모서리 쪽에 온다. 여유 0 이면 벽 B 가구는 z = 60+5 = 65 에서 시작할 수 있지만,
  // 여유 80 이면 벽 A 가구의 앞(깊이 60 + 80 = 140)을 비워야 하거나, 대각선으로 비켜서야 한다.
  const items = [mk('a', 300, 60), mk('b', 300, 60)];
  const tight = solve(room, items, 5, { margin: 0 });
  validate(room, items, 5, tight, 0);
  assert.equal(tight.complete, true);
  const roomy = solve(room, items, 5, { margin: 80 });
  validate(room, items, 5, roomy, 80);
  // 벽 A: a(0~300). 벽 B 의 b 는 a 의 깊이 60 + 여유 80 = 140 부터 → 140+300 > 400 불가.
  // 대각선(a 를 x ≥ 60+5 로 밀고 b 를 z ≥ 60 에) → 65+300 ≤ 400, 60+300 ≤ 400 가능.
  assert.equal(roomy.complete, true);
  const a = roomy.placements.find((p) => p.id === 'a');
  const b = roomy.placements.find((p) => p.id === 'b');
  assert.ok(Math.min(a.x + a.z, b.x + b.z) >= 60, '한쪽은 모서리에서 비켜나 있어야 함');
});

test('앞 여유 공간: 같은 벽에 나란히 선 가구에는 영향이 없다', () => {
  const room = { w: 300, d: 200, h: 240 };
  const items = [mk('a', 100, 50), mk('b', 100, 50), mk('c', 90, 50)];
  const r = solve(room, items, 5, { margin: 100 });
  validate(room, items, 5, r, 100);
  assert.equal(r.complete, true); // 100+5+100+5+90 = 300, 전부 벽 A 한 줄로
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
    const n = 1 + Math.floor(rnd() * 9);
    const items = Array.from({ length: n }, (_, i) =>
      mk(`i${i}`, 20 + Math.floor(rnd() * 200), 20 + Math.floor(rnd() * 100), 30 + Math.floor(rnd() * 250)),
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
  const room = { w: 700, d: 600, h: 240 };
  const items = Array.from({ length: 26 }, (_, i) => mk(`i${i}`, 40 + Math.floor(rnd() * 90), 30 + Math.floor(rnd() * 60)));
  const seen = [];
  const t0 = performance.now();
  const r = solve(room, items, 5, { timeLimitMs: 300, onProgress: (p) => seen.push(p.placements.length) });
  const elapsed = performance.now() - t0;
  validate(room, items, 5, r);
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

test('작은 입력은 격자 전수 탐색과 같은 개수를 배치한다(간격·앞 여유 공간 포함)', () => {
  // 모든 치수를 10cm 단위로 만들면 최적 배치의 좌표도 10cm 단위가 되므로,
  // 10cm 격자의 모든 위치를 다 놓아 보는 탐색과 결과가 같아야 한다.
  const rnd = lcg(777);
  const ten = (lo, hi) => 10 * (lo + Math.floor(rnd() * (hi - lo + 1)));
  for (let t = 0; t < 140; t++) {
    const room = { w: ten(12, 30), d: ten(12, 30), h: 240 };
    const n = 2 + Math.floor(rnd() * 3);
    const items = Array.from({ length: n }, (_, i) => mk(`i${i}`, ten(3, 16), ten(2, 10)));
    const gap = 10 * Math.floor(rnd() * 2);
    const margin = t % 4 === 0 ? 0 : 20 * Math.floor(rnd() * 5);
    const r = solve(room, items, gap, { margin, timeLimitMs: 5000 });
    validate(room, items, gap, r, margin);
    assert.equal(r.timedOut, false, `case ${t} 시간 초과`);
    const expected = gridMax(room, items, gap, margin, 10);
    assert.equal(r.placements.length, expected, `case ${t}: room ${room.w}x${room.d} gap=${gap} margin=${margin} items=${items.map((i) => i.w + 'x' + i.d).join(',')}`);
  }
});

/**
 * 솔버와 전혀 다른 방식의 전수 탐색: 가구마다 (안 놓음 / 벽 A / 벽 B) × 격자 위의 모든 위치를 시도하고
 * 규칙(방 안, 간격, 앞 여유 공간)을 직접 검사한다. "모서리 쪽으로 붙인다" 같은 가정을 쓰지 않는다.
 */
function gridMax(room, items, gap, margin, step) {
  const n = items.length;
  let best = 0;
  const rects = [];

  const ok = (r) => {
    if (r.x + r.sx > room.w + 1e-6 || r.z + r.sz > room.d + 1e-6) return false;
    const zone = frontZone(r, margin);
    if (zone.x + zone.sx > room.w + 1e-6 || zone.z + zone.sz > room.d + 1e-6) return false;
    for (const o of rects) {
      const dx = Math.max(o.x - (r.x + r.sx), r.x - (o.x + o.sx));
      const dz = Math.max(o.z - (r.z + r.sz), r.z - (o.z + o.sz));
      if (dx < gap - 1e-6 && dz < gap - 1e-6) return false;
      if (margin > 0 && (overlaps(zone, o) || overlaps(frontZone(o, margin), r))) return false;
    }
    return true;
  };

  const rec = (i, count) => {
    if (best === n || count + (n - i) <= best) return;
    if (i === n) {
      best = count;
      return;
    }
    const it = items[i];
    for (let pos = 0; pos + it.w <= room.w; pos += step) {
      const a = { x: pos, z: 0, sx: it.w, sz: it.d, wall: 'A' }; // 가로가 벽 A 를 따른다
      if (!ok(a)) continue;
      rects.push(a);
      rec(i + 1, count + 1);
      rects.pop();
    }
    for (let pos = 0; pos + it.w <= room.d; pos += step) {
      const b = { x: 0, z: pos, sx: it.d, sz: it.w, wall: 'B' }; // 가로가 벽 B 를 따른다
      if (!ok(b)) continue;
      rects.push(b);
      rec(i + 1, count + 1);
      rects.pop();
    }
    rec(i + 1, count);
  };
  rec(0, 0);
  return best;
}
