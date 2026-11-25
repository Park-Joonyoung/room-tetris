// 배치도 3D 화면. Three.js 로 방(바닥 + 인접한 두 벽)과 가구(직육면체)를 그리고,
// 시점 회전 / 확대·축소 / 가구 드래그 / 탭해서 이름 보기를 처리한다.
// 데이터는 직접 바꾸지 않고 콜백(onMove, onStash)으로 알려 준다.

import * as THREE from 'three';
import { footprint, rectOf, rectsOverlap, wallFor, clamp } from './geom.js';

const DEG = Math.PI / 180;
const DEFAULT_ELEVATION = 30 * DEG; // 맞은편 모서리의 살짝 위에서 내려다보는 각도
const MIN_ELEVATION = 4 * DEG;
const MAX_ELEVATION = 89 * DEG;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const SNAP_CM = 7; // 벽이나 다른 가구 근처에서 달라붙는 거리
const UP = new THREE.Vector3(0, 1, 0);

export class RoomView {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   getGap?: () => number,
   *   getMargin?: () => number,
   *   isReadOnly?: () => boolean,      // true 면 가구를 옮길 수 없다(보기만 가능)
   *   onBlockedEdit?: () => void,      // 읽기 전용인데 가구를 끌려고 했을 때
   *   onMove?: (id: string, x: number, z: number, rot: number, displaced: string[]) => void,
   *   onStash?: (id: string) => void,
   *   isOverInventory?: (clientX: number, clientY: number) => boolean,
   *   onInventoryHover?: (over: boolean) => void,
   *   onPlainWheel?: () => void,
   *   onInteract?: () => void,
   * }} cb
   */
  constructor(container, cb = {}) {
    this.container = container;
    this.cb = cb;
    this.room = { w: 300, d: 300, h: 240 };
    this.items = [];
    this.groups = new Map(); // 가구 id → THREE.Group
    this.pickables = [];
    this.selectedId = null;
    this.marked = new Set();

    this.az = 0;
    this.el = DEFAULT_ELEVATION;
    this.zoom = 1;
    this.baseDist = 1000;
    this.pan = new THREE.Vector3();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'ed-canvas';
    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 100000);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(0.35, 1, 0.7);
    this.scene.add(sun);

    this.roomGroup = new THREE.Group();
    this.itemGroup = new THREE.Group();
    this.scene.add(this.roomGroup, this.itemGroup);

    this.raycaster = new THREE.Raycaster();
    this.floorPlane = new THREE.Plane(UP, 0);
    this.dragPlane = new THREE.Plane(UP, 0);

    // 탭한 가구 위에 뜨는 이름표
    this.tag = document.createElement('div');
    this.tag.className = 'tag';
    this.tag.hidden = true;
    container.appendChild(this.tag);

    // 방의 가로/세로 치수 표시
    this.dimW = this.makeDimLabel();
    this.dimD = this.makeDimLabel();

    this.pointers = new Map();
    this.gesture = null;
    this.pinch = null;
    this.ext = null;
    this.raf = 0;
    this.disposed = false;

    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.applyTheme();
    this.resize();
  }

  makeDimLabel() {
    const el = document.createElement('div');
    el.className = 'dim-label';
    this.container.appendChild(el);
    return el;
  }

  // ───────────────────────── 데이터 반영 ─────────────────────────

  setRoom(room) {
    this.room = { ...room };
    this.dimW.textContent = `가로 ${num(room.w)}`;
    this.dimD.textContent = `세로 ${num(room.d)}`;
    this.buildRoom();
    this.resetView();
  }

  setItems(items) {
    this.items = items;
    if (this.selectedId && !items.some((it) => it.id === this.selectedId && it.placed)) {
      this.selectedId = null;
    }
    this.buildItems();
    this.renderTag();
    this.invalidate();
  }

  applyTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    this.colors = {
      bg: v('--scene-bg', '#eef0f4'),
      floor: v('--scene-floor', '#e4ddd0'),
      wallA: v('--scene-wall-a', '#f8f6f1'),
      wallB: v('--scene-wall-b', '#ece8df'),
      grid: v('--scene-grid', '#cfc6b6'),
      line: v('--scene-line', '#a59c8c'),
      select: v('--scene-select', '#111827'),
      danger: v('--danger', '#dc2626'),
    };
    this.scene.background = new THREE.Color(this.colors.bg);
    this.buildRoom();
    this.buildItems();
    this.invalidate();
  }

  // ───────────────────────── 장면 만들기 ─────────────────────────

  buildRoom() {
    disposeChildren(this.roomGroup);
    const { w, d, h } = this.room;
    const c = this.colors;
    // 방 면은 뒤에서 보면 투명(단면)이라, 시점을 돌려도 가구를 가리지 않는다.
    const surface = (color) =>
      new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), surface(c.floor));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(w / 2, 0, d / 2);

    const wallA = new THREE.Mesh(new THREE.PlaneGeometry(w, h), surface(c.wallA)); // z = 0
    wallA.position.set(w / 2, h / 2, 0);

    const wallB = new THREE.Mesh(new THREE.PlaneGeometry(d, h), surface(c.wallB)); // x = 0
    wallB.rotation.y = Math.PI / 2;
    wallB.position.set(0, h / 2, d / 2);

    // 바닥 격자: 50cm 간격(큰 방은 100cm)
    const step = Math.max(w, d) > 1200 ? 100 : 50;
    const pts = [];
    for (let x = step; x < w - 0.01; x += step) pts.push(x, 0, 0, x, 0, d);
    for (let z = step; z < d - 0.01; z += step) pts.push(0, 0, z, w, 0, z);
    const grid = lines(pts, c.grid, 0.7);

    const outline = lines(
      [
        // 바닥 테두리
        0, 0, 0, w, 0, 0, w, 0, 0, w, 0, d, w, 0, d, 0, 0, d, 0, 0, d, 0, 0, 0,
        // 벽 A 테두리
        0, 0, 0, 0, h, 0, 0, h, 0, w, h, 0, w, h, 0, w, 0, 0,
        // 벽 B 테두리
        0, h, 0, 0, h, d, 0, h, d, 0, 0, d,
      ],
      c.line,
      1,
    );

    this.roomGroup.add(floor, wallA, wallB, grid, outline);
    this.invalidate();
  }

  makeItemGroup(item, ghost = false) {
    const { sx, sz } = footprint(item);
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(sx, item.h, sz);
    const color = new THREE.Color(safeColor(item.color));
    const mat = new THREE.MeshLambertMaterial({ color, transparent: ghost, opacity: ghost ? 0.75 : 1 });
    const box = new THREE.Mesh(geo, mat);
    box.position.y = item.h / 2;
    box.userData.itemId = item.id;
    const edgeMat = new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.5) });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    edges.position.y = item.h / 2;
    group.add(box, edges);

    // 가구 앞(벽 반대쪽) 여유 공간을 바닥에 옅게 표시한다. 벽 A 방향이면 +z, 벽 B 방향이면 +x 가 앞.
    const margin = Math.max(0, this.cb.getMargin?.() ?? 0);
    let zone = null;
    if (margin > 0) {
      const zoneMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false });
      zone = new THREE.Mesh(new THREE.PlaneGeometry(item.rot ? margin : sx, item.rot ? sz : margin), zoneMat);
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(item.rot ? sx / 2 + margin / 2 : 0, 0.6, item.rot ? 0 : sz / 2 + margin / 2);
      zone.visible = ghost;
      group.add(zone);
    }

    group.position.set(item.x + sx / 2, 0, item.z + sz / 2);
    group.userData = { box, edges, zone, baseEdge: edgeMat.color.clone(), h: item.h };
    return group;
  }

  buildItems() {
    disposeChildren(this.itemGroup);
    this.groups.clear();
    this.pickables = [];
    this.marked.clear();
    for (const item of this.items) {
      if (!item.placed) continue;
      const group = this.makeItemGroup(item);
      this.itemGroup.add(group);
      this.groups.set(item.id, group);
      this.pickables.push(group.userData.box);
    }
    this.styleItems();
  }

  /** 선택된 가구는 테두리를 진하게, 밀려날 가구는 반투명 + 빨간 테두리로 표시한다. */
  styleItems() {
    for (const [id, group] of this.groups) {
      const { box, edges, zone, baseEdge } = group.userData;
      const displaced = this.marked.has(id);
      if (zone) zone.visible = id === this.selectedId; // 고른 가구의 앞 여유 공간만 보여 준다
      box.material.transparent = displaced;
      box.material.opacity = displaced ? 0.3 : 1;
      box.material.needsUpdate = true;
      if (displaced) edges.material.color.set(this.colors.danger);
      else if (id === this.selectedId) edges.material.color.set(this.colors.select);
      else edges.material.color.copy(baseEdge);
    }
  }

  markDisplaced(ids) {
    if (ids.length === this.marked.size && ids.every((id) => this.marked.has(id))) return;
    this.marked = new Set(ids);
    this.styleItems();
  }

  // ───────────────────────── 카메라 ─────────────────────────

  /** 기본 시점: 가구를 놓는 두 벽이 만나는 모서리의 맞은편 모서리, 살짝 위. */
  resetView() {
    const { w, d } = this.room;
    this.az = Math.atan2(w, d);
    this.el = DEFAULT_ELEVATION;
    this.zoom = 1;
    this.pan.set(0, 0, 0);
    this.fit();
    this.invalidate();
  }

  center() {
    const { w, d, h } = this.room;
    return new THREE.Vector3(w / 2, h * 0.42, d / 2);
  }

  placeCamera(az, el, dist, target) {
    const ce = Math.cos(el);
    this.camera.position.set(
      target.x + dist * ce * Math.sin(az),
      target.y + dist * Math.sin(el),
      target.z + dist * ce * Math.cos(az),
    );
    this.camera.near = Math.max(1, dist / 100);
    this.camera.far = dist * 6 + 5000;
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  updateCamera() {
    this.placeCamera(this.az, this.el, this.baseDist / this.zoom, this.center().add(this.pan));
  }

  /** 기본 시점에서 방 전체가 화면에 들어오는 거리를 이분 탐색으로 구한다. */
  fit() {
    const { w, d, h } = this.room;
    const corners = [];
    for (const x of [0, w]) for (const y of [0, h]) for (const z of [0, d]) corners.push(new THREE.Vector3(x, y, z));
    const target = this.center();
    const az = Math.atan2(w, d);
    const margin = 0.86;
    const v = new THREE.Vector3();
    const fits = (dist) => {
      this.placeCamera(az, DEFAULT_ELEVATION, dist, target);
      for (const c of corners) {
        v.copy(c).applyMatrix4(this.camera.matrixWorldInverse);
        if (v.z > -this.camera.near) return false;
        v.copy(c).project(this.camera);
        if (Math.abs(v.x) > margin || Math.abs(v.y) > margin) return false;
      }
      return true;
    };
    let lo = 1;
    let hi = Math.hypot(w, d, h) * 40 + 100;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    this.baseDist = hi;
  }

  /**
   * 확대·축소. 화면 좌표(clientX, clientY)를 주면 그 지점이 제자리에 머물도록 함께 이동한다
   * (커서나 두 손가락 사이를 중심으로 확대).
   */
  zoomBy(factor, clientX, clientY) {
    const prev = this.zoom;
    this.zoom = clamp(prev * factor, MIN_ZOOM, MAX_ZOOM);
    const applied = this.zoom / prev;
    if (clientX != null && applied !== 1) {
      const r = this.canvas.getBoundingClientRect();
      const ox = clientX - (r.left + r.width / 2);
      const oy = clientY - (r.top + r.height / 2);
      this.panByPixels(-(applied - 1) * ox, -(applied - 1) * oy);
    }
    if (this.zoom <= 1) this.pan.multiplyScalar(this.zoom < 1 ? 0 : 0.5); // 축소하면 방이 다시 가운데로
    this.invalidate();
  }

  panByPixels(dx, dy) {
    const dist = this.baseDist / this.zoom;
    const perPx = (2 * dist * Math.tan((this.camera.fov * DEG) / 2)) / Math.max(1, this.canvas.clientHeight);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.pan.addScaledVector(right, -dx * perPx).addScaledVector(up, dy * perPx);
    const { w, d, h } = this.room;
    this.pan.x = clamp(this.pan.x, -w / 2, w / 2);
    this.pan.y = clamp(this.pan.y, -h / 2, h / 2);
    this.pan.z = clamp(this.pan.z, -d / 2, d / 2);
    this.invalidate();
  }

  resize() {
    if (this.disposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.fit();
    this.render();
  }

  invalidate() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => this.render());
  }

  render() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.disposed) return;
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    this.positionOverlays();
  }

  // ───────────────────────── 화면 위 라벨 ─────────────────────────

  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z);
    const behind = v.clone().applyMatrix4(this.camera.matrixWorldInverse).z > 0;
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight,
      visible: !behind,
    };
  }

  positionOverlays() {
    const { w, d } = this.room;
    place(this.dimW, this.toScreen(w / 2, 0, d), 'translate(-50%, 6px)');
    place(this.dimD, this.toScreen(w, 0, d / 2), 'translate(-50%, 6px)');

    if (!this.tag.hidden) {
      const group = this.groups.get(this.selectedId);
      if (group) {
        const p = this.toScreen(group.position.x, group.userData.h, group.position.z);
        // 화면 가장자리에서 이름표가 잘리지 않도록 안쪽으로 당긴다.
        const half = this.tag.offsetWidth / 2 + 6;
        p.x = clamp(p.x, half, Math.max(half, this.canvas.clientWidth - half));
        p.y = Math.max(p.y, this.tag.offsetHeight + 14);
        place(this.tag, p, 'translate(-50%, -100%) translateY(-10px)');
      }
    }
  }

  select(id) {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.styleItems();
    this.renderTag();
    this.invalidate();
  }

  renderTag() {
    const item = this.items.find((it) => it.id === this.selectedId && it.placed);
    this.tag.replaceChildren();
    if (!item) {
      this.tag.hidden = true;
      return;
    }
    const dot = document.createElement('i');
    dot.style.background = safeColor(item.color);
    const name = document.createElement('b');
    name.append(dot, item.name);
    const dims = document.createElement('span');
    dims.textContent = `${num(item.w)} × ${num(item.d)} × ${num(item.h)} cm`;
    const actions = document.createElement('div');
    actions.className = 'tag-actions';
    this.tag.append(name, dims);
    if (!this.cb.isReadOnly?.()) {
      actions.append(tagButton('인벤토리로', () => this.cb.onStash?.(item.id)));
      this.tag.append(actions);
    }
    this.tag.hidden = false;
  }

  // ───────────────────────── 광선·배치 계산 ─────────────────────────

  setRay(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  pick(clientX, clientY) {
    this.setRay(clientX, clientY);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    return hit ? { id: hit.object.userData.itemId, point: hit.point } : null;
  }

  rayToPlane(clientX, clientY, plane) {
    this.setRay(clientX, clientY);
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  /** 방 안으로 가두고, 벽이나 다른 가구(간격 포함) 근처면 달라붙게 한다. */
  snapPosition(selfId, x, z, sx, sz) {
    const { w, d } = this.room;
    const gap = Math.max(0, this.cb.getGap?.() ?? 0);
    const maxX = Math.max(0, w - sx);
    const maxZ = Math.max(0, d - sz);
    x = clamp(x, 0, maxX);
    z = clamp(z, 0, maxZ);
    const xs = [0, maxX];
    const zs = [0, maxZ];
    for (const other of this.items) {
      if (!other.placed || other.id === selfId) continue;
      const r = rectOf(other);
      if (z < r.z + r.sz + gap && r.z < z + sz + gap) xs.push(r.x + r.sx + gap, r.x - sx - gap);
      if (x < r.x + r.sx + gap && r.x < x + sx + gap) zs.push(r.z + r.sz + gap, r.z - sz - gap);
    }
    const snap = (v, cands, max) => {
      let bestV = null;
      let bestD = SNAP_CM;
      for (const c of cands) {
        if (c < -0.001 || c > max + 0.001) continue;
        const dist = Math.abs(c - v);
        if (dist < bestD) {
          bestD = dist;
          bestV = c;
        }
      }
      return bestV === null ? Math.round(v) : bestV;
    };
    x = clamp(snap(x, xs, maxX), 0, maxX);
    z = clamp(snap(z, zs, maxZ), 0, maxZ);
    return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  }

  overlapping(selfId, x, z, sx, sz) {
    const rect = { x, z, sx, sz };
    return this.items
      .filter((o) => o.placed && o.id !== selfId && rectsOverlap(rect, rectOf(o)))
      .map((o) => o.id);
  }

  // ───────────────────────── 입력 처리 ─────────────────────────

  bindEvents() {
    const c = this.canvas;
    this.onDown = (e) => this.pointerDown(e);
    this.onMove = (e) => this.pointerMove(e);
    this.onUp = (e) => this.pointerUp(e, false);
    this.onCancel = (e) => this.pointerUp(e, true);
    this.onWheel = (e) => {
      // 컴퓨터: Ctrl + 스크롤(트랙패드 핀치도 같은 이벤트로 들어온다)로 확대·축소
      if (!e.ctrlKey && !e.metaKey) {
        this.cb.onPlainWheel?.();
        return;
      }
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoomBy(Math.exp(-delta * 0.0025), e.clientX, e.clientY);
    };
    this.onGesture = (e) => {
      // 사파리(맥) 트랙패드 핀치
      e.preventDefault();
      if (e.type === 'gesturestart') this.gestureZoom = this.zoom;
      else if (e.type === 'gesturechange' && this.gestureZoom) {
        this.zoom = clamp(this.gestureZoom * e.scale, MIN_ZOOM, MAX_ZOOM);
        this.invalidate();
      }
    };
    this.onContext = (e) => e.preventDefault();
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onCancel);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('gesturestart', this.onGesture);
    c.addEventListener('gesturechange', this.onGesture);
    c.addEventListener('contextmenu', this.onContext);
  }

  pointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 이미 사라진 포인터 */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.cb.onInteract?.();

    if (this.pointers.size === 2) {
      // 두 손가락: 진행 중이던 동작은 취소하고 확대·축소로 전환
      this.cancelGesture();
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;

    if (e.button === 2 || e.shiftKey) {
      this.gesture = { type: 'pan' };
      return;
    }
    const hit = this.pick(e.clientX, e.clientY);
    if (hit) {
      this.gesture = { type: 'press', id: hit.id, point: hit.point, x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse' };
    } else {
      this.gesture = { type: 'orbit', x0: e.clientX, y0: e.clientY, moved: false };
    }
  }

  pointerMove(e) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    if (this.pinch) {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      // 두 손가락을 벌리거나 오므리면 확대·축소, 함께 밀면 화면 이동
      this.panByPixels(cx - this.pinch.cx, cy - this.pinch.cy);
      if (this.pinch.dist > 0 && dist > 0) this.zoomBy(dist / this.pinch.dist, cx, cy);
      this.pinch = { dist, cx, cy };
      this.invalidate();
      return;
    }

    let g = this.gesture;
    if (!g) return;
    if (g.type === 'press') {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < (g.touch ? 8 : 4)) return;
      if (this.cb.isReadOnly?.()) {
        // 읽기 전용: 가구는 그대로 두고 왜 못 옮기는지만 알려 준다.
        this.gesture = { type: 'blocked' };
        this.cb.onBlockedEdit?.();
        return;
      }
      this.startItemDrag(g);
      g = this.gesture;
      if (!g) return;
    }
    if (g.type === 'drag') {
      this.updateItemDrag(e.clientX, e.clientY);
    } else if (g.type === 'orbit') {
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 4) return;
      g.moved = true;
      // 좌우로 끌면 시점이 방 둘레를 돌고, 위아래로 끌면 내려다보는 각도가 바뀐다.
      this.az -= dx * 0.0055;
      this.el = clamp(this.el + dy * 0.005, MIN_ELEVATION, MAX_ELEVATION);
      this.invalidate();
    } else if (g.type === 'pan') {
      this.panByPixels(dx, dy);
    }
  }

  pointerUp(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    if (this.pinch) {
      // 핀치가 끝나면 남은 손가락은 다시 뗄 때까지 아무 동작도 하지 않는다.
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    if (cancelled) {
      this.gesture = g;
      this.cancelGesture();
      return;
    }
    if (g.type === 'press') this.select(g.id === this.selectedId ? null : g.id);
    else if (g.type === 'drag') this.finishItemDrag(g, e.clientX, e.clientY);
    else if (g.type === 'orbit' && !g.moved) this.select(null);
  }

  cancelGesture() {
    const g = this.gesture;
    this.gesture = null;
    if (g && g.type === 'drag') this.endDragVisuals(g, true);
  }

  startItemDrag(press) {
    const item = this.items.find((it) => it.id === press.id);
    const group = this.groups.get(press.id);
    if (!item || !group) {
      this.gesture = null;
      return;
    }
    const { sx, sz } = footprint(item);
    // 잡은 지점의 높이에 수평면을 두면, 가구의 잡은 부분이 손가락을 정확히 따라온다.
    const y = clamp(press.point.y, 0, item.h);
    this.dragPlane.set(UP, -y);
    const p = this.rayToPlane(press.x0, press.y0, this.dragPlane) || press.point;
    const rot = item.rot ? 1 : 0;
    this.gesture = {
      type: 'drag',
      id: item.id,
      item,
      sx,
      sz,
      rot,
      offX: p.x - (item.x + sx / 2),
      offZ: p.z - (item.z + sz / 2),
      start: { x: item.x, z: item.z, sx, sz, rot },
      x: item.x,
      z: item.z,
      displaced: [],
      overInv: false,
    };
    this.select(item.id);
    this.container.classList.add('is-dragging');
  }

  updateItemDrag(clientX, clientY) {
    const g = this.gesture;
    const group = this.groups.get(g.id);
    if (!group) return;
    const p = this.rayToPlane(clientX, clientY, this.dragPlane);
    if (p) {
      const cx = p.x - g.offX;
      const cz = p.z - g.offZ;
      // 가구는 가까운 벽을 따라 선다(가로가 벽 쪽). 다른 벽 쪽으로 끌고 가면 그 벽에 맞춰 돌아선다.
      const rot = wallFor(g.item, this.room, cx, cz, g.rot);
      if (rot !== null) {
        g.rot = rot;
        ({ sx: g.sx, sz: g.sz } = footprint({ w: g.item.w, d: g.item.d, rot }));
        const pos = this.snapPosition(g.id, cx - g.sx / 2, cz - g.sz / 2, g.sx, g.sz);
        g.x = pos.x;
        g.z = pos.z;
      }
    }
    group.position.set(g.x + g.sx / 2, 0, g.z + g.sz / 2);
    group.rotation.y = quarterTurn(g.start.rot, g.rot);
    const overInv = !!this.cb.isOverInventory?.(clientX, clientY);
    if (overInv !== g.overInv) {
      g.overInv = overInv;
      this.cb.onInventoryHover?.(overInv);
    }
    g.displaced = overInv ? [] : this.overlapping(g.id, g.x, g.z, g.sx, g.sz);
    this.markDisplaced(g.displaced);
    this.invalidate();
  }

  finishItemDrag(g, clientX, clientY) {
    const overInv = !!this.cb.isOverInventory?.(clientX, clientY);
    const moved = Math.abs(g.x - g.start.x) > 0.01 || Math.abs(g.z - g.start.z) > 0.01 || g.rot !== g.start.rot;
    if (overInv) {
      this.endDragVisuals(g, true);
      this.cb.onStash?.(g.id);
    } else if (moved) {
      this.endDragVisuals(g, false);
      this.cb.onMove?.(g.id, g.x, g.z, g.rot, g.displaced);
    } else {
      this.endDragVisuals(g, true);
    }
  }

  endDragVisuals(g, restore) {
    this.container.classList.remove('is-dragging');
    if (g.overInv) this.cb.onInventoryHover?.(false);
    this.markDisplaced([]);
    const group = this.groups.get(g.id);
    if (restore && group) {
      group.position.set(g.start.x + g.start.sx / 2, 0, g.start.z + g.start.sz / 2);
      group.rotation.y = 0;
    }
    this.invalidate();
  }

  // ─────────────── 인벤토리에서 끌어오기(캔버스 바깥에서 시작하는 드래그) ───────────────

  /** @returns {boolean} 이 방에 놓을 수 있는 가구인지 */
  externalStart(item) {
    this.externalCancel();
    if (wallFor(item, this.room, 0, 0) === null) return false;
    this.ext = { item, rot: null, builtRot: 0, sx: 0, sz: 0, group: null, x: 0, z: 0, displaced: [], visible: false };
    this.select(null);
    return true;
  }

  /** @returns {boolean} 포인터가 3D 화면 위에 있는지 */
  externalMove(clientX, clientY) {
    const e = this.ext;
    if (!e) return false;
    const r = this.canvas.getBoundingClientRect();
    const inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    if (!inside) {
      if (e.group) e.group.visible = false;
      e.visible = false;
      this.markDisplaced([]);
      this.invalidate();
      return false;
    }
    const p = this.rayToPlane(clientX, clientY, this.floorPlane);
    if (p) {
      // 놓으려는 곳에서 가까운 벽을 따라 서도록 방향을 정한다.
      const rot = wallFor(e.item, this.room, p.x, p.z, e.rot);
      if (rot !== null) {
        e.rot = rot;
        ({ sx: e.sx, sz: e.sz } = footprint({ w: e.item.w, d: e.item.d, rot }));
        const pos = this.snapPosition(null, p.x - e.sx / 2, p.z - e.sz / 2, e.sx, e.sz);
        e.x = pos.x;
        e.z = pos.z;
        e.visible = true;
      }
    }
    if (e.visible) {
      if (!e.group) {
        e.builtRot = e.rot;
        e.group = this.makeItemGroup({ ...e.item, rot: e.rot, x: e.x, z: e.z }, true);
        this.scene.add(e.group);
      }
      e.group.visible = true;
      e.group.position.set(e.x + e.sx / 2, 0, e.z + e.sz / 2);
      e.group.rotation.y = quarterTurn(e.builtRot, e.rot);
      e.displaced = this.overlapping(null, e.x, e.z, e.sx, e.sz);
      this.markDisplaced(e.displaced);
    }
    this.invalidate();
    return true;
  }

  /** @returns {{x:number, z:number, rot:number, displaced:string[]} | null} 놓을 위치. 화면 밖이면 null */
  externalEnd(clientX, clientY) {
    const over = this.externalMove(clientX, clientY);
    const e = this.ext;
    const result = e && over && e.visible ? { x: e.x, z: e.z, rot: e.rot, displaced: e.displaced } : null;
    this.externalCancel();
    return result;
  }

  externalCancel() {
    const e = this.ext;
    this.ext = null;
    if (!e) return;
    if (e.group) {
      this.scene.remove(e.group);
      disposeChildren(e.group);
    }
    this.markDisplaced([]);
    this.invalidate();
  }

  // ───────────────────────── 정리 ─────────────────────────

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onCancel);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('gesturestart', this.onGesture);
    c.removeEventListener('gesturechange', this.onGesture);
    c.removeEventListener('contextmenu', this.onContext);
    this.externalCancel();
    disposeChildren(this.roomGroup);
    disposeChildren(this.itemGroup);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    c.remove();
    this.tag.remove();
    this.dimW.remove();
    this.dimD.remove();
  }
}

/** 한쪽 벽 방향으로 만든 모형을 다른 벽 방향으로 보이게 하는 회전각(앞쪽이 +z ↔ +x 로 바뀌도록). */
function quarterTurn(builtRot, rot) {
  if (builtRot === rot) return 0;
  return builtRot === 0 ? Math.PI / 2 : -Math.PI / 2;
}

function num(v) {
  return String(Math.round(v * 10) / 10);
}

function safeColor(c) {
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#888888';
}

function lines(points, color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

function disposeChildren(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
}

function place(el, p, transform) {
  el.style.visibility = p.visible ? 'visible' : 'hidden';
  el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) ${transform}`;
}

function tagButton(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
