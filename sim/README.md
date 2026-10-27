# wwntAI 仿真平台（sim.wwntai.com）

万物拟态（WWNT Robotics）浏览器内机器人仿真平台。基于 **MuJoCo WASM** 物理引擎 + **three.js** 渲染，模型为 WWNT Robotics 核心模型。

## 页面

- `index.html` — MicroDuck 双足机器鸭实时物理仿真：站立 / 坐下 / 折叠姿态，行走、转向、翻跟斗、自动演示，拖拽旋转缩放。
- `blocks.html` — MicroDuck 图形化积木编程工作台（Blockly 自托管）：拖拽积木生成动作序列，右侧仿真实时联动，同步输出 Python 代码。

## 技术栈

- MuJoCo WASM（`@mujoco/mujoco`，Apache-2.0）
- three.js（MIT）+ OrbitControls
- Blockly 13.4.0（Apache-2.0）
- 模型资产：WWNT Robotics 核心模型

## 本地预览

```bash
cd sim
python -m http.server 8899
# 打开 http://localhost:8899/index.html
```

## 目录

```
├── index.html          # 仿真主页
├── app.js              # 仿真核心（MuJoCo → three.js）
├── blocks.html         # 图形化编程工作台
├── blocks.js           # 积木执行器 + Python 代码生成
├── blocks-toolbox.js   # 积木定义 / 深色主题
├── vendor/             # 自托管运行时（mujoco / three / blockly）
├── wwduck/             # 模型资产（XML + STL）
├── assets/js/          # 自托管 Tailwind Play CDN
└── Assets/images/      # 品牌 Logo
```
