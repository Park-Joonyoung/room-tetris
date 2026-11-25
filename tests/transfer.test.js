import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TransferError,
  buildExport,
  parseImport,
  planMerge,
  toFileText,
  fromFileText,
  encodePayload,
  decodePayload,
  makeLink,
  extractPayload,
} from '../js/transfer.js';

const furniture = (id, name, updatedAt = 0, extra = {}) => ({ id, name, w: 100, d: 50, h: 80, color: '#3b82f6', updatedAt, ...extra });
const layout = (id, name, updatedAt = 1000, items = []) => ({
  id,
  name,
  room: { w: 400, d: 300, h: 240 },
  items,
  createdAt: 1000,
  updatedAt,
});
const placed = (id, name) => ({ id, fid: 'f1', name, w: 100, d: 50, h: 80, color: '#3b82f6', placed: true, x: 0, z: 0, rot: 0 });

const sampleDb = () => ({
  furniture: [furniture('f1', '침대', 10), furniture('f2', '옷장', 20)],
  layouts: [layout('l1', '침실', 1000, [placed('i1', '침대')])],
  settings: { gap: 5, theme: 'dark' },
});

test('내보낸 데이터에는 설정이 들어가지 않는다', () => {
  const data = buildExport(sampleDb());
  assert.equal(data.app, 'room-tetris');
  assert.equal(data.version, 1);
  assert.equal(data.settings, undefined);
  assert.equal(data.furniture.length, 2);
  assert.equal(data.layouts.length, 1);
});

test('파일로 내보냈다가 다시 읽으면 같은 내용', () => {
  const db = sampleDb();
  const back = fromFileText(toFileText(buildExport(db)));
  assert.deepEqual(back.furniture, db.furniture);
  assert.deepEqual(back.layouts, db.layouts);
});

test('링크로 내보냈다가 다시 읽으면 같은 내용(한글 포함)', async () => {
  const db = sampleDb();
  const payload = await encodePayload(buildExport(db));
  assert.match(payload, /^[zp]\.[A-Za-z0-9_-]+$/);
  const link = makeLink('https://example.com/room-tetris/#/settings', payload);
  assert.ok(link.startsWith('https://example.com/room-tetris/#import='));
  const back = await decodePayload(extractPayload(link));
  assert.deepEqual(back.furniture, db.furniture);
  assert.deepEqual(back.layouts, db.layouts);
});

test('링크는 압축되어 원본 JSON 보다 짧다', async () => {
  const db = sampleDb();
  for (let i = 0; i < 30; i++) db.furniture.push(furniture(`x${i}`, `가구 ${i}`, i));
  const payload = await encodePayload(buildExport(db));
  assert.ok(payload.startsWith('z.'));
  assert.ok(payload.length < JSON.stringify(buildExport(db)).length / 2);
});

test('압축하지 않은 형식(p.)도 읽는다', async () => {
  const json = JSON.stringify(buildExport(sampleDb()));
  const b64 = Buffer.from(json, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const back = await decodePayload('p.' + b64);
  assert.equal(back.furniture[0].name, '침대');
});

test('extractPayload: 링크 전체, # 뒷부분, 코드만 모두 인식', () => {
  assert.equal(extractPayload('https://a.b/c/#import=z.AbC-_1'), 'z.AbC-_1');
  assert.equal(extractPayload('  #import=p.xyz  '), 'p.xyz');
  assert.equal(extractPayload('z.AbC'), 'z.AbC');
  assert.equal(extractPayload('여기 링크 https://a.b/#import=z.AbC 확인해'), 'z.AbC');
  assert.equal(extractPayload('https://a.b/#/layouts'), null);
  assert.equal(extractPayload(''), null);
});

test('잘린 링크와 엉뚱한 내용은 거절한다', async () => {
  const payload = await encodePayload(buildExport(sampleDb()));
  await assert.rejects(decodePayload(payload.slice(0, Math.floor(payload.length / 2))), TransferError);
  await assert.rejects(decodePayload('z.!!!!'), TransferError);
  await assert.rejects(decodePayload('q.abcd'), TransferError);
  await assert.rejects(decodePayload('p.' + Buffer.from('not json').toString('base64url')), TransferError);
});

test('다른 앱의 파일이나 깨진 파일은 거절한다', () => {
  assert.throws(() => fromFileText('{ not json'), TransferError);
  assert.throws(() => fromFileText('[]'), TransferError);
  assert.throws(() => fromFileText(JSON.stringify({ app: 'other', version: 1, furniture: [], layouts: [] })), TransferError);
  assert.throws(() => fromFileText(JSON.stringify({ app: 'room-tetris', version: 99, furniture: [], layouts: [] })), TransferError);
  assert.throws(() => fromFileText(JSON.stringify({ app: 'room-tetris', version: 1, furniture: {}, layouts: [] })), TransferError);
});

test('값이 이상한 항목이 하나라도 있으면 전체를 거절한다', () => {
  const base = () => buildExport(sampleDb());
  const bad = [
    (d) => (d.furniture[0].w = -1),
    (d) => (d.furniture[0].w = '100'),
    (d) => (d.furniture[0].h = Infinity),
    (d) => (d.furniture[0].name = '   '),
    (d) => (d.furniture[0].id = 5),
    (d) => (d.layouts[0].room.d = 0),
    (d) => (d.layouts[0].room = null),
    (d) => (d.layouts[0].items = 'x'),
    (d) => (d.layouts[0].items[0].d = 99999),
    (d) => (d.furniture[1] = null),
  ];
  for (const [i, mutate] of bad.entries()) {
    const d = structuredClone(base());
    mutate(d);
    assert.throws(() => parseImport(d), TransferError, `case ${i}`);
  }
});

test('검사하면서 값을 안전하게 정리한다', () => {
  const d = structuredClone(buildExport(sampleDb()));
  d.furniture[0].color = 'javascript:alert(1)';
  d.furniture[0].name = '  ' + 'ㄱ'.repeat(100);
  d.furniture[0].extra = '<script>';
  d.layouts[0].items[0].x = -50;
  d.layouts[0].items[0].z = 'abc';
  d.layouts[0].items[0].rot = 7;
  d.layouts[0].items[0].placed = 'yes';
  d.furniture.push({ ...d.furniture[1] }); // 중복 id
  const out = parseImport(d);
  assert.equal(out.furniture[0].color, '#888888');
  assert.equal(out.furniture[0].name.length, 30);
  assert.equal(out.furniture[0].extra, undefined);
  assert.equal(out.furniture.length, 2);
  const it = out.layouts[0].items[0];
  assert.deepEqual([it.x, it.z, it.rot, it.placed], [0, 0, 1, false]);
});

test('합치기: 없는 것은 추가, 같은 id 는 더 최근 것이 남는다', () => {
  const db = sampleDb();
  const incoming = parseImport({
    app: 'room-tetris',
    version: 1,
    furniture: [
      furniture('f1', '큰 침대', 99), // 더 최신 → 바꿈
      furniture('f2', '옛날 옷장', 5), // 더 오래됨 → 그대로
      furniture('f3', '책상', 1), // 새 것 → 추가
    ],
    layouts: [layout('l1', '침실(구버전)', 500), layout('l2', '서재', 2000)],
  });
  const plan = planMerge(db, incoming);
  assert.deepEqual(plan.summary.furniture, { added: 1, updated: 1, unchanged: 1 });
  assert.deepEqual(plan.summary.layouts, { added: 1, updated: 0, unchanged: 1 });
  assert.equal(plan.summary.changes, 3);
  assert.deepEqual(plan.furniture.map((f) => f.name), ['큰 침대', '옷장', '책상']);
  assert.deepEqual(plan.layouts.map((l) => l.name), ['서재', '침실']);
  // 계획만 세울 뿐 원본은 건드리지 않는다
  assert.deepEqual(db.furniture.map((f) => f.name), ['침대', '옷장']);
  assert.equal(db.layouts.length, 1);
});

test('합치기: 이 기기에만 있는 항목은 지워지지 않는다', () => {
  const db = sampleDb();
  const plan = planMerge(db, parseImport({ app: 'room-tetris', version: 1, furniture: [furniture('f9', '의자', 1)], layouts: [] }));
  assert.deepEqual(plan.furniture.map((f) => f.id), ['f1', 'f2', 'f9']);
  assert.equal(plan.layouts.length, 1);
});

test('합치기: 같은 데이터를 다시 가져오면 바뀌는 것이 없다', () => {
  const db = sampleDb();
  const plan = planMerge(db, fromFileText(toFileText(buildExport(db))));
  assert.equal(plan.summary.changes, 0);
  assert.deepEqual(plan.furniture, db.furniture);
  assert.deepEqual(plan.layouts, db.layouts);
});

test('수정 시각이 없는 옛 가구는 0 으로 취급한다', () => {
  const db = { furniture: [{ id: 'f1', name: '침대', w: 100, d: 50, h: 80, color: '#3b82f6' }], layouts: [] };
  const same = planMerge(db, parseImport({ app: 'room-tetris', version: 1, furniture: [{ ...db.furniture[0], name: '다른 이름' }], layouts: [] }));
  assert.equal(same.summary.changes, 0); // 둘 다 시각이 없으면 이 기기 것을 유지
  const newer = planMerge(db, parseImport({ app: 'room-tetris', version: 1, furniture: [{ ...db.furniture[0], name: '새 이름', updatedAt: 5 }], layouts: [] }));
  assert.equal(newer.furniture[0].name, '새 이름');
});
