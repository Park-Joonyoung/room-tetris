// CI 실행 확인용: 예시 가구와 배치도가 담긴 가져오기 링크를 만들어 출력한다.
//   사용: node android/ci-demo-link.mjs <앱 주소>
import { buildExport, encodePayload, makeLink } from '../js/transfer.js';
import { solve } from '../js/solver.js';

const base = process.argv[2];
const colors = ['#e5484d', '#3b82f6', '#22a55b', '#f59e0b', '#8b5cf6', '#14b8a6'];
const furniture = [
  ['침대', 200, 100, 45],
  ['옷장', 120, 60, 200],
  ['책상', 120, 60, 75],
  ['책장', 80, 30, 180],
  ['서랍장', 80, 45, 90],
  ['협탁', 45, 40, 50],
].map(([name, w, d, h], i) => ({ id: `demo-f${i}`, name, w, d, h, color: colors[i], updatedAt: 1 }));

const room = { w: 520, d: 420, h: 240 };
const rules = { gap: 5, margin: 60 };
const result = solve(room, furniture, rules.gap, { margin: rules.margin, timeLimitMs: 3000 });
const placed = new Map(result.placements.map((p) => [p.id, p]));
const items = furniture.map((f, i) => {
  const p = placed.get(f.id);
  return { id: `demo-i${i}`, fid: f.id, name: f.name, w: f.w, d: f.d, h: f.h, color: f.color, placed: !!p, x: p?.x ?? 0, z: p?.z ?? 0, rot: p?.rot ?? 0 };
});
const layout = { id: 'demo', name: '예시 침실', room, ...rules, items, createdAt: 1, updatedAt: 1 };

process.stdout.write(makeLink(base, await encodePayload(buildExport({ furniture, layouts: [layout] }))));
