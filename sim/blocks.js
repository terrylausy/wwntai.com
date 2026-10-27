/* MicroDuck 图形化编程工作台 · 主逻辑
 * 左：Blockly 积木 → 中：解释执行 → 右：MuJoCo 仿真实时联动
 * 执行方式：把积木翻译成动作指令，通过 postMessage 下发给 sim/index.html
 */
(function () {
  'use strict';

  var B = window.Blockly;
  var WW = window.WW_BLOCKS;
  var LS_KEY = 'wwduck_blocks_project_v1';

  var ws = null;
  var simFrame = document.getElementById('simFrame');
  var engineReady = false;
  var state = { running: false, token: 0, vars: {}, cmdId: 0, pending: {} };
  var currentHL = null;
  var saveTimer = null;

  // ---------- 通用 UI ----------
  function $(id) { return document.getElementById(id); }

  function log(msg, kind) {
    var body = $('logBody');
    if (!body) return;
    var d = new Date();
    var ts = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    var line = document.createElement('div');
    line.className = 'log-line' + (kind ? ' ' + kind : '');
    var t = document.createElement('span'); t.className = 't'; t.textContent = ts;
    var m = document.createElement('span'); m.className = 'm'; m.textContent = msg;
    line.appendChild(t); line.appendChild(m);
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
  }

  function setEngineReady(ok) {
    engineReady = !!ok;
    $('engineDot').className = 'dot' + (ok ? ' on' : '');
    $('engineText').textContent = ok ? 'MuJoCo 已就绪' : '引擎加载中…';
  }

  function setHud(text) { $('hudState').textContent = text; }

  // ---------- 与仿真页通信 ----------
  function post(msg) {
    if (!simFrame.contentWindow) return;
    simFrame.contentWindow.postMessage(msg, '*');
  }

  function sendCmd(cmd, payload, waitMs) {
    return new Promise(function (resolve) {
      var id = ++state.cmdId;
      state.pending[id] = resolve;
      var msg = { source: 'wwduck-blocks', cmd: cmd, id: id };
      if (payload) for (var k in payload) msg[k] = payload[k];
      post(msg);
      // 兜底超时：万一仿真页没回执，也不能把程序卡死
      setTimeout(function () {
        if (state.pending[id]) { var r = state.pending[id]; delete state.pending[id]; r(); }
      }, Math.max(600, waitMs || 900) + 4000);
    });
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'wwduck-sim') return;
    if (d.type === 'ready') { setEngineReady(true); }
    if (d.type === 'seqdone') {
      var r = state.pending[d.id];
      if (r) { delete state.pending[d.id]; r(); }
    }
  });

  // ---------- 运行控制 ----------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function blkNode(b) {
    try {
      if (b.pathObject && b.pathObject.svgRoot) return b.pathObject.svgRoot;
      if (b.svgGroup_) return b.svgGroup_;
    } catch (e) {}
    return null;
  }

  function clearHighlight() {
    if (currentHL) {
      var el = blkNode(currentHL);
      if (el && el.classList) el.classList.remove('blk-run');
    }
    try { ws.highlightBlock(null); } catch (e) {}
    currentHL = null;
  }

  function highlight(b) {
    clearHighlight();
    if (!b) return;
    currentHL = b;
    try { ws.highlightBlock(b.id); } catch (e) {}
    var el = blkNode(b);
    if (el && el.classList) el.classList.add('blk-run');
  }

  function numInput(b, name, dflt) {
    var t = b && b.getInputTargetBlock ? b.getInputTargetBlock(name) : null;
    if (!t) return dflt;
    return evalNum(t, dflt);
  }

  function evalNum(t, dflt) {
    if (!t) return dflt;
    switch (t.type) {
      case 'math_number':
        return Number(t.getFieldValue('NUM')) || 0;
      case 'math_arithmetic': {
        var a = numInput(t, 'A', 0), b2 = numInput(t, 'B', 0);
        switch (t.getFieldValue('OP')) {
          case 'ADD': return a + b2;
          case 'MINUS': return a - b2;
          case 'MULTIPLY': return a * b2;
          case 'DIVIDE': return b2 === 0 ? 0 : a / b2;
          case 'POWER': return Math.pow(a, b2);
        }
        return 0;
      }
      case 'variables_get': {
        var vn = varName(t, 'VAR');
        return Number(state.vars[vn] || 0);
      }
      case 'text':
        return Number(t.getFieldValue('TEXT')) || 0;
      default:
        return dflt;
    }
  }

  function evalBool(t) {
    if (!t) return false;
    if (t.type === 'logic_boolean') return t.getFieldValue('BOOL') === 'TRUE';
    if (t.type === 'logic_compare') {
      var a = numInput(t, 'A', 0), b = numInput(t, 'B', 0);
      switch (t.getFieldValue('OP')) {
        case 'EQ': return a === b;
        case 'NEQ': return a !== b;
        case 'LT': return a < b;
        case 'LTE': return a <= b;
        case 'GT': return a > b;
        case 'GTE': return a >= b;
      }
    }
    return false;
  }

  function textInput(b, name) {
    var t = b && b.getInputTargetBlock ? b.getInputTargetBlock(name) : null;
    if (!t) return '';
    if (t.type === 'text') return t.getFieldValue('TEXT');
    if (t.type === 'math_number') return String(t.getFieldValue('NUM'));
    if (t.type === 'variables_get') return String(state.vars[varName(t, 'VAR')] || 0);
    return '';
  }

  function fmt(n) {
    n = Number(n) || 0;
    return (Math.round(n * 100) / 100).toString();
  }

  // 变量字段存的是 id，需换回可读名字
  function varName(b, fieldName) {
    var id = b.getFieldValue(fieldName || 'VAR');
    var v = null;
    try { v = ws.getVariableById(id); } catch (e) {}
    return (v && v.name) || id || '变量';
  }

  function cancelled(token) { return !state.running || token !== state.token; }

  async function execOne(b, token) {
    if (cancelled(token)) return;
    highlight(b);

    switch (b.type) {
      case 'ww_init': {
        log('连接仿真引擎：MicroDuck 双足', 'ok');
        await sendCmd('reset', {}, 700);
        break;
      }
      case 'ww_reset': {
        log('复位到初始姿态', 'dim');
        await sendCmd('reset', {}, 700);
        break;
      }
      case 'ww_walk': {
        var raw = numInput(b, 'SPEED', 18);
        var durS = Math.max(0.2, numInput(b, 'DUR', 3));
        var dir = b.getFieldValue('DIR') === '1' ? 1 : -1;
        var mps = Math.max(0.02, Math.min(0.6, 0.14 * (raw / 18)));
        log('行走：速度 ' + fmt(raw) + '/100（' + fmt(mps) + ' m/s），' + fmt(durS) + ' 秒，' + (dir > 0 ? '前进' : '后退'));
        setHud('WALKING');
        await sendCmd('walk', { dur: Math.round(durS * 1000), speed: mps, dir: dir }, durS * 1000);
        break;
      }
      case 'ww_turn': {
        var side = b.getFieldValue('SIDE') === '1' ? 1 : -1;
        var deg = Math.max(1, numInput(b, 'DEG', 90)) * side;
        var tDur = Math.max(0.2, numInput(b, 'DUR', 1));
        log('转向：' + (side > 0 ? '左转' : '右转') + ' ' + fmt(Math.abs(deg)) + '°，用时 ' + fmt(tDur) + ' 秒');
        setHud('TURNING');
        await sendCmd('turn', { deg: deg, dur: Math.round(tDur * 1000) }, tDur * 1000);
        break;
      }
      case 'ww_stop': {
        log('停止移动', 'dim');
        await sendCmd('pose', { name: 'STAND' }, 600);
        break;
      }
      case 'ww_pose': {
        var pn = b.getFieldValue('NAME');
        var label = pn === 'STAND' ? '站立' : pn === 'SIT' ? '坐下' : '折叠';
        log('姿态：' + label, 'dim');
        setHud(pn);
        await sendCmd('pose', { name: pn }, 600);
        break;
      }
      case 'ww_flip': {
        var fDur = Math.max(0.15, numInput(b, 'DUR', 0.3));
        log('翻跟斗：' + fmt(fDur) + ' 秒', 'warn');
        setHud('FLIP');
        await sendCmd('flip', { dur: Math.round(fDur * 1000) }, fDur * 1000);
        break;
      }
      case 'ww_wait': {
        var wSec = Math.max(0, numInput(b, 'SEC', 1));
        log('等待 ' + fmt(wSec) + ' 秒', 'dim');
        setHud('WAIT');
        await sleep(wSec * 1000);
        break;
      }
      case 'ww_pace': {
        var hz = Math.max(0.5, Math.min(5, numInput(b, 'HZ', 2.2)));
        log('步频设为 ' + fmt(hz) + ' 步/秒', 'dim');
        await sendCmd('pace', { hz: hz }, 600);
        break;
      }
      case 'ww_demo': {
        log('播放预置演示序列（约 11 秒）', 'ok');
        setHud('DEMO');
        await sendCmd('demo', {}, 11400);
        break;
      }
      case 'ww_log':
      case 'text_print': {
        var txt = b.type === 'ww_log' ? textInput(b, 'TEXT') : textInput(b, 'TEXT');
        log('› ' + (txt || '(空)'));
        break;
      }
      case 'variables_set': {
        var name = varName(b, 'VAR');
        state.vars[name] = numInput(b, 'VALUE', 0);
        log('变量 ' + name + ' = ' + fmt(state.vars[name]), 'dim');
        break;
      }
      case 'controls_if': {
        var n = 0;
        while (b.getInputTargetBlock('IF' + n) !== null) {
          if (evalBool(b.getInputTargetBlock('IF' + n))) {
            await execStmt(b.getInputTargetBlock('DO' + n), token);
            highlight(b);
            return;
          }
          n++;
        }
        if (b.getInputTargetBlock('ELSE')) await execStmt(b.getInputTargetBlock('ELSE'), token);
        highlight(b);
        break;
      }
      case 'controls_repeat_ext': {
        var times = Math.max(0, Math.round(numInput(b, 'TIMES', 3)));
        log('重复执行 ' + times + ' 次', 'dim');
        for (var i = 0; i < times; i++) {
          if (cancelled(token)) return;
          // 每次重复重新高亮循环头，形成可见的进度反馈
          highlight(b);
          await execStmt(b.getInputTargetBlock('DO'), token, true);
        }
        break;
      }
      case 'ww_forever': {
        log('进入无限循环（点「停止」结束）', 'warn');
        var guard = 0;
        while (!cancelled(token) && guard++ < 500) {
          highlight(b);
          await execStmt(b.getInputTargetBlock('DO'), token, true);
        }
        break;
      }
      default:
        // 未映射积木（如单独的数值块）静默跳过
        break;
    }
    if (!cancelled(token)) { /* 保持高亮到下一块 */ }
  }

  async function execStmt(b, token, keepHeader) {
    var header = b;
    while (b) {
      if (cancelled(token)) return;
      if (keepHeader && header) highlight(header);
      await execOne(b, token);
      if (cancelled(token)) return;
      b = b.getNextBlock();
    }
  }

  async function runProgram() {
    if (state.running) return;
    if (!engineReady) { toast('仿真引擎还在加载，请稍候…'); log('仿真引擎未就绪，无法运行', 'err'); return; }

    state.running = true;
    state.token++;
    var token = state.token;
    state.vars = {};

    $('btnRun').disabled = true;
    $('btnStop').disabled = false;
    log('▶ 开始执行程序', 'ok');
    setHud('RUNNING');

    var t0 = performance.now();
    try {
      var tops = ws.getTopBlocks(true);
      if (!tops.length) { log('工作区里还没有积木，先从左侧拖一块出来试试', 'warn'); }
      for (var i = 0; i < tops.length; i++) {
        await execStmt(tops[i], token);
        if (cancelled(token)) break;
      }
      if (!cancelled(token)) {
        var sec = ((performance.now() - t0) / 1000).toFixed(2);
        log('✔ 程序执行完成，用时 ' + sec + ' 秒', 'ok');
      } else {
        log('■ 已停止', 'err');
      }
    } catch (err) {
      console.error(err);
      log('执行出错：' + (err && err.message ? err.message : err), 'err');
    } finally {
      if (token === state.token) {
        state.running = false;
        clearHighlight();
        $('btnRun').disabled = false;
        $('btnStop').disabled = true;
        setHud('IDLE');
      }
    }
  }

  function stopProgram() {
    if (!state.running) {
      sendCmd('stop', {}, 300);
      return;
    }
    state.running = false;
    state.token++;
    state.pending = {};
    post({ source: 'wwduck-blocks', cmd: 'stop', id: ++state.cmdId });
    clearHighlight();
    $('btnRun').disabled = false;
    $('btnStop').disabled = true;
    setHud('IDLE');
    log('■ 收到停止指令', 'err');
  }

  // ---------- 代码生成（Python 只读视图） ----------
  function q(s) { return '"' + String(s).replace(/"/g, '\\"') + '"'; }

  function genExpr(b, inputName, dflt) {
    var t = b && b.getInputTargetBlock ? b.getInputTargetBlock(inputName) : null;
    if (!t) return fmt(dflt);
    if (t.type === 'variables_get') return varName(t, 'VAR');
    if (t.type === 'text') return q(t.getFieldValue('TEXT'));
    if (t.type === 'math_arithmetic') {
      var opMap = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/', POWER: '**' };
      return genExpr(t, 'A', 0) + ' ' + (opMap[t.getFieldValue('OP')] || '+') + ' ' + genExpr(t, 'B', 0);
    }
    return fmt(evalNum(t, dflt));
  }

  function genOne(b, indent, lines) {
    var ind = new Array(indent + 1).join('    ');
    var fl = b.getFieldValue ? b.getFieldValue.bind(b) : function () { return null; };
    switch (b.type) {
      case 'ww_init':
        lines.push(ind + 'duck = wwduck.Duck(robot="MicroDuck")' + '   # 初始化双足机器鸭');
        break;
      case 'ww_reset':
        lines.push(ind + 'duck.reset()');
        break;
      case 'ww_walk':
        lines.push(ind + 'duck.walk(speed=' + genExpr(b, 'SPEED', 18) +
          ', duration=' + genExpr(b, 'DUR', 3) +
          ', direction=' + q(fl('DIR') === '1' ? 'forward' : 'backward') + ')');
        break;
      case 'ww_turn':
        lines.push(ind + 'duck.turn(direction=' + q(fl('SIDE') === '1' ? 'left' : 'right') +
          ', angle=' + genExpr(b, 'DEG', 90) +
          ', duration=' + genExpr(b, 'DUR', 1) + ')');
        break;
      case 'ww_stop':
        lines.push(ind + 'duck.stop()');
        break;
      case 'ww_pose':
        lines.push(ind + 'duck.pose(' + q(fl('NAME')) + ')');
        break;
      case 'ww_flip':
        lines.push(ind + 'duck.flip(duration=' + genExpr(b, 'DUR', 0.3) + ')');
        break;
      case 'ww_wait':
        lines.push(ind + 'time.sleep(' + genExpr(b, 'SEC', 1) + ')');
        break;
      case 'ww_pace':
        lines.push(ind + 'duck.set_gait_frequency(' + genExpr(b, 'HZ', 2.2) + ')   # 步/秒');
        break;
      case 'ww_demo':
        lines.push(ind + 'duck.play_demo()   # 预置连贯演示序列');
        break;
      case 'ww_log':
      case 'text_print':
        lines.push(ind + 'print(' + genExpr(b, 'TEXT', '') + ')');
        break;
      case 'variables_set':
        lines.push(ind + fl('VAR') + ' = ' + genExpr(b, 'VALUE', 0));
        break;
      case 'controls_if': {
        var cond = 'True';
        var condBlock = b.getInputTargetBlock('IF0');
        if (condBlock && condBlock.type === 'logic_compare') {
          var opMap = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
          cond = genExpr(condBlock, 'A', 0) + ' ' + (opMap[condBlock.getFieldValue('OP')] || '==') + ' ' + genExpr(condBlock, 'B', 0);
        }
        lines.push(ind + 'if ' + cond + ':');
        genBody(b.getInputTargetBlock('DO0'), indent + 1, lines);
        if (b.getInputTargetBlock('ELSE')) {
          lines.push(ind + 'else:');
          genBody(b.getInputTargetBlock('ELSE'), indent + 1, lines);
        }
        break;
      }
      case 'controls_repeat_ext':
        lines.push(ind + 'for i in range(' + genExpr(b, 'TIMES', 3) + '):');
        genBody(b.getInputTargetBlock('DO'), indent + 1, lines);
        break;
      case 'ww_forever':
        lines.push(ind + 'while True:');
        genBody(b.getInputTargetBlock('DO'), indent + 1, lines);
        break;
      default:
        break;
    }
  }

  function genBody(first, indent, lines) {
    var b = first;
    var before = lines.length;
    while (b) { genOne(b, indent, lines); b = b.getNextBlock(); }
    if (lines.length === before) lines.push(new Array(indent + 1).join('    ') + 'pass');
  }

  function genProgram() {
    var lines = [];
    lines.push('# MicroDuck 图形化程序（由积木自动生成，只读）');
    lines.push('# 运行目标：MicroDuck 双足机器鸭 / MuJoCo 浏览器内物理仿真');
    lines.push('');
    lines.push('import time');
    lines.push('import wwduck');
    lines.push('');
    var tops = ws.getTopBlocks(true);
    if (!tops.length) {
      lines.push('# 还没有积木：从左侧工具栏拖一块到工作区即可。');
    } else {
      tops.forEach(function (b) { genBody(b, 0, lines); });
    }
    return lines.join('\n');
  }

  function colorize(code) {
    var esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    var re = /(#[^\n]*)|("(?:[^"\\]|\\.)*")|\b(import|as|for|in|range|while|True|False|if|else|pass|print|time)\b|\b(duck|wwduck)\b|\b(\d+(?:\.\d+)?)\b/g;
    return esc.replace(re, function (m, cmt, str, kw, fn, num) {
      if (cmt) return '<span class="c">' + cmt + '</span>';
      if (str) return '<span class="s">' + str + '</span>';
      if (kw) return '<span class="k">' + kw + '</span>';
      if (fn) return '<span class="f">' + fn + '</span>';
      if (num) return '<span class="n">' + num + '</span>';
      return m;
    });
  }

  var codeTimer = null;
  function refreshCode() {
    var body = $('codeBody');
    if (!body) return;
    body.innerHTML = colorize(genProgram());
  }

  // ---------- 工程存取 ----------
  function serialize() {
    try { return B.serialization.workspaces.save(ws); } catch (e) { return null; }
  }

  function loadState(obj) {
    try {
      B.serialization.workspaces.load(obj, ws);
      return true;
    } catch (e) {
      console.warn('load error', e);
      return false;
    }
  }

  function autoSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var s = serialize();
      if (s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {} }
      refreshCode();
    }, 600);
  }

  function saveProject(download) {
    var s = serialize();
    if (!s) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
    if (download) {
      var xml = '';
      try { xml = B.Xml.domToPrettyText(B.Xml.workspaceToDom(ws)); } catch (e) { xml = ''; }
      var text = xml || JSON.stringify(s, null, 2);
      var blob = new Blob([text], { type: xml ? 'text/xml' : 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'microduck-program-' + Date.now() + (xml ? '.xml' : '.json');
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    }
    toast(download ? '已保存并下载工程文件' : '工程已保存');
    log('工程已保存（本地）', 'ok');
  }

  function newProject(force) {
    if (!force && !confirm('新建会清空当前工作区的积木，确定吗？')) return;
    ws.clear();
    localStorage.removeItem(LS_KEY);
    refreshCode();
    log('已新建空白工程', 'dim');
    toast('已新建空白工程');
  }

  // ---------- 初始化 ----------
  function initBlockly() {
    WW.defineBlocks();
    var theme = WW.buildTheme();

    ws = B.inject($('blocklyDiv'), {
      toolbox: WW.toolboxXml,
      theme: theme,
      renderer: 'zelos',
      media: './vendor/blockly/media/',
      grid: { spacing: 26, length: 2, colour: '#182631', snap: true },
      zoom: { controls: true, wheel: true, startScale: 0.82, minScale: 0.35, maxScale: 2.2, scaleSpeed: 1.06 },
      move: { scrollbars: true, drag: true, wheel: true },
      trashcan: true,
      sounds: false,
      oneBasedIndex: true
    });

    // 恢复上次工程，否则载入范例
    var restored = false;
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) restored = loadState(JSON.parse(raw));
    } catch (e) { restored = false; }
    if (!restored) loadState(WW.sampleState);

    // 中文变量名提示
    try { B.Msg['VARIABLE_DEFAULT_NAME'] = '变量'; } catch (e) {}

    ws.addChangeListener(function (ev) {
      if (ev && ev.isUiEvent) return;
      autoSave();
    });

    window.addEventListener('resize', function () { B.svgResize(ws); });
    setTimeout(function () { B.svgResize(ws); }, 60);
    refreshCode();
  }

  function bindUI() {
    $('btnRun').addEventListener('click', runProgram);
    $('btnStop').addEventListener('click', stopProgram);
    $('btnReset').addEventListener('click', function () {
      post({ source: 'wwduck-blocks', cmd: 'reset', id: ++state.cmdId });
      log('复位仿真位姿', 'dim');
      setHud('IDLE');
    });
    $('btnSave').addEventListener('click', function () { saveProject(true); });
    $('btnOpen').addEventListener('click', function () { $('fileInput').click(); });
    $('btnNew').addEventListener('click', function () { newProject(false); });
    $('btnClearLog').addEventListener('click', function () { $('logBody').innerHTML = ''; });

    $('fileInput').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        var ok = false;
        if (text.trim().charAt(0) === '{') {
          try { ok = loadState(JSON.parse(text)); } catch (e) { ok = false; }
        } else {
          try {
            var dom = B.Xml.textToDom(text);
            ws.clear();
            B.Xml.domToWorkspace(dom, ws);
            ok = true;
          } catch (e) { ok = false; }
        }
        if (ok) { toast('工程已载入：' + f.name); log('载入工程 ' + f.name, 'ok'); refreshCode(); autoSave(); }
        else { toast('文件解析失败'); log('工程文件解析失败', 'err'); }
        ev.target.value = '';
      };
      reader.readAsText(f);
    });

    var tabs = document.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(tabs, function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        var view = t.getAttribute('data-view');
        if (view === 'code') {
          // 隐藏 Blockly（其工具箱 z-index 很高，会盖在代码视图上）
          $('blocklyDiv').style.display = 'none';
          refreshCode();
          $('codeView').classList.remove('hidden');
        } else {
          $('codeView').classList.add('hidden');
          $('blocklyDiv').style.display = '';
          setTimeout(function () { B.svgResize(ws); }, 30);
        }
      });
    });

    $('btnCopy').addEventListener('click', function () {
      var code = genProgram();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(function () { toast('代码已复制'); },
          function () { toast('复制失败，请手动选择'); });
      } else {
        toast('当前浏览器不支持自动复制');
      }
    });

    // 快捷键：Ctrl+Enter 运行，Esc 停止
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runProgram(); }
      else if (e.key === 'Escape') { stopProgram(); }
    });
  }

  function boot() {
    initBlockly();
    bindUI();
    setEngineReady(false);
    log('工作台就绪：拖动积木 → 点「运行」→ 右侧机器鸭按程序动作', 'ok');
    log('提示：Ctrl+Enter 运行，Esc 停止', 'dim');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
