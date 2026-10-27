// 万物拟态 · 机器鸭浏览器仿真（MicroDuck 国产版 / wwDuck）
// 物理：MuJoCo WASM（官方 @mujoco/mujoco，Apache-2.0）；渲染：three.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import loadMujoco from './vendor/mujoco.js';

// MuJoCo geom 类型常量（与 mjtGeom 一致，稳定不变）
const mjGEOM_PLANE = 0, mjGEOM_HFIELD = 1, mjGEOM_SPHERE = 2, mjGEOM_CAPSULE = 3,
      mjGEOM_ELLIPSOID = 4, mjGEOM_CYLINDER = 5, mjGEOM_BOX = 6, mjGEOM_MESH = 7;

const ASSETS = [
  'trunk_base.stl','left_hip_yaw.stl','left_hip_roll.stl','left_hip_pitch.stl','left_knee.stl',
  'left_ankle.stl','right_hip_yaw.stl','right_hip_roll.stl','right_hip_pitch.stl','right_knee.stl',
  'right_ankle.stl','neck_pitch.stl','head_pitch.stl','head_yaw.stl','head_roll.stl'
];

const loadingEl = document.getElementById('loading');
function setLoading(t){ if (loadingEl) { const s = loadingEl.lastElementChild; if (s) s.textContent = t; } }

let mujoco, model, data;
let scene, camera, renderer, controls;
let bodies = {};      // bodyID -> THREE.Group
let running = false;
let keyIds = {};      // name -> keyframe id
let flipAnim = null;  // 翻跟斗动画状态
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

// ---------- 坐标换算：MuJoCo(z 轴向上) -> three.js(y 轴向上) ----------
function mjPos(buf, i, target){ return target.set(buf[i*3+0], buf[i*3+2], -buf[i*3+1]); }
function mjQuat(buf, i, target){ return target.set(-buf[i*4+1], -buf[i*4+3], buf[i*4+2], -buf[i*4+0]); }

// ---------- 名称解码（model.names 为字节串） ----------
const td = new TextDecoder();
function nameAt(adrArr, idx){
  const s = adrArr[idx]; let e = s;
  while (e < model.names.length && model.names[e] !== 0) e++;
  return td.decode(model.names.subarray(s, e));
}

// ---------- 配色：主体白、嘴/脸橙、地面深灰 ----------
function colorFor(name, g){
  const n = name.toLowerCase();
  if (g === mjGEOM_PLANE) return new THREE.Color(0x22303c);
  if (n.includes('jaw') || n.includes('face') || n.includes('noenoeil')) return new THREE.Color(0xf59e0b);
  if (n.includes('tire') || n.includes('roller') || n.includes('sole')) return new THREE.Color(0x374151);
  return new THREE.Color(0xeef2f5);
}

// ---------- 读取单个 STL mesh -> THREE.BufferGeometry ----------
const meshGeoCache = {};
function buildMeshGeometry(meshID){
  if (meshGeoCache[meshID]) return meshGeoCache[meshID];
  const vertAdr = model.mesh_vertadr[meshID], vertNum = model.mesh_vertnum[meshID];
  const faceAdr = model.mesh_faceadr[meshID], faceNum = model.mesh_facenum[meshID];
  const verts = new Float32Array(vertNum * 3);
  for (let v = 0; v < vertNum; v++){
    verts[v*3+0] = model.mesh_vert[(vertAdr+v)*3+0];
    verts[v*3+1] = model.mesh_vert[(vertAdr+v)*3+2];
    verts[v*3+2] = -model.mesh_vert[(vertAdr+v)*3+1];
  }
  const idx = new Uint32Array(faceNum * 3);
  for (let f = 0; f < faceNum * 3; f++) idx[f] = model.mesh_face[faceAdr*3 + f];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  meshGeoCache[meshID] = g;
  return g;
}

// ---------- 依据 mjModel 构建 three 场景 ----------
function buildScene(){
  const root = new THREE.Group();
  root.name = 'wwduck';
  scene.add(root);

  for (let g = 0; g < model.ngeom; g++){
    const grp = model.geom_group[g];
    if (grp >= 3) continue;               // 跳过碰撞组，避免重面闪烁
    const b = model.geom_bodyid[g];
    const type = model.geom_type[g];
    if (!bodies[b]){ bodies[b] = new THREE.Group(); bodies[b].bodyID = b; bodies[b].name = nameAt(model.name_bodyadr, b); }

    const size = [model.geom_size[g*3+0], model.geom_size[g*3+1], model.geom_size[g*3+2]];
    let geo;
    if (type === mjGEOM_PLANE){ geo = new THREE.PlaneGeometry(size[0]*2, size[1]*2); }
    else if (type === mjGEOM_SPHERE){ geo = new THREE.SphereGeometry(size[0], 32, 24); }
    else if (type === mjGEOM_CAPSULE){ geo = new THREE.CapsuleGeometry(size[0], size[1]*2, 8, 24); }
    else if (type === mjGEOM_CYLINDER){ geo = new THREE.CylinderGeometry(size[0], size[0], size[1]*2, 32); }
    else if (type === mjGEOM_ELLIPSOID){ geo = new THREE.SphereGeometry(1, 32, 24); }
    else if (type === mjGEOM_BOX){ geo = new THREE.BoxGeometry(size[0]*2, size[2]*2, size[1]*2); }
    else if (type === mjGEOM_MESH){ geo = buildMeshGeometry(model.geom_dataid[g]); }
    else continue;

    const rgba = model.geom_rgba;
    const mat = new THREE.MeshStandardMaterial({
      color: colorFor(bodies[b].name, type),
      roughness: 0.55, metalness: 0.05
    });
    if (rgba && rgba[g*4+3] < 0.999){ mat.transparent = true; mat.opacity = Math.max(0.05, rgba[g*4+3]); }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mjPos(model.geom_pos, g, mesh.position);
    mjQuat(model.geom_quat, g, mesh.quaternion);
    if (type === mjGEOM_PLANE){ mesh.rotation.x = -Math.PI/2; mesh.receiveShadow = true; mesh.castShadow = false; }
    if (type === mjGEOM_ELLIPSOID){ mesh.scale.set(size[0], size[2], size[1]); }

    bodies[b].add(mesh);
  }

  // 挂到 world 组（body 0）
  for (let b = 1; b < model.nbody; b++){
    if (bodies[b]) bodies[0].add(bodies[b]);
  }
  root.add(bodies[0]);
}

// ---------- 每帧把 mjData 位姿同步到 three ----------
function updateBodies(){
  for (let b = 1; b < model.nbody; b++){
    const grp = bodies[b]; if (!grp) continue;
    mjPos(data.xpos, b, grp.position);
    mjQuat(data.xquat, b, grp.quaternion);
  }
}

// ---------- 关键帧索引 ----------
function indexKeyframes(){
  for (let k = 0; k < model.nkey; k++){
    keyIds[nameAt(model.name_keyadr, k)] = k;
  }
}

// ---------- 交互 ----------
function reset(){
  flipAnim = null;
  if (keyIds['STAND'] !== undefined) mujoco.mj_resetDataKeyframe(model, data, keyIds['STAND']);
  else mujoco.mj_resetData(model, data);
  mujoco.mj_forward(model, data);
  updateBodies();
}

window.setKey = function(name){
  flipAnim = null;
  if (keyIds[name] === undefined) return;
  mujoco.mj_resetDataKeyframe(model, data, keyIds[name]);
  mujoco.mj_forward(model, data);
  updateBodies();
};
window.reset = reset;

window.setMode = function(mode){
  running = (mode === 'run');
  flipAnim = null;
  document.getElementById('btnRun').classList.toggle('active', running);
  document.getElementById('btnPose').classList.toggle('active', !running);
};

// ---------- 翻跟斗（姿态模式下的 360° 前空翻动画） ----------
window.playFlip = function(){
  if (!model || !data) return;
  setMode('pose');                       // 关掉物理，用姿态动画
  mujoco.mj_resetDataKeyframe(model, data, keyIds['STAND'] !== undefined ? keyIds['STAND'] : 0);
  mujoco.mj_forward(model, data);
  const q0 = Float64Array.from(data.qpos);   // 站立位形快照
  flipAnim = { t0: performance.now(), dur: 1500, q0, baseZ: data.qpos[2] };
};

function updateFlip(now){
  const a = flipAnim; if (!a) return;
  let t = (now - a.t0) / a.dur;
  if (t >= 1){
    data.qpos.set(a.q0);                 // 落地回到站立
    mujoco.mj_forward(model, data);
    updateBodies();
    flipAnim = null;
    return;
  }
  const q = data.qpos;
  q.set(a.q0);
  const hop = Math.sin(Math.PI * t);            // 起跳弧线 0→1→0
  const theta = Math.PI * 2 * t;                // 绕横向轴前翻一整圈
  q[0] += 0.12 * Math.sin(Math.PI * t);         // 轻微前移
  q[2] = a.baseZ + 0.22 * hop;                  // 离地高度
  q[3] = Math.cos(theta / 2);                   // 四元数 (w,x,y,z)：绕 y 轴旋转
  q[4] = 0;
  q[5] = Math.sin(theta / 2);
  q[6] = 0;
  mujoco.mj_forward(model, data);
  updateBodies();
}

// ---------- 主渲染循环 ----------
function animate(){
  requestAnimationFrame(animate);
  if (flipAnim){
    updateFlip(performance.now());
  } else if (running && model && data){
    try { mujoco.mj_step(model, data); } catch(e){}
    updateBodies();
  }
  controls.update();
  renderer.render(scene, camera);
}

// ---------- 启动 ----------
async function main(){
  setLoading('加载 MuJoCo WASM…');
  mujoco = await loadMujoco({
    locateFile: (path, prefix) => path.endsWith('.wasm') ? './vendor/mujoco.wasm' : prefix + path
  });

  setLoading('写入模型资产到虚拟文件系统…');
  const enc = new TextEncoder();
  const sceneXml = await (await fetch('./wwduck/scene_walk.xml')).text();
  const vfs = new mujoco.MjVFS();
  vfs.addBuffer('scene_walk.xml', enc.encode(sceneXml));
  vfs.addBuffer('robot_walk.xml', enc.encode(await (await fetch('./wwduck/robot_walk.xml')).text()));
  for (const a of ASSETS){
    const buf = await (await fetch('./wwduck/assets/' + a)).arrayBuffer();
    vfs.addBuffer('assets/' + a, new Uint8Array(buf));
  }

  setLoading('编译模型…');
  model = mujoco.from_xml_string(sceneXml, vfs);
  if (!model){ setLoading('模型加载失败，请检查控制台'); throw new Error('from_xml_string failed'); }
  data = new mujoco.MjData(model);

  indexKeyframes();
  reset();

  // three 初始化
  const viewer = document.getElementById('viewer');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);
  scene.fog = new THREE.Fog(0x0b0f14, 4, 12);

  camera = new THREE.PerspectiveCamera(45, viewer.clientWidth / viewer.clientHeight, 0.01, 100);
  camera.position.set(0.9, 0.55, 1.1);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  viewer.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.16, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.25;
  controls.maxDistance = 4;

  // 灯光
  const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.0); scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 2.2);
  dir.position.set(1.2, 2.2, 1.5);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.left = -1; dir.shadow.camera.right = 1;
  dir.shadow.camera.top = 1; dir.shadow.camera.bottom = -1;
  dir.shadow.camera.near = 0.1; dir.shadow.camera.far = 8;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xbfdbfe, 0.6); fill.position.set(-1.2, 0.8, -0.6); scene.add(fill);

  // 地面网格参考
  const grid = new THREE.GridHelper(4, 40, 0x2c3e50, 0x1c2833);
  grid.position.y = -0.001;
  scene.add(grid);

  buildScene();
  updateBodies();

  if (loadingEl) loadingEl.style.display = 'none';
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = viewer.clientWidth / viewer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewer.clientWidth, viewer.clientHeight);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === '1') setKey('STAND');
    else if (e.key === '2') setKey('SIT');
    else if (e.key === '3') setKey('FOLD');
    else if (e.key === '4') playFlip();
    else if (e.code === 'Space'){ e.preventDefault(); setMode(running ? 'pose' : 'run'); }
  });
}

main().catch(err => { console.error(err); setLoading('加载失败：' + err.message); });
