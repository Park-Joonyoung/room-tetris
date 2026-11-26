import test from 'node:test';
import assert from 'node:assert/strict';
import { placementAllowed, slideToward, frontZone } from '../js/geom.js';
import { solve } from '../js/solver.js';
import { footprint } from '../js/geom.js';

const room = { w: 400, d: 300 };
const rect = (x, z, sx, sz) => ({ x, z, sx, sz });
// 벽 A(z=0)를 따라 놓인 침대 200×100, 모서리에 붙어 있다.
const bed = { rect: rect(0, 0, 200, 100), rot: 0 };
const ON = { gap: 5, margin: 60 };

test('frontZone: 벽 A 방향은 +z, 벽 B 방향은 +x 가 앞', () => {
  assert.deepEqual(frontZone(rect(10, 0, 100, 50), 0, 60), rect(10, 50, 100, 60));
  assert.deepEqual(frontZone(rect(0, 10, 50, 100), 1, 60), rect(50, 10, 60, 100));
});

test('간격: 옆 가구와 간격보다 가까우면 안 된다', () => {
  const chair = (x) => rect(x, 0, 50, 50);
  assert.equal(placementAllowed(chair(205), 0, [bed], room, ON), true); // 딱 간격만큼
  assert.equal(placementAllowed(chair(204), 0, [bed], room, ON), false);
  assert.equal(placementAllowed(chair(180), 0, [bed], room, ON), false); // 겹침
  // 간격 규칙을 끄면 붙이거나 겹쳐 놓을 수 있다.
  assert.equal(placementAllowed(chair(200), 0, [bed], room, { gap: null, margin: 60 }), true);
  assert.equal(placementAllowed(chair(180), 0, [bed], room, { gap: null, margin: 60 }), true);
});

test('앞 여유 공간: 다른 가구의 앞을 몸체로 막으면 안 된다', () => {
  // 벽 B(x=0)를 따라 놓는 서랍장 45(깊이)×80. 침대 앞(z 100~160)에 걸치면 안 된다.
  const drawer = (z) => rect(0, z, 45, 80);
  assert.equal(placementAllowed(drawer(160), 1, [bed], room, ON), true); // 침대 앞 공간 바로 뒤
  assert.equal(placementAllowed(drawer(159), 1, [bed], room, ON), false);
  assert.equal(placementAllowed(drawer(105), 1, [bed], room, ON), false); // 간격은 지켰지만 침대 앞을 막음
  // 앞 여유 공간 규칙을 끄면 간격만 지키면 된다.
  assert.equal(placementAllowed(drawer(105), 1, [bed], room, { gap: 5, margin: null }), true);
  assert.equal(placementAllowed(drawer(104), 1, [bed], room, { gap: 5, margin: null }), false);
});

test('앞 여유 공간: 내 앞 공간에 다른 가구가 있어도 안 된다', () => {
  // 방 가운데의 의자 50×50 (벽 A 방향). 벽 B 쪽 책상(60 깊이 × 120)을 의자 앞으로 가져오면 막힌다.
  const chair = { rect: rect(100, 150, 50, 50), rot: 0 }; // 앞 공간: z 200~260
  const desk = (x, z) => rect(x, z, 60, 120);
  assert.equal(placementAllowed(desk(100, 205), 1, [chair], room, ON), false);
  assert.equal(placementAllowed(desk(100, 205), 1, [chair], room, { gap: 5, margin: null }), true);
});

test('앞 여유 공간: 내 앞 공간이 방 밖으로 나가면 안 된다', () => {
  const chair = (z) => rect(300, z, 50, 50);
  assert.equal(placementAllowed(chair(190), 0, [], room, ON), true); // 190 + 50 + 60 = 300
  assert.equal(placementAllowed(chair(191), 0, [], room, ON), false);
  assert.equal(placementAllowed(chair(250), 0, [], room, { gap: 5, margin: null }), true);
  // 여유를 둘 수 없을 만큼 깊은 가구는 이 검사에서 빠진다(아예 못 놓게 되지 않도록).
  assert.equal(placementAllowed(rect(0, 0, 100, 280), 0, [], room, ON), true);
});

test('간격을 끄고 겹쳐 놓을 때는 그 가구의 앞 공간을 따지지 않는다(인벤토리로 갈 가구이므로)', () => {
  const onBed = rect(50, 20, 50, 50);
  assert.equal(placementAllowed(onBed, 0, [bed], room, { gap: null, margin: 60 }), true);
  assert.equal(placementAllowed(onBed, 0, [bed], room, ON), false);
});

test('자동 배치 결과는 손으로 옮길 때의 규칙에도 맞는다', () => {
  let seed = 2024;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let t = 0; t < 60; t++) {
    const r = { w: 200 + Math.floor(rnd() * 400), d: 200 + Math.floor(rnd() * 400), h: 240 };
    const items = Array.from({ length: 1 + Math.floor(rnd() * 7) }, (_, i) => ({ id: `i${i}`, w: 30 + Math.floor(rnd() * 150), d: 20 + Math.floor(rnd() * 80), h: 100 }));
    const rules = { gap: Math.floor(rnd() * 3) * 5, margin: Math.floor(rnd() * 4) * 30 };
    const result = solve(r, items, rules.gap, { margin: rules.margin, timeLimitMs: 100 });
    const placed = result.placements.map((p) => {
      const it = items.find((x) => x.id === p.id);
      return { rect: { x: p.x, z: p.z, ...footprint({ ...it, rot: p.rot }) }, rot: p.rot };
    });
    placed.forEach((p, i) => {
      const others = placed.filter((_, j) => j !== i);
      assert.equal(placementAllowed(p.rect, p.rot, others, r, rules), true, `case ${t} item ${i}`);
    });
  }
});

test('slideToward: 갈 수 있는 자리면 그대로 간다', () => {
  assert.deepEqual(slideToward({ x: 0, z: 0 }, { x: 37.5, z: 12 }, () => true), { x: 37.5, z: 12 });
});

test('slideToward: 막히면 걸리는 지점에서 멈춘다(간격만큼 떨어진 자리)', () => {
  // 의자 50×50 을 벽 A 를 따라 오른쪽(x=300)에서 침대 쪽으로 민다. 침대 끝 200 + 간격 5 = 205 에서 멈춰야 한다.
  const allowed = (x, z) => placementAllowed(rect(x, z, 50, 50), 0, [bed], room, ON);
  const out = slideToward({ x: 300, z: 0 }, { x: 120, z: 0 }, allowed);
  assert.deepEqual(out, { x: 205, z: 0 });
  // 왼쪽 → 오른쪽으로 다가가는 경우도 같은 식으로 멈춘다.
  const wall = { rect: rect(300, 0, 100, 100), rot: 0 };
  const allowed2 = (x, z) => placementAllowed(rect(x, z, 50, 50), 0, [wall], room, { gap: 5, margin: null });
  assert.deepEqual(slideToward({ x: 100, z: 0 }, { x: 290, z: 0 }, allowed2), { x: 245, z: 0 });
});

test('slideToward: 막힌 방향은 멈추고 열린 방향으로는 미끄러진다', () => {
  // 침대 오른쪽(x=205)에 붙어 있는 의자를 왼쪽 아래(침대 쪽 + 방 안쪽)로 끈다.
  // x 는 침대에 막혀 못 가지만 z 는 내려갈 수 있다.
  const allowed = (x, z) => placementAllowed(rect(x, z, 50, 50), 0, [bed], room, { gap: 5, margin: null });
  const out = slideToward({ x: 205, z: 0 }, { x: 150, z: 40 }, allowed);
  assert.deepEqual(out, { x: 205, z: 40 });
});

test('slideToward: 앞 여유 공간 경계에서 멈춘다', () => {
  // 서랍장(벽 B 방향 45×80)을 방 아래쪽(z=210)에서 침대 쪽으로 올린다. 침대 깊이 100 + 여유 60 = 160 에서 멈춘다.
  const allowed = (x, z) => placementAllowed(rect(x, z, 45, 80), 1, [bed], room, ON);
  assert.deepEqual(slideToward({ x: 0, z: 210 }, { x: 0, z: 110 }, allowed), { x: 0, z: 160 });
  // 여유 공간 규칙을 끄면 간격 지점(105)까지 간다.
  const allowedNoMargin = (x, z) => placementAllowed(rect(x, z, 45, 80), 1, [bed], room, { gap: 5, margin: null });
  assert.deepEqual(slideToward({ x: 0, z: 210 }, { x: 0, z: 90 }, allowedNoMargin), { x: 0, z: 105 });
});

test('slideToward: 가구를 뚫고 건너편으로 넘어가지 않는다(목표 자리가 막혀 있을 때)', () => {
  // 침대 오른쪽의 의자를 침대 안쪽으로 끌면 침대 앞에서 멈춘다. 침대 너머 왼쪽 벽까지 가지 않는다.
  const allowed = (x, z) => placementAllowed(rect(x, z, 50, 50), 0, [bed], room, { gap: 5, margin: null });
  const out = slideToward({ x: 300, z: 0 }, { x: 60, z: 0 }, allowed);
  assert.equal(out.x, 205);
});
