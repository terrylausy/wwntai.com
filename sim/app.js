// 万物拟态 · MicroDuck 双足机器鸭浏览器仿真
// 物理：MuJoCo WASM（官方 @mujoco/mujoco，Apache-2.0）；渲染：three.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import loadMujoco from './vendor/mujoco.js';

// MuJoCo geom 类型常量（与 mjtGeom 一致，稳定不变）
const mjGEOM_PLANE = 0, mjGEOM_HFIELD = 1, mjGEOM_SPHERE = 2, mjGEOM_CAPSULE = 3,
      mjGEOM_ELLIPSOID = 4, mjGEOM_CYLINDER = 5, mjGEOM_BOX = 6, mjGEOM_MESH = 7;

const DUCK_ASSETS = [
  'trunk_base.stl','left_hip_yaw.stl','left_hip_roll.stl','left_hip_pitch.stl','left_knee.stl',
  'left_ankle.stl','right_hip_yaw.stl','right_hip_roll.stl','right_hip_pitch.stl','right_knee.stl',
  'right_ankle.stl','neck_pitch.stl','head_pitch.stl','head_yaw.stl','head_roll.stl'
];
const MINIPI_ASSETS = [
  'base_link.STL','camera_link.STL','head_pitch_link.STL','head_yaw_link.STL','head_yaw_link_simplify.STL',
  'l_ankle_pitch_link.STL','l_ankle_roll_link.STL','l_ankle_roll_link_simplify.STL','l_calf_link.STL','l_calf_link_simplify.STL',
  'l_elbow_link.STL','l_hip_pitch_link.STL','l_hip_roll_link.STL','l_shoulder_pitch_link.STL','l_shoulder_pitch_link_simplify.STL',
  'l_shoulder_roll_link.STL','l_thigh_link.STL','l_upper_arm_link.STL','l_wrist_link.STL',
  'r_ankle_pitch_link.STL','r_ankle_roll_link.STL','r_ankle_roll_link_simplify.STL','r_calf_link.STL','r_calf_link_simplify.STL',
  'r_elbow_link.STL','r_hip_pitch_link.STL','r_hip_roll_link.STL','r_shoulder_pitch_link.STL','r_shoulder_pitch_link_simplify.STL',
  'r_shoulder_roll_link.STL','r_thigh_link.STL','r_upper_arm_link.STL','r_wrist_link.STL','torso_link.STL','torso_link_simplify.STL'
];

const loadingEl = document.getElementById('loading');
function setLoading(t){ if (loadingEl) { const s = loadingEl.lastElementChild; if (s) s.textContent = t; } }

let mujoco, model, data;
let scene, camera, renderer, controls;
let bodies = {};      // bodyID -> THREE.Group
let running = false;
let keyIds = {};      // name -> keyframe id
let seq = null;       // 动作序列播放器 {segments, idx, t0, loop}
let demoOn = false;   // 自动演示开关
let WALK_HZ = 2.2;    // 行走步频（步/秒），可由外部指令调整
let poseOffsetX = 0;  // 连续行走累积的前向位移，避免每段动作回到原点
let pendingSeqId = 0; // 外部（编程器）下发的动作 id，用于完成后回执
let minipiWave = false;  // MiniPiPlus 挥手开关
let MP_J = null;         // MiniPiPlus 上肢关节 qposadr 映射缓存
let mpTarget = 'idle';   // MiniPiPlus 当前目标姿态名
let mpT0 = 0;            // 姿态切换起始时间（平滑过渡）
const keyQpos = {};   // name -> Float64Array 关键帧位形快照
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
  if (n.startsWith('mp_')) return new THREE.Color(0x5a6b7d);   // WW-MiniPiPlus 深灰蓝
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
    const type = model.geom_type[g];
    if (grp >= 3) continue;                              // 跳过 MicroDuck 碰撞组(group3)
    if (grp === 0 && type !== mjGEOM_PLANE) continue;    // 跳过 MiniPiPlus 碰撞网格(group0 非平面)，保留 floor
    const b = model.geom_bodyid[g];
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

// ---------- 在躯干正面贴品牌 Logo（贴花，随身体一起动） ----------
function addBodyLogo(){
  const grp = Object.values(bodies).find(g => g.name === 'trunk_base');
  if (!grp) return;
  // 用躯干组局部坐标算包围盒
  const box = new THREE.Box3();
  grp.children.forEach(m => {
    if (m.isMesh && m.geometry){
      m.geometry.computeBoundingBox();
      if (!m.geometry.boundingBox) return;
      const gb = m.geometry.boundingBox.clone();
      m.updateMatrix();
      gb.applyMatrix4(m.matrix);
      box.union(gb);
    }
  });
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // 尺寸控制在身体边界内
  const w = Math.min(size.z * 0.55, size.y * 0.5);
  const h = Math.min(w * (862 / 800), size.y * 0.7);
  const tex = new THREE.TextureLoader().load('Assets/images/ww-robot-logo.png');
  tex.colorSpace = THREE.SRGBColorSpace;
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  decal.position.set(box.min.x - 0.0015, center.y, center.z);
  decal.rotation.y = -Math.PI / 2;   // 平面法线朝 -x（背部）
  decal.renderOrder = 1;
  grp.add(decal);
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

// ---------- 关键帧位形快照 ----------
function snapshotKeys(){
  for (const k in keyIds){
    mujoco.mj_resetDataKeyframe(model, data, keyIds[k]);
    keyQpos[k] = Float64Array.from(data.qpos);
  }
  if (keyIds['STAND'] !== undefined) mujoco.mj_resetDataKeyframe(model, data, keyIds['STAND']);
  mujoco.mj_forward(model, data);
}

// ---------- 交互 ----------
function stopSeq(){ seq = null; }
function stopDemo(){
  demoOn = false; stopSeq(); minipiWave = false; mpTarget = 'idle';
  const b = document.getElementById('btnDemo'); if (b) b.classList.remove('active');
  const b2 = document.getElementById('btnDuo'); if (b2) b2.classList.remove('active');
  const b3 = document.getElementById('btnLove'); if (b3) b3.classList.remove('active');
}

function reset(){
  stopDemo();
  poseOffsetX = 0;
  if (keyIds['STAND'] !== undefined) mujoco.mj_resetDataKeyframe(model, data, keyIds['STAND']);
  else mujoco.mj_resetData(model, data);
  mujoco.mj_forward(model, data);
  updateBodies();
}

window.setKey = function(name){
  stopDemo();
  if (keyIds[name] === undefined) return;
  mujoco.mj_resetDataKeyframe(model, data, keyIds[name]);
  mujoco.mj_forward(model, data);
  updateBodies();
};
window.reset = reset;

window.setMode = function(mode){
  running = (mode === 'run');
  stopDemo();
  document.getElementById('btnRun').classList.toggle('active', running);
  document.getElementById('btnPose').classList.toggle('active', !running);
};

// ---------- 动作片段 ----------
// 保持某个关键帧姿态 dur 毫秒（叠加已累积的前向位移）
function holdSeg(name, dur){
  return { dur, apply: () => {
    const q0 = keyQpos[name] || keyQpos['STAND'];
    if (!q0) return;
    data.qpos.set(q0);
    data.qpos[0] += poseOffsetX;
  }};
}

// 切换 MiniPiPlus 姿态（爱情故事用），dur 后自然过渡到下一段
function poseSeg(name, dur){
  return { dur, apply: () => { setMpPose(name); } };
}

// 行走所需关节在 qpos 中的地址（按关节名查，避免硬编码）
let JIDX = null;
function jointIdx(){
  if (JIDX) return JIDX;
  JIDX = {
    lhp: Number(model.jnt('left_hip_pitch').qposadr),
    lk : Number(model.jnt('left_knee').qposadr),
    rhp: Number(model.jnt('right_hip_pitch').qposadr),
    rk : Number(model.jnt('right_knee').qposadr),
  };
  return JIDX;
}

// MiniPiPlus 上肢关节 qposadr（fixed base 双足人形，取手臂+头关节）
function mpJoints(){
  if (MP_J) return MP_J;
  MP_J = {};
  const names = ['r_shoulder_pitch','r_shoulder_roll','r_upper_arm','r_elbow',
                 'l_shoulder_pitch','l_shoulder_roll','l_upper_arm','l_elbow','head_yaw','head_pitch'];
  for (const n of names){
    try { MP_J[n] = Number(model.jnt('mp_' + n + '_joint').qposadr); } catch(e){}
  }
  return MP_J;
}

// MiniPiPlus 挥手（姿态驱动：直接设置上肢关节角，与 MicroDuck 序列播放同一机制）
function mpWaveCtrl(t){
  const J = mpJoints();
  const tgt = {
    r_shoulder_pitch: -1.8 + 0.5*Math.sin(t*5),
    r_shoulder_roll: 0.6*Math.sin(t*5),
    l_shoulder_pitch: -1.8 + 0.5*Math.sin(t*5 + Math.PI),
    l_shoulder_roll: -0.6*Math.sin(t*5),
    head_yaw: 0.8*Math.sin(t*2.5),
  };
  for (const k in tgt){
    const adr = J[k];
    if (adr === undefined) continue;
    data.qpos[adr] = tgt[k];
  }
}

// MiniPiPlus 多姿态（爱情故事用）：邀约 / 低头对视 / 环抱 / 托举 / 站立
const MP_POSES = {
  idle:   { r_shoulder_pitch:0, r_shoulder_roll:0, r_elbow:0, l_shoulder_pitch:0, l_shoulder_roll:0, l_elbow:0, head_yaw:0, head_pitch:0 },
  invite: { r_shoulder_pitch:-1.6, r_shoulder_roll:0.5, r_elbow:-0.5, l_shoulder_pitch:0, l_shoulder_roll:0, l_elbow:0, head_yaw:-0.4, head_pitch:-0.5 },
  look:   { r_shoulder_pitch:-1.6, r_shoulder_roll:0.5, r_elbow:-0.5, l_shoulder_pitch:0, l_shoulder_roll:0, l_elbow:0, head_yaw:-0.1, head_pitch:-0.95 },
  hug:    { r_shoulder_pitch:-1.25, r_shoulder_roll:0.65, r_elbow:-1.1, l_shoulder_pitch:-1.25, l_shoulder_roll:-0.65, l_elbow:-1.1, head_yaw:0, head_pitch:-0.55 },
  cradle: { r_shoulder_pitch:-1.55, r_shoulder_roll:0.25, r_elbow:-0.35, l_shoulder_pitch:-1.55, l_shoulder_roll:-0.25, l_elbow:-0.35, head_yaw:0, head_pitch:-0.25 },
};
let mpFrom = null;
function setMpPose(name){
  mpTarget = name;
  mpT0 = performance.now();
  mpFrom = {};
  const J = mpJoints();
  const pose = MP_POSES[name] || MP_POSES.idle;
  for (const k in pose){ const adr = J[k]; if (adr !== undefined) mpFrom[k] = data.qpos[adr]; }
}
// 静态姿态平滑过渡（smoothstep，1.2 秒）
function mpPoseCtrl(now){
  const J = mpJoints();
  const pose = MP_POSES[mpTarget] || MP_POSES.idle;
  const s = Math.min(1, (now - mpT0) / 1200);
  const ease = s * s * (3 - 2 * s);
  for (const k in pose){
    const adr = J[k];
    if (adr === undefined) continue;
    const from = (mpFrom && mpFrom[k] !== undefined) ? mpFrom[k] : 0;
    data.qpos[adr] = from + (pose[k] - from) * ease;
  }
}

// 行走：双腿交替摆髋 + 摆动腿抬膝 + 身体前移与起伏；dir=1 前进，-1 后退
function walkSeg(dur, speed = 0.14, dir = 1){
  const x0 = poseOffsetX;
  return {
    dur,
    apply: (t) => {
      const J = jointIdx();
      const q0 = keyQpos['STAND'];
      if (!q0) return;
      const q = data.qpos; q.set(q0);
      const sec = dur / 1000;
      const steps = Math.max(2, Math.round(sec * WALK_HZ));
      const th = 2 * Math.PI * steps * t;
      const hipA = 0.5, kneeA = 0.9;
      const L = Math.sin(th), R = Math.sin(th + Math.PI);
      q[J.lhp] = q0[J.lhp] + hipA * L;               // 左髋俯仰
      q[J.rhp] = q0[J.rhp] + hipA * R;               // 右髋俯仰（反相）
      q[J.lk]  = q0[J.lk]  + kneeA * Math.max(0, Math.sin(th - 1.2));           // 左膝摆动相弯曲
      q[J.rk]  = q0[J.rk]  + kneeA * Math.max(0, Math.sin(th - 1.2 + Math.PI)); // 右膝
      q[0] = q0[0] + x0 + dir * speed * sec * t;     // 前移
      q[2] = q0[2] + 0.012 * (1 - Math.cos(2 * th)); // 起伏
    },
    onEnd: () => { poseOffsetX = x0 + dir * speed * (dur / 1000); }
  };
}

// 转向：绕竖轴旋转 deg 度（正=左转）
function turnSeg(dur, deg){
  return {
    dur,
    apply: (t) => {
      const q0 = keyQpos['STAND'] || data.qpos;
      const q = data.qpos; q.set(q0);
      const half = (deg * Math.PI / 180) * t / 2;
      q[0] = q0[0] + poseOffsetX;
      q[3] = Math.cos(half); q[4] = 0; q[5] = 0; q[6] = Math.sin(half);
    }
  };
}

function flipSeg(dur){
  return { dur, apply: (t) => {
    const q0 = keyQpos['STAND'] || keyQpos['SIT'] || data.qpos;
    const q = data.qpos; q.set(q0);
    const hop = Math.sin(Math.PI * t), th = Math.PI * 2 * t;
    q[0] = q0[0] + poseOffsetX + 0.12 * Math.sin(Math.PI * t);   // 轻微前移
    q[2] = q0[2] + 0.22 * hop;                                   // 离地弧线
    q[3] = Math.cos(th / 2);                                     // 绕横向轴(y)前翻一圈
    q[4] = 0; q[5] = Math.sin(th / 2); q[6] = 0;
  }};
}

function playSeq(segments, loop, notifyId){
  running = false;
  document.getElementById('btnRun').classList.remove('active');
  document.getElementById('btnPose').classList.add('active');
  seq = { segments, idx: 0, t0: performance.now(), loop, notifyId };
}

// 单个行走
window.playWalk = function(){
  if (!model || !data) return;
  stopDemo();
  playSeq([walkSeg(3000), holdSeg('STAND', 300)], false);
};

// 单个翻跟斗
window.playFlip = function(){
  if (!model || !data) return;
  stopDemo();
  playSeq([holdSeg('STAND', 50), flipSeg(1500)], false);
};

// 自动演示片段（按指定顺序与时长）
function demoSegments(){
  return [
    walkSeg(3000),           // 行走 3s
    holdSeg('SIT', 1500),    // 坐下 1.5s
    holdSeg('STAND', 500),   // 站立 0.5s
    walkSeg(4000),           // 行走 4s
    holdSeg('STAND', 500),   // 停下 0.5s
    holdSeg('SIT', 1000),    // 坐下 1s
    flipSeg(300),            // 翻跟斗 0.3s
    holdSeg('STAND', 1000),  // 站立 1s
  ];
}

// 自动演示（循环）
window.playDemo = function(){
  if (!model || !data) return;
  if (demoOn){ stopDemo(); return; }
  demoOn = true;
  playSeq(demoSegments(), true);
  document.getElementById('btnDemo').classList.add('active');
};

// 双模型互动演示：WW-MiniPiPlus 挥手 + MicroDuck 走向/后退（相对运动 + 接触）
window.playDuo = function(){
  if (!model || !data) return;
  if (demoOn){ stopDemo(); return; }
  demoOn = true;
  minipiWave = true;   // MiniPiPlus 持续挥手
  playSeq([
    walkSeg(4500, 0.16),           // MicroDuck 走向 MiniPiPlus
    holdSeg('STAND', 1200),        // 停在它面前（MiniPiPlus 持续挥手）
    walkSeg(4500, 0.16, -1),       // 后退
    holdSeg('STAND', 1200),
  ], true);
  const b = document.getElementById('btnDuo'); if (b) b.classList.add('active');
};

// 爱情故事动作序列：邀约 → 对视 → 相伴 → 托举 → 定格（WW-MiniPiPlus 姿态 + MicroDuck 动作）
window.playLove = function(){
  if (!model || !data) return;
  if (demoOn){ stopDemo(); return; }
  demoOn = true;
  setMpPose('idle');
  playSeq([
    poseSeg('invite', 1500),     // ① 伸手邀约
    walkSeg(4000, 0.16),          // ② MicroDuck 走向它
    holdSeg('STAND', 1200),       //    停稳
    poseSeg('look', 100),         // ③ 低头对视
    holdSeg('STAND', 3800),       //    静静相望
    poseSeg('hug', 100),          // ④ 环抱
    holdSeg('STAND', 4400),       //    相拥相伴
    poseSeg('cradle', 100),       // ⑤ 双手托举
    holdSeg('STAND', 4000),       //    托举定格
    poseSeg('idle', 100),         // ⑥ 收尾
    holdSeg('STAND', 1600),
  ], false);
  const b = document.getElementById('btnLove'); if (b) b.classList.add('active');
};

function updateSeq(now){
  const s = seq; if (!s) return;
  let seg = s.segments[s.idx];
  let t = (now - s.t0) / seg.dur;
  if (t >= 1){
    if (seg.onEnd) seg.onEnd();          // 结算片段（累积前向位移等）
    s.idx++;
    if (s.idx >= s.segments.length){
      if (s.loop){ s.idx = 0; }
      else {
        const nid = s.notifyId;
        seq = null;
        if (nid) postParent({ type: 'seqdone', id: nid });   // 回执给图形化编程器
        return;
      }
    }
    s.t0 = now;
    seg = s.segments[s.idx];
    t = 0;
  }
  seg.apply(t);
  if (mpTarget === 'wave') mpWaveCtrl(now / 1000);      // 挥手
  else if (mpTarget !== 'idle') mpPoseCtrl(now);         // 静态姿态平滑过渡
  mujoco.mj_forward(model, data);
  updateBodies();
}

// ---------- 与图形化编程器（blocks.html）的消息桥 ----------
function postParent(msg){
  if (window.parent && window.parent !== window){
    try { msg.source = 'wwduck-sim'; window.parent.postMessage(msg, '*'); } catch (e) {}
  }
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.source !== 'wwduck-blocks') return;
  if (!model || !data) return;
  const id = d.id || 0;
  stopDemo();
  switch (d.cmd){
    case 'pose':
      window.setKey(d.name || 'STAND');
      postParent({ type: 'seqdone', id });
      break;
    case 'reset':
      reset();
      postParent({ type: 'seqdone', id });
      break;
    case 'walk':
      playSeq([walkSeg(d.dur || 3000, d.speed == null ? 0.14 : d.speed, d.dir || 1), holdSeg('STAND', 200)], false, id);
      break;
    case 'turn':
      playSeq([turnSeg(d.dur || 1000, d.deg == null ? 90 : d.deg), holdSeg('STAND', 150)], false, id);
      break;
    case 'flip':
      playSeq([holdSeg('STAND', 40), flipSeg(d.dur || 600), holdSeg('STAND', 150)], false, id);
      break;
    case 'demo':
      playSeq(demoSegments(), false, id);
      break;
    case 'pace':
      WALK_HZ = Math.max(0.5, Math.min(5, Number(d.hz) || 2.2));
      postParent({ type: 'seqdone', id });
      break;
    case 'stop':
      seq = null;
      postParent({ type: 'seqdone', id });
      break;
  }
});

// ---------- 主渲染循环 ----------
function animate(){
  requestAnimationFrame(animate);
  if (seq){
    updateSeq(performance.now());
  } else if (running && model && data){
    try { mujoco.mj_step(model, data); } catch(e){}
    updateBodies();
  }
  controls.update();
  renderer.render(scene, camera);
}

// ---------- 启动 ----------
async function main(){
  setLoading('加载引擎与模型资产…');

  // 并行下载：WASM + 三个 XML + 50 个 STL（互不依赖，同时进行）
  const duckJobs = DUCK_ASSETS.map(async (a) => ({ a, buf: await (await fetch('./wwduck/assets/' + a)).arrayBuffer() }));
  const minipiJobs = MINIPI_ASSETS.map(async (a) => ({ a, buf: await (await fetch('./wwduck/assets/' + a)).arrayBuffer() }));
  const total = DUCK_ASSETS.length + MINIPI_ASSETS.length;
  let done = 0;
  const track = async (p) => { const r = await p; done++; setLoading('下载模型资产 ' + done + '/' + total + '…'); return r; };

  const [mujocoModule, sceneXml, robotXml, minipiXml, duckAssets, minipiAssets] = await Promise.all([
    loadMujoco({
      locateFile: (path, prefix) => path.endsWith('.wasm') ? './vendor/mujoco.wasm' : prefix + path
    }),
    fetch('./wwduck/scene_duo.xml').then(r => r.text()),
    fetch('./wwduck/robot_walk.xml').then(r => r.text()),
    fetch('./wwminipiplus/minipi.xml').then(r => r.text()),
    Promise.all(duckJobs.map(track)),
    Promise.all(minipiJobs.map(track)),
  ]);
  mujoco = mujocoModule;

  setLoading('写入模型资产到虚拟文件系统…');
  const enc = new TextEncoder();
  const vfs = new mujoco.MjVFS();
  vfs.addBuffer('scene_duo.xml', enc.encode(sceneXml));
  vfs.addBuffer('robot_walk.xml', enc.encode(robotXml));
  vfs.addBuffer('wwminipiplus/minipi.xml', enc.encode(minipiXml));
  for (const { a, buf } of duckAssets){ vfs.addBuffer('assets/' + a, new Uint8Array(buf)); }
  for (const { a, buf } of minipiAssets){ vfs.addBuffer('assets/' + a, new Uint8Array(buf)); }

  setLoading('编译模型…');
  model = mujoco.from_xml_string(sceneXml, vfs);
  if (!model){ setLoading('模型加载失败，请检查控制台'); throw new Error('from_xml_string failed'); }
  data = new mujoco.MjData(model);

  indexKeyframes();
  snapshotKeys();
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
  addBodyLogo();
  updateBodies();

  if (loadingEl) loadingEl.style.display = 'none';
  animate();
  window.__sim = { model, data, bodies };   // 调试/验证用
  postParent({ type: 'ready' });   // 通知编程器：仿真引擎就绪

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
    else if (e.key === '5') playDemo();
    else if (e.key === '6') playWalk();
    else if (e.code === 'Space'){ e.preventDefault(); setMode(running ? 'pose' : 'run'); }
  });
}

main().catch(err => { console.error(err); setLoading('加载失败：' + err.message); });
