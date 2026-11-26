// 가구 바닥 사각형 관련 공용 함수.
// 좌표계: x = 방의 가로 방향, z = 방의 세로 방향, 두 벽은 z=0(벽 A)과 x=0(벽 B).
//
// 가구는 돌리지 않는다. 가로(w)는 항상 벽을 따라 놓이고 세로(d)는 벽에서 방 안쪽으로 뻗는다.
// item.rot 은 "어느 벽을 따라 놓였는가"만 나타낸다.
//   rot === 0: 벽 A(z=0)를 따라 → x축으로 w, z축으로 d
//   rot === 1: 벽 B(x=0)를 따라 → x축으로 d, z축으로 w

export const TOL = 0.01; // cm 단위 허용 오차
const WALL_SWITCH_MARGIN = 10; // 끌고 다닐 때 방향이 대각선 근처에서 깜빡이지 않게 하는 여유(cm)

export function footprint(item) {
  return item.rot ? { sx: item.d, sz: item.w } : { sx: item.w, sz: item.d };
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
 * 가구 중심이 (cx, cz)에 있을 때 어느 벽을 따라 놓을지 정한다. 더 가까운 벽을 따르되,
 * 그 방향으로 방에 안 들어가면 다른 벽 방향을 쓴다. 어느 쪽도 안 되면 null.
 * @param {number|null} current 지금 방향. 주면 반대편 벽이 확실히 더 가까울 때만 바꾼다.
 */
export function wallFor(item, room, cx, cz, current = null) {
  let want;
  if (current === null) want = cz <= cx ? 0 : 1;
  else if (current === 0) want = cx < cz - WALL_SWITCH_MARGIN ? 1 : 0;
  else want = cz < cx - WALL_SWITCH_MARGIN ? 0 : 1;
  if (fitsRoom(item, room, want)) return want;
  if (fitsRoom(item, room, 1 - want)) return 1 - want;
  return null;
}

export function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

// ───────────── 손으로 옮길 때의 규칙(간격·앞 여유 공간) ─────────────

/** 가구 앞(벽 반대쪽) 여유 공간 사각형. 벽 A 방향(rot 0)이면 +z 쪽, 벽 B 방향(rot 1)이면 +x 쪽. */
export function frontZone(rect, rot, margin) {
  return rot
    ? { x: rect.x + rect.sx, z: rect.z, sx: margin, sz: rect.sz }
    : { x: rect.x, z: rect.z + rect.sz, sx: rect.sx, sz: margin };
}

/**
 * 가구를 이 자리(rect, rot)에 둬도 규칙에 맞는지 검사한다.
 * @param {{x:number,z:number,sx:number,sz:number}} rect
 * @param {0|1} rot
 * @param {{rect:{x:number,z:number,sx:number,sz:number}, rot:0|1}[]} others 방에 놓여 있는 다른 가구들
 * @param {{w:number,d:number}} room
 * @param {{gap:number|null, margin:number|null}} rules null 이면 그 규칙은 꺼진 것
 */
export function placementAllowed(rect, rot, others, room, rules) {
  const gap = rules.gap;
  const margin = rules.margin != null && rules.margin > 0 ? rules.margin : null;

  if (margin !== null) {
    // 가구 앞 공간이 방 밖으로 나가면 안 된다.
    // (이 방향으로는 여유를 둘 수 없을 만큼 깊은 가구는 어디에도 못 놓게 되므로 이 검사에서 뺀다.)
    const depth = rot ? rect.sx : rect.sz;
    if (depth + margin <= (rot ? room.w : room.d) + TOL) {
      const zone = frontZone(rect, rot, margin);
      if (zone.x + zone.sx > room.w + TOL || zone.z + zone.sz > room.d + TOL) return false;
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
      // 서로의 앞 공간을 몸체로 막으면 안 된다.
      if (rectsOverlap(frontZone(rect, rot, margin), o.rect)) return false;
      if (rectsOverlap(frontZone(o.rect, o.rot, margin), rect)) return false;
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
