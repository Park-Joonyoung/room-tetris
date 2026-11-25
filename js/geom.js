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
