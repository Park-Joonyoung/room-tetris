// 가구 바닥 사각형 관련 공용 함수.
// 좌표계: x = 방의 가로 방향, z = 방의 세로 방향. 방 바닥은 x ∈ [0, room.w], z ∈ [0, room.d].
//
// 가구는 네 벽 중 하나에 등을 붙이고 선다. 돌리지는 않는다: 가로(w)는 항상 벽을 따라 놓이고,
// 세로(d)는 벽에서 방 안쪽으로 뻗는다. item.rot 은 "어느 벽에 등을 대고 있는가"를 나타낸다.
//   rot 0: 벽 A (z = 0)        앞은 +z 쪽    x 축으로 w, z 축으로 d
//   rot 1: 벽 B (x = 0)        앞은 +x 쪽    x 축으로 d, z 축으로 w
//   rot 2: 벽 C (z = room.d)   앞은 -z 쪽    x 축으로 w, z 축으로 d
//   rot 3: 벽 D (x = room.w)   앞은 -x 쪽    x 축으로 d, z 축으로 w
// item.x, item.z 는 방향과 상관없이 바닥 사각형의 가장 작은 좌표 쪽 꼭짓점이다.

export const TOL = 0.01; // cm 단위 허용 오차
const WALL_SWITCH_MARGIN = 10; // 끌고 다닐 때 방향이 벽과 벽의 중간쯤에서 깜빡이지 않게 하는 여유(cm)

/** 가구가 등을 댄 벽 번호(0~3). 값이 이상하면 벽 A 로 본다. */
export function wallOf(item) {
  const r = Number(item.rot);
  return r === 1 || r === 2 || r === 3 ? r : 0;
}

export function footprint(item) {
  return wallOf(item) & 1 ? { sx: item.d, sz: item.w } : { sx: item.w, sz: item.d };
}

export function rectOf(item) {
  const { sx, sz } = footprint(item);
  return { x: item.x, z: item.z, sx, sz };
}

export function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.sx - TOL &&
    b.x < a.x + a.sx - TOL &&
    a.z < b.z + b.sz - TOL &&
    b.z < a.z + a.sz - TOL
  );
}

/** 가구가 해당 벽 방향으로 방 안에 들어가는지 */
export function fitsRoom(item, room, rot) {
  const { sx, sz } = footprint({ w: item.w, d: item.d, rot });
  return item.h <= room.h + TOL && sx <= room.w + TOL && sz <= room.d + TOL;
}

/**
 * 가구 중심이 (cx, cz)에 있을 때 어느 벽에 등을 대고 설지 정한다. 가장 가까운 벽을 따르되,
 * 그 방향으로 방에 안 들어가면 다음으로 가까운 벽을 쓴다. 어느 쪽도 안 되면 null.
 * @param {number|null} current 지금 방향. 주면 다른 벽이 확실히 더 가까울 때만 바꾼다.
 */
export function wallFor(item, room, cx, cz, current = null) {
  const dist = [cz, cx, room.d - cz, room.w - cx]; // 벽 A, B, C, D 까지의 거리
  const byDistance = [0, 1, 2, 3].sort((a, b) => dist[a] - dist[b]);
  let want = byDistance[0];
  if (current !== null && want !== current && dist[want] > dist[current] - WALL_SWITCH_MARGIN) want = current;
  for (const rot of [want, ...byDistance.filter((r) => r !== want)]) {
    if (fitsRoom(item, room, rot)) return rot;
  }
  return null;
}

export function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

// ───────────── 손으로 옮길 때의 규칙(간격·앞 여유 공간) ─────────────

/** 가구 앞(등을 댄 벽의 반대쪽) 여유 공간 사각형. */
export function frontZone(rect, rot, margin) {
  switch (rot) {
    case 1:
      return { x: rect.x + rect.sx, z: rect.z, sx: margin, sz: rect.sz };
    case 2:
      return { x: rect.x, z: rect.z - margin, sx: rect.sx, sz: margin };
    case 3:
      return { x: rect.x - margin, z: rect.z, sx: margin, sz: rect.sz };
    default:
      return { x: rect.x, z: rect.z + rect.sz, sx: rect.sx, sz: margin };
  }
}

/**
 * 가구를 이 자리(rect, rot)에 둬도 규칙에 맞는지 검사한다.
 * @param {{x:number,z:number,sx:number,sz:number}} rect
 * @param {0|1|2|3} rot
 * @param {{rect:{x:number,z:number,sx:number,sz:number}, rot:0|1|2|3, clear?:boolean}[]} others 방에 놓여 있는 다른 가구들
 * @param {{w:number,d:number}} room
 * @param {{gap:number|null, margin:number|null}} rules null 이면 그 규칙은 꺼진 것
 * @param {boolean} [clear] false 면 이 가구는 앞 여유 공간이 필요 없다(침대, 문 등)
 */
export function placementAllowed(rect, rot, others, room, rules, clear = true) {
  const gap = rules.gap;
  const margin = rules.margin != null && rules.margin > 0 ? rules.margin : null;
  const myZone = margin !== null && clear !== false ? frontZone(rect, rot, margin) : null;

  if (myZone) {
    // 가구 앞 공간이 방 밖으로 나가면 안 된다.
    // (이 방향으로는 여유를 둘 수 없을 만큼 깊은 가구는 어디에도 못 놓게 되므로 이 검사에서 뺀다.)
    const depth = rot & 1 ? rect.sx : rect.sz;
    if (depth + margin <= (rot & 1 ? room.w : room.d) + TOL) {
      if (myZone.x < -TOL || myZone.z < -TOL || myZone.x + myZone.sx > room.w + TOL || myZone.z + myZone.sz > room.d + TOL) return false;
    }
  }

  for (const o of others) {
    const dx = Math.max(o.rect.x - (rect.x + rect.sx), rect.x - (o.rect.x + o.rect.sx));
    const dz = Math.max(o.rect.z - (rect.z + rect.sz), rect.z - (o.rect.z + o.rect.sz));
    if (gap != null) {
      // 가로나 세로 어느 한 방향으로는 간격만큼 떨어져 있어야 한다.
      if (dx < gap - TOL && dz < gap - TOL) return false;
    } else if (dx < -TOL && dz < -TOL) {
      // 간격을 껐으면 겹쳐 놓을 수 있다. 겹친 가구는 인벤토리로 가므로 더 따질 것이 없다.
      continue;
    }
    if (margin !== null) {
      // 서로의 앞 공간을 몸체로 막으면 안 된다(앞 공간이 필요 없는 가구는 막혀도 된다).
      if (myZone && rectsOverlap(myZone, o.rect)) return false;
      if (o.clear !== false && rectsOverlap(frontZone(o.rect, o.rot, margin), rect)) return false;
    }
  }
  return true;
}

/** start 에서 end 쪽으로 한 축을 따라가다 막히는 지점 직전(0.1cm 단위)까지 간다. */
function advance(start, end, ok) {
  const dist = Math.abs(end - start);
  if (dist < 1e-9) return start;
  const dir = Math.sign(end - start);
  const steps = Math.min(800, Math.ceil(dist)); // 약 1cm 씩 나아가서 가구를 뚫고 지나가지 않게 한다
  let good = start;
  for (let i = 1; i <= steps; i++) {
    const v = i === steps ? end : start + (dir * dist * i) / steps;
    if (ok(v)) {
      good = v;
      continue;
    }
    // 막힌 지점을 이분법으로 좁힌 뒤, 출발 쪽으로 0.1cm 단위에 맞춘다.
    let lo = good;
    let hi = v;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
    const snapped = dir > 0 ? Math.floor(lo * 10 + 1e-6) / 10 : Math.ceil(lo * 10 - 1e-6) / 10;
    const between = dir > 0 ? snapped >= good - 1e-9 : snapped <= good + 1e-9;
    return between && ok(snapped) ? snapped : good;
  }
  return good;
}

/**
 * from 에 있는 가구를 to 로 옮기려 할 때 실제로 가게 되는 위치.
 * to 가 허용되는 자리면 그대로 가고, 아니면 from 에서 to 쪽으로 걸릴 때까지만 간다.
 * 한 축씩 움직이므로 막힌 방향은 멈추고 열린 방향으로는 계속 미끄러진다.
 * @param {(x:number, z:number) => boolean} allowed
 */
export function slideToward(from, to, allowed) {
  if (allowed(to.x, to.z)) return { x: to.x, z: to.z };
  const run = (xFirst) => {
    let { x, z } = from;
    if (xFirst) {
      x = advance(x, to.x, (v) => allowed(v, z));
      z = advance(z, to.z, (v) => allowed(x, v));
    } else {
      z = advance(z, to.z, (v) => allowed(x, v));
      x = advance(x, to.x, (v) => allowed(v, z));
    }
    return { x, z };
  };
  const a = run(true);
  const b = run(false);
  const left = (p) => Math.hypot(p.x - to.x, p.z - to.z);
  return left(a) <= left(b) ? a : b;
}
