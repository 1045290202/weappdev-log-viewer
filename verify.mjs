import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('./log-viewer.html', import.meta.url), 'utf8');

function extract(type) {
  const re = new RegExp('<script type="text/wad-' + type + '">([\\s\\S]*?)<\\/script>');
  const m = re.exec(html);
  assert.ok(m, 'missing wad-' + type + ' script');
  return m[1];
}

const logicSrc = extract('logic');
const renderSrc = extract('render');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeConsole() {
  const calls = [];
  const c = {
    log() { calls.push(['log', Array.from(arguments)]); },
    info() { calls.push(['info', Array.from(arguments)]); },
    warn() { calls.push(['warn', Array.from(arguments)]); },
    error() { calls.push(['error', Array.from(arguments)]); },
    debug() { calls.push(['debug', Array.from(arguments)]); },
    dir() { calls.push(['dir', Array.from(arguments)]); },
    table() { calls.push(['table', Array.from(arguments)]); },
    trace() { calls.push(['trace', Array.from(arguments)]); },
    assert(cond) { calls.push(['assert', [cond]]); },
    time(label) { calls.push(['time', [label]]); },
    timeEnd(label) { calls.push(['timeEnd', [label]]); }
  };
  return { consoleObj: c, calls };
}

function makeLogicLayer() {
  const registered = new Map();
  const emitted = [];
  const handlers = { attach: [], detach: [], pageChange: [], network: [], storageWrite: [] };
  const store = {};
  const layer = {
    appid: 'wx-test-appid',
    storage: {
      getSync(k) { return store[k]; },
      setSync(k, v) { store[k] = v; }
    },
    emit(name, data) { emitted.push({ name, data }); },
    register(name, fn) { registered.set(name, fn); },
    onAttach(fn) { handlers.attach.push(fn); return () => {}; },
    onDetach(fn) { handlers.detach.push(fn); return () => {}; },
    onPageChange(fn) { handlers.pageChange.push(fn); return () => {}; },
    onNetwork(fn) { handlers.network.push(fn); return () => {}; },
    onStorageWrite(fn) { handlers.storageWrite.push(fn); return () => {}; },
    page() { return { route: 'pages/index/index', options: { id: '1' } }; },
    log() {}
  };
  return { layer, registered, emitted, handlers };
}

function makeWx() {
  const h = { error: [], rejection: [] };
  const wx = {
    onError(fn) { h.error.push(fn); },
    offError(fn) {
      const i = h.error.indexOf(fn);
      if (i >= 0) h.error.splice(i, 1);
    },
    onUnhandledRejection(fn) { h.rejection.push(fn); },
    offUnhandledRejection(fn) {
      const i = h.rejection.indexOf(fn);
      if (i >= 0) h.rejection.splice(i, 1);
    }
  };
  return { wx, h };
}

function newContext({ consoleObj, wx, layer }) {
  const sandbox = {
    console: consoleObj,
    wx,
    wadLogicLayer: layer,
    setTimeout,
    clearTimeout,
    setInterval: function () { return 0; },
    clearInterval: function () {},
    Date,
    JSON,
    Math
  };
  return vm.createContext(sandbox);
}

async function testLogic() {
  const { consoleObj, calls } = makeConsole();
  const { layer, registered, emitted, handlers } = makeLogicLayer();
  const { wx, h } = makeWx();
  const originalLog = consoleObj.log;
  const ctx = newContext({ consoleObj, wx, layer });

  vm.runInContext(logicSrc, ctx, { filename: 'wad-logic.js' });
  assert.equal(typeof registered.get('lv:meta'), 'function', 'lv:meta registered');

  // attach = 注入完成
  handlers.attach.forEach((fn) => fn('wx-test-appid'));

  // 基础 console
  consoleObj.log('hello', { a: 1 });
  consoleObj.info('fmt %s / %d / %j', 'ok', 7, { x: 1 });
  consoleObj.warn('careful', new Date(0));
  consoleObj.error(new Error('boom'));
  consoleObj.debug('hidden-debug');
  consoleObj.dir({ deep: { a: [1, 2, 3] } });
  consoleObj.table([{ a: 1 }]);
  consoleObj.trace('trace-here');
  consoleObj.assert(false, 'assert-failed');
  consoleObj.time('t1');
  await wait(15);
  consoleObj.timeEnd('t1');

  // 循环引用
  const cir = { name: 'circular' };
  cir.self = cir;
  consoleObj.log('circular', cir);

  // 透传原始 console
  assert.ok(calls.length > 0, 'original console mirrored');

  await wait(400);

  const meta1 = registered.get('lv:meta')();
  assert.ok(meta1.newestSeq > 0, 'seq advanced');
  assert.equal(meta1.appid, 'wx-test-appid', 'appid');
  assert.equal(meta1.page, 'pages/index/index', 'route');
  assert.equal(meta1.hooks.console, true, 'console hook active');

  const fetched = registered.get('lv:fetch')(0, 500);
  const items = fetched.items;
  assert.ok(items.length >= 10, 'entries captured: ' + items.length);
  assert.ok(items.some((e) => e.text === 'hello {a: 1}'), 'object formatting');
  assert.ok(items.some((e) => e.text.indexOf('fmt ok / 7 / {"x":1}') >= 0), 'printf formatting');
  assert.ok(items.some((e) => e.text.indexOf('careful') === 0 && e.level === 'warn'), 'warn level');
  assert.ok(items.some((e) => e.level === 'error' && e.stack && e.stack.indexOf('Error') >= 0), 'error stack');
  assert.ok(items.some((e) => e.text.indexOf('trace-here') >= 0 && e.level === 'debug' && e.stack), 'trace -> debug');
  assert.ok(items.some((e) => e.text.indexOf('assert-failed') >= 0 && e.level === 'error'), 'assert');
  assert.ok(items.some((e) => e.text.indexOf('t1:') >= 0 && /ms$/.test(e.text.trim())), 'timeEnd');
  assert.ok(items.some((e) => e.text.indexOf('[Circular]') >= 0), 'circular marker');

  // 未捕获异常
  h.error.forEach((fn) => fn({ message: 'kaboom', stack: 'Error: kaboom\n  at x' }));
  h.rejection.forEach((fn) => fn({ reason: { message: 'rejected' } }));
  let meta2 = registered.get('lv:meta')();
  assert.ok(meta2.newestSeq > meta1.newestSeq, 'error events captured');

  // 页面路由
  const beforePage = registered.get('lv:meta')().newestSeq;
  handlers.pageChange.forEach((fn) => fn({ route: 'pages/cart/cart', options: { a: 1 } }));
  const pageItems = registered.get('lv:fetch')(beforePage, 10).items;
  assert.ok(pageItems.some((e) => e.kind === 'page' && e.text.indexOf('pages/cart/cart') >= 0), 'page marker');

  // 网络默认关闭
  const beforeNet = registered.get('lv:meta')().newestSeq;
  handlers.network.forEach((fn) => fn({ method: 'GET', url: 'https://example.com/a', status: 200 }));
  assert.equal(registered.get('lv:meta')().newestSeq, beforeNet, 'network off by default');
  registered.get('lv:setOptions')({ captureNetwork: true });
  handlers.network.forEach((fn) => fn({ method: 'POST', url: 'https://example.com/b', status: 500 }));
  handlers.network.forEach((fn) => fn({ method: 'GET', url: 'https://example.com/c', status: 200 }));
  const netItems = registered.get('lv:fetch')(beforeNet, 10).items.filter((e) => e.kind === 'net');
  assert.equal(netItems.length, 2, 'network entries');
  assert.ok(netItems.some((e) => e.level === 'warn' && e.text.indexOf('500') >= 0), 'network 500 -> warn');
  assert.ok(netItems.some((e) => e.level === 'debug' && e.text.indexOf('200') >= 0), 'network 200 -> debug');

  // Storage 默认关闭
  const beforeStore = registered.get('lv:meta')().newestSeq;
  handlers.storageWrite.forEach((fn) => fn({ op: 'set', key: 'token', value: 'abc' }));
  assert.equal(registered.get('lv:meta')().newestSeq, beforeStore, 'storage off by default');
  registered.get('lv:setOptions')({ captureStorage: true });
  handlers.storageWrite.forEach((fn) => fn({ op: 'set', key: 'token', value: { v: 1 } }));
  const storeItems = registered.get('lv:fetch')(beforeStore, 10).items.filter((e) => e.kind === 'storage');
  assert.equal(storeItems.length, 1, 'storage entry');
  assert.ok(storeItems[0].text.indexOf('token') >= 0, 'storage key');

  // 渲染层 ingest
  const beforeIngest = registered.get('lv:meta')().newestSeq;
  const ing = registered.get('lv:ingest')([
    { at: Date.now(), level: 'warn', kind: 'console', source: 'render', text: 'from-render', page: 'https://usr/page' }
  ]);
  assert.equal(ing.n, 1, 'render ingest');
  const renderItems = registered.get('lv:fetch')(beforeIngest, 10).items;
  assert.ok(renderItems.some((e) => e.source === 'render' && e.text === 'from-render'), 'render source');

  // 测试日志
  registered.get('lv:test')();
  const testItems = registered.get('lv:fetch')(0, 1000).items;
  assert.ok(testItems.some((e) => e.text.indexOf('[lv-test] 普通日志') >= 0), 'lv:test');
  assert.ok(testItems.some((e) => e.text.indexOf('[Circular]') >= 0), 'lv:test circular');

  // 诊断
  const diag = registered.get('lv:diag')();
  assert.equal(diag.version, '1.0.3', 'diag version');
  assert.equal(diag.hooks.console, true, 'diag console hook');
  assert.equal(diag.hooks.error, true, 'diag error hook');

  // 清空
  const cleared = registered.get('lv:clear')();
  assert.ok(cleared.newestSeq >= diag.buffer.newestSeq, 'clear keeps seq');

  // detach 还原 console
  handlers.detach.forEach((fn) => fn());
  assert.equal(consoleObj.log, originalLog, 'console.log restored');
  assert.equal(h.error.length, 0, 'offError called');
  assert.equal(h.rejection.length, 0, 'offUnhandledRejection called');

  const afterDetach = registered.get('lv:meta')().newestSeq;
  consoleObj.log('after-detach');
  assert.equal(registered.get('lv:meta')().newestSeq, afterDetach, 'no capture after detach');

  // 自愈：面板调用 lv:rehook 后恢复采集
  const re = registered.get('lv:rehook')();
  assert.equal(re.ok, true, 'rehook ok');
  assert.equal(re.hooks.console, true, 'rehook console hook');
  const beforeRehook = registered.get('lv:meta')().newestSeq;
  consoleObj.log('after-rehook');
  await wait(400);
  assert.ok(registered.get('lv:meta')().newestSeq > beforeRehook, 'rehook resumes capture');

  // 重新注入：同一 console 对象，第二个实例接管，不重复记
  const logic2 = makeLogicLayer();
  // 复用同一个 console，但新的 layer
  const ctx2 = newContext({ consoleObj, wx, layer: logic2.layer });
  vm.runInContext(logicSrc, ctx2, { filename: 'wad-logic-2.js' });
  logic2.handlers.attach.forEach((fn) => fn('wx-test-appid'));
  const base = logic2.registered.get('lv:meta')().newestSeq;
  consoleObj.log('second-generation');
  await wait(400);
  const secondItems = logic2.registered.get('lv:fetch')(0, 100).items.filter((e) => e.text === 'second-generation');
  assert.equal(secondItems.length, 1, 'no duplicate after reinjection');
  assert.ok(logic2.registered.get('lv:meta')().newestSeq > base, 'second generation captures');

  // 旧实例 detach 不能关掉新实例
  handlers.detach.forEach((fn) => fn());
  const beforeOldDetach = logic2.registered.get('lv:meta')().newestSeq;
  consoleObj.log('after-old-detach');
  await wait(400);
  assert.ok(logic2.registered.get('lv:meta')().newestSeq > beforeOldDetach, 'old detach does not kill new hook');

  console.log('logic tests passed; captured', testItems.length, 'entries in test buffer');
}

function makeRenderLayer() {
  const calls = [];
  const registered = new Map();
  const handlers = { attach: [], detach: [] };
  const layer = {
    logicLayer: {
      call(name, items) {
        calls.push({ name, items });
        return Promise.resolve({ ok: true, n: items.length });
      }
    },
    onAttach(fn) { handlers.attach.push(fn); return () => {}; },
    onDetach(fn) { handlers.detach.push(fn); return () => {}; }
  };
  return { layer, calls, handlers };
}

function makeWindow() {
  const listeners = { error: [], unhandledrejection: [], pagehide: [] };
  const { consoleObj } = makeConsole();
  const win = {
    console: consoleObj,
    addEventListener(name, fn) {
      (listeners[name] || (listeners[name] = [])).push(fn);
    },
    removeEventListener(name, fn) {
      const arr = listeners[name] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
  };
  return { win, listeners, consoleObj };
}

async function testRender() {
  const { layer, calls, handlers } = makeRenderLayer();
  const { win, listeners, consoleObj } = makeWindow();
  const originalLog = consoleObj.log;
  const sandbox = {
    window: win,
    console: consoleObj,
    wadRenderLayer: layer,
    location: { href: 'https://usr/app-service/page.html' },
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Math
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(renderSrc, ctx, { filename: 'wad-render.js' });

  consoleObj.log('render-log', { a: 1 });
  consoleObj.warn('render-warn');
  consoleObj.error(new Error('render-err'));
  listeners.error.forEach((fn) => fn({ message: 'window-error', filename: 'x.js', lineno: 1, colno: 2, error: new Error('window-error') }));
  listeners.unhandledrejection.forEach((fn) => fn({ reason: { message: 'reject-render' } }));
  await wait(400);

  const all = calls.flatMap((c) => c.items || []);
  assert.ok(all.some((e) => e.text === 'render-log {a: 1}' && e.source === 'render'), 'render log');
  assert.ok(all.some((e) => e.level === 'warn' && e.text === 'render-warn'), 'render warn');
  assert.ok(all.some((e) => e.level === 'error' && e.text.indexOf('render-err') >= 0 && e.stack), 'render error');
  assert.ok(all.some((e) => e.kind === 'exception' && e.text.indexOf('window-error') >= 0), 'window error');
  assert.ok(all.some((e) => e.kind === 'exception' && e.text.indexOf('reject-render') >= 0), 'unhandled rejection');

  // detach 还原
  handlers.detach.forEach((fn) => fn());
  assert.equal(consoleObj.log, originalLog, 'render console restored');
  assert.equal(listeners.error.length, 0, 'error listener removed');

  // 重新注入不重复
  const layer2 = makeRenderLayer();
  const ctx2 = vm.createContext({
    window: win, console: win.console, wadRenderLayer: layer2.layer,
    location: { href: 'https://usr/app-service/page.html' },
    setTimeout, clearTimeout, setInterval: function () { return 0; }, clearInterval: function () {}, Date, JSON, Math
  });
  vm.runInContext(renderSrc, ctx2, { filename: 'wad-render-2.js' });
  layer2.handlers.attach.forEach((fn) => fn());
  win.console.log('second-render');
  await wait(400);
  const all2 = layer2.calls.flatMap((c) => c.items || []).filter((e) => e.text === 'second-render');
  assert.equal(all2.length, 1, 'render no duplicate after reinjection');

  console.log('render tests passed; forwarded', all.length, 'entries');
}

async function testGameBridge() {
  const { consoleObj } = makeConsole();
  const { layer, registered, handlers } = makeLogicLayer();
  const { wx } = makeWx();
  let patchExpr = '';
  let servedGameLog = false;

  layer.debugger = {
    enable() { return Promise.resolve({ ok: true }); },
    contexts() {
      return Promise.resolve({ items: [
        { id: 1, name: 'MainContext' },
        { id: 2, name: 'WxaSub', isDefault: true }
      ] });
    },
    evalGlobal(expr, byValue, ctxId) {
      if (expr === 'typeof GameGlobal') {
        return Promise.resolve({ value: ctxId === 2 ? 'object' : 'undefined' });
      }
      if (expr.indexOf('__wadLVPatched') >= 0 && expr.indexOf('methods') >= 0) {
        patchExpr = expr;
        return Promise.resolve({ value: 'patched:8' });
      }
      if (expr.indexOf('splice') >= 0) {
        if (!servedGameLog) {
          servedGameLog = true;
          return Promise.resolve({ value: [
            { level: 'log', at: Date.now(), text: 'game-hello', stack: '' }
          ] });
        }
        return Promise.resolve({ value: [] });
      }
      return Promise.resolve({ value: {
        gameGlobal: ctxId === 2 ? 'object' : 'undefined',
        hasConsole: true,
        logType: 'function',
        directWrapper: false,
        bridgeWrapper: ctxId === 2,
        hasMarker: false,
        writable: true,
        configurable: true,
        accessor: false,
        logs: 0
      } });
    }
  };

  const ctx = vm.createContext({
    console: consoleObj,
    wx,
    wadLogicLayer: layer,
    setTimeout,
    clearTimeout,
    setInterval: function () { return 0; },
    clearInterval: function () {},
    Date,
    JSON,
    Math
  });
  vm.runInContext(logicSrc, ctx, { filename: 'wad-logic-game.js' });
  handlers.attach.forEach((fn) => fn('wx-game'));
  await wait(150);

  const probe = await registered.get('lv:probe')();
  assert.equal(probe.contexts.length, 2, 'probe contexts');
  assert.ok(probe.results.some((r) => r.state && r.state.gameGlobal === 'object'), 'probe game context');

  const items = registered.get('lv:fetch')(0, 500).items;
  assert.ok(items.some((e) => e.text === 'game-hello' && e.source === 'game'), 'game log ingested');
  assert.ok(patchExpr.length > 0, 'patch expression captured');

  const gameConsole = makeConsole();
  const gameSandbox = { GameGlobal: {}, console: gameConsole.consoleObj, Date, JSON, Math };
  const gameCtx = vm.createContext(gameSandbox);
  const status = vm.runInContext(patchExpr, gameCtx, { filename: 'game-patch.js' });
  assert.equal(status, 'patched:8', 'game patch status');

  gameConsole.consoleObj.log('hello', { a: 1 });
  gameConsole.consoleObj.error(new Error('oops'));
  const logs = gameSandbox.GameGlobal.__wadLVLogs;
  assert.ok(logs.length >= 2, 'game buffer');
  assert.ok(logs.some((x) => x.text.indexOf('hello') >= 0), 'game patch text');
  assert.ok(logs.some((x) => x.level === 'error' && x.stack), 'game patch stack');

  console.log('game bridge tests passed; patch length', patchExpr.length);
}

await testLogic();
await testGameBridge();
await testRender();
console.log('ALL TESTS PASSED');
