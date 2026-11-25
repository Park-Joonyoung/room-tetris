// 가구 바닥 사각형 관련 공용 함수.
// 좌표계: x = 방의 가로 방향, z = 방의 세로 방향, 두 벽은 z=0(벽 A)과 x=0(벽 B).
// item.rot === 0 이면 가로(w)가 x축, 세로(d)가 z축을 따라 놓인다. rot === 1 이면 90도 회전.

export const TOL = 0.01; // cm 단위 허용 오차

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

/**
 * 가구가 방 안에 들어갈 수 있는 회전 상태를 찾는다.
 * 현재 회전을 우선하고, 안 되면 90도 돌린 상태를 시도한다. 둘 다 안 되면 null.
 */
export function fittingRot(item, room, preferred = item.rot || 0) {
  if (item.h > room.h + TOL) return null;
  for (const rot of [preferred, preferred ? 0 : 1]) {
    const { sx, sz } = footprint({ ...item, rot });
    if (sx <= room.w + TOL && sz <= room.d + TOL) return rot;
  }
  return null;
}

export function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}
