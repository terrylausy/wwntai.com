/* MicroDuck 图形化编程 · 积木定义 / 主题 / 工具箱
 * 依赖：blockly.min.js + msg/zh-hans.js
 * 所有积木最终映射到 sim/index.html 暴露的动作指令（见 app.js 消息桥）
 */
(function (global) {
  'use strict';

  var B = global.Blockly;

  // ---------- 深色科技风主题 ----------
  function buildTheme() {
    var base = (B.Themes && B.Themes.Classic) ? B.Themes.Classic : undefined;
    return B.Theme.defineTheme('wwduckDark', {
      base: base,
      blockStyles: {
        robot_blocks:  { colourPrimary: '#4f46e5', colourSecondary: '#4338ca', colourTertiary: '#3730a3' },
        motion_blocks: { colourPrimary: '#0e7490', colourSecondary: '#155e75', colourTertiary: '#0b4f63' },
        pose_blocks:   { colourPrimary: '#7c3aed', colourSecondary: '#6d28d9', colourTertiary: '#5b21b6' },
        flow_blocks:   { colourPrimary: '#b45309', colourSecondary: '#92400e', colourTertiary: '#78350f' },
        demo_blocks:   { colourPrimary: '#be185d', colourSecondary: '#9d174d', colourTertiary: '#831843' },
        out_blocks:    { colourPrimary: '#047857', colourSecondary: '#065f46', colourTertiary: '#064e3b' }
      },
      categoryStyles: {
        robot_category:  { colour: '#4f46e5' },
        motion_category: { colour: '#0e7490' },
        pose_category:   { colour: '#7c3aed' },
        flow_category:   { colour: '#b45309' },
        data_category:   { colour: '#0f766e' },
        demo_category:   { colour: '#be185d' },
        out_category:    { colour: '#047857' }
      },
      componentStyles: {
        workspaceBackgroundColour: '#080f16',
        toolboxBackgroundColour: '#0a131b',
        toolboxForegroundColour: '#cfe3f2',
        flyoutBackgroundColour: '#0d1720',
        flyoutForegroundColour: '#9fb3c4',
        flyoutOpacity: 0.98,
        scrollbarColour: '#1e4a5c',
        scrollbarOpacity: 0.7,
        insertionMarkerColour: '#22d3ee',
        insertionMarkerOpacity: 0.45,
        cursorColour: '#22d3ee',
        markerColour: '#22d3ee'
      },
      fontStyle: {
        family: '"Inter","PingFang SC","Microsoft YaHei",sans-serif',
        weight: '600',
        size: 12
      }
    });
  }

  // ---------- 积木定义 ----------
  function defineBlocks() {
    if (!B.Blocks['ww_walk']) {
      B.common.defineBlocksWithJsonArray([
        {
          type: 'ww_init',
          message0: '初始化 %1 并连接仿真引擎',
          args0: [{
            type: 'field_dropdown', name: 'ROBOT', options: [
              ['MicroDuck 双足', 'microduck']
            ]
          }],
          previousStatement: null,
          nextStatement: null,
          style: 'robot_blocks',
          tooltip: '连接右侧 MuJoCo 仿真引擎，把机器鸭复位到站立姿态'
        },
        {
          type: 'ww_reset',
          message0: '复位到初始姿态',
          previousStatement: null,
          nextStatement: null,
          style: 'robot_blocks',
          tooltip: '回到仿真起点，清除行走累积的位移'
        },
        {
          type: 'ww_walk',
          message0: '行走  速度 %1 / 100  时长 %2 秒  %3',
          args0: [
            { type: 'input_value', name: 'SPEED', check: 'Number' },
            { type: 'input_value', name: 'DUR', check: 'Number' },
            { type: 'field_dropdown', name: 'DIR', options: [['前进', '1'], ['后退', '-1']] }
          ],
          inputsInline: true,
          previousStatement: null,
          nextStatement: null,
          style: 'motion_blocks',
          tooltip: '速度 18 为标准步速；时长决定这一步走多久'
        },
        {
          type: 'ww_turn',
          message0: '转向 %1  %2 度  用时 %3 秒',
          args0: [
            { type: 'field_dropdown', name: 'SIDE', options: [['左转', '1'], ['右转', '-1']] },
            { type: 'input_value', name: 'DEG', check: 'Number' },
            { type: 'input_value', name: 'DUR', check: 'Number' }
          ],
          inputsInline: true,
          previousStatement: null,
          nextStatement: null,
          style: 'motion_blocks',
          tooltip: '原地绕竖轴转向'
        },
        {
          type: 'ww_stop',
          message0: '停止移动（站立不动）',
          previousStatement: null,
          nextStatement: null,
          style: 'motion_blocks',
          tooltip: '立刻停下并保持站立姿态'
        },
        {
          type: 'ww_pose',
          message0: '切换姿态 %1',
          args0: [{
            type: 'field_dropdown', name: 'NAME', options: [
              ['站立 STAND', 'STAND'],
              ['坐下 SIT', 'SIT'],
              ['折叠 FOLD', 'FOLD']
            ]
          }],
          previousStatement: null,
          nextStatement: null,
          style: 'pose_blocks',
          tooltip: '切换到模型内置关键帧姿态'
        },
        {
          type: 'ww_flip',
          message0: '翻跟斗  用时 %1 秒',
          args0: [{ type: 'input_value', name: 'DUR', check: 'Number' }],
          inputsInline: true,
          previousStatement: null,
          nextStatement: null,
          style: 'pose_blocks',
          tooltip: '前空翻一圈（0.3 秒为快速翻，1.5 秒为慢动作）'
        },
        {
          type: 'ww_wait',
          message0: '等待 %1 秒',
          args0: [{ type: 'input_value', name: 'SEC', check: 'Number' }],
          inputsInline: true,
          previousStatement: null,
          nextStatement: null,
          style: 'flow_blocks',
          tooltip: '保持当前姿态停顿一段时间'
        },
        {
          type: 'ww_forever',
          message0: '一直重复执行',
          message1: '%1',
          args1: [{ type: 'input_statement', name: 'DO' }],
          previousStatement: null,
          nextStatement: null,
          style: 'flow_blocks',
          tooltip: '无限循环，点「停止」才会结束'
        },
        {
          type: 'ww_demo',
          message0: '播放预置演示序列（约 11 秒）',
          previousStatement: null,
          nextStatement: null,
          style: 'demo_blocks',
          tooltip: '行走→坐下→站立→行走→坐下→翻跟斗→站立 的连贯动作'
        },
        {
          type: 'ww_pace',
          message0: '设置步频 %1 步/秒',
          args0: [{ type: 'input_value', name: 'HZ', check: 'Number' }],
          inputsInline: true,
          previousStatement: null,
          nextStatement: null,
          style: 'demo_blocks',
          tooltip: '默认 2.2 步/秒，数值越大迈腿越快'
        },
        {
          type: 'ww_log',
          message0: '输出日志 标签 %1',
          args0: [{ type: 'input_value', name: 'TEXT', check: 'String' }],
          inputsInline: true,
          previousStatement: null,
          nextStatement: null,
          style: 'out_blocks',
          tooltip: '在左下控制台打印一行信息，方便调试'
        }
      ]);
    }
  }

  // ---------- 工具箱 ----------
  function shadowNum(n) {
    return '<shadow type="math_number"><field name="NUM">' + n + '</field></shadow>';
  }

  var toolboxXml = [
    '<xml xmlns="https://developers.google.com/blockly/xml">',
    '  <category name="机器人" colour="#4f46e5">',
    '    <block type="ww_init"></block>',
    '    <block type="ww_reset"></block>',
    '    <block type="ww_pace"><value name="HZ">' + shadowNum(2.2) + '</value></block>',
    '  </category>',
    '  <category name="运动" colour="#0e7490">',
    '    <block type="ww_walk"><value name="SPEED">' + shadowNum(18) + '</value><value name="DUR">' + shadowNum(3) + '</value></block>',
    '    <block type="ww_turn"><value name="DEG">' + shadowNum(90) + '</value><value name="DUR">' + shadowNum(1) + '</value></block>',
    '    <block type="ww_stop"></block>',
    '  </category>',
    '  <category name="姿态" colour="#7c3aed">',
    '    <block type="ww_pose"></block>',
    '    <block type="ww_flip"><value name="DUR">' + shadowNum(0.3) + '</value></block>',
    '  </category>',
    '  <category name="流程" colour="#b45309">',
    '    <block type="ww_wait"><value name="SEC">' + shadowNum(1) + '</value></block>',
    '    <block type="controls_repeat_ext"><value name="TIMES">' + shadowNum(3) + '</value></block>',
    '    <block type="ww_forever"></block>',
    '    <block type="controls_if"></block>',
    '  </category>',
    '  <category name="数据与逻辑" colour="#0f766e">',
    '    <block type="math_number"><field name="NUM">0</field></block>',
    '    <block type="math_arithmetic"></block>',
    '    <block type="logic_compare"></block>',
    '    <block type="logic_boolean"></block>',
    '    <block type="variables_set"><value name="VALUE">' + shadowNum(0) + '</value></block>',
    '    <block type="variables_get"></block>',
    '    <block type="text"><field name="TEXT">你好 MicroDuck</field></block>',
    '  </category>',
    '  <category name="演示" colour="#be185d">',
    '    <block type="ww_demo"></block>',
    '  </category>',
    '  <category name="输出" colour="#047857">',
    '    <block type="ww_log"><value name="TEXT"><shadow type="text"><field name="TEXT">运行到第 1 步</field></shadow></value></block>',
    '    <block type="text_print"></block>',
    '  </category>',
    '</xml>'
  ].join('\n');

  // ---------- 范例工程（首次进入时的默认内容） ----------
  var sampleState = {
    blocks: {
      languageVersion: 0,
      blocks: [{
        type: 'ww_init',
        x: 32, y: 32,
        next: {
          block: {
            type: 'ww_pace',
            inputs: { HZ: { shadow: { type: 'math_number', fields: { NUM: 2.2 } } } },
            next: {
              block: {
                type: 'ww_walk',
                inputs: {
                  SPEED: { shadow: { type: 'math_number', fields: { NUM: 18 } } },
                  DUR: { shadow: { type: 'math_number', fields: { NUM: 3 } } }
                },
                fields: { DIR: '1' },
                next: {
                  block: {
                    type: 'ww_pose',
                    fields: { NAME: 'SIT' },
                    next: {
                      block: {
                        type: 'ww_wait',
                        inputs: { SEC: { shadow: { type: 'math_number', fields: { NUM: 1.5 } } } },
                        next: {
                          block: {
                            type: 'ww_pose',
                            fields: { NAME: 'STAND' },
                            next: {
                              block: {
                                type: 'ww_flip',
                                inputs: { DUR: { shadow: { type: 'math_number', fields: { NUM: 0.3 } } } },
                                next: {
                                  block: {
                                    type: 'ww_log',
                                    inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: '演示完成' } } } }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }]
    }
  };

  global.WW_BLOCKS = {
    buildTheme: buildTheme,
    defineBlocks: defineBlocks,
    toolboxXml: toolboxXml,
    sampleState: sampleState
  };
})(window);
