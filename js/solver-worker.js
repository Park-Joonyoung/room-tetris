// 자동 배치 계산을 화면과 분리된 스레드에서 돌린다.
// 계산이 오래 걸려도 화면이 멈추지 않고, 취소나 뒤로가기가 바로 동작한다.

import { solve, seededRandom } from './solver.js';

self.onmessage = (e) => {
  const { room, items, gap, margin, timeLimitMs, seed } = e.data;
  const result = solve(room, items, gap, {
    margin,
    timeLimitMs,
    random: seed == null ? null : seededRandom(seed),
    onProgress: (partial) => self.postMessage({ type: 'progress', result: partial }),
  });
  self.postMessage({ type: 'done', result });
};
