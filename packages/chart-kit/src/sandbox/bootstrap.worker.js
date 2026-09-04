/**
 * 图表沙箱 Worker(canonical 源,纯 JS、无导入):
 * - 浏览器:由 Vite 以 `new Worker(new URL('./bootstrap.worker.js', import.meta.url))`
 *   作为真实网络资源发出——网络 Worker 不继承文档 meta CSP(文档 CSP 禁
 *   unsafe-eval 会拦死 blob Worker 的 new Function),自身响应无 CSP 头,
 *   eval 只存在于这个隔离线程里(Q6 边界不放松)。
 * - Node(采集管线/vitest):runner 经 `?raw` 读入本文件,worker_threads eval 执行。
 *
 * 职责:
 * 1. 建立 postMessage 通道(浏览器 self / Node parentPort 二选一);
 * 2. 收紧全局:禁 网络/DOM 加载/定时器/进程/嵌套 Worker(Q6 一期纯 JS 沙箱);
 * 3. 收到 {__chartkit_sandbox__, code} 后用间接 eval 执行,尾部追加捕获语句,
 *    使 `option = {...}`(裸赋值)/ `const option` / `var option` 三种官方写法都能取到;
 * 4. 死循环由主线程超时 terminate 兜底(硬杀)。
 *
 * 注意:生成的 Function 体必须保持 sloppy mode——官方示例依赖裸 `option = ` 赋值。
 */
;(function () {
  'use strict'
  var G = typeof globalThis !== 'undefined' ? globalThis : self
  var post
  if (
    typeof self !== 'undefined' &&
    typeof self.postMessage === 'function' &&
    typeof window === 'undefined'
  ) {
    post = function (msg) {
      self.postMessage(msg)
    }
  } else if (typeof require === 'function') {
    var threads = require('node:worker_threads')
    post = function (msg) {
      threads.parentPort.postMessage(msg)
    }
  } else {
    throw new Error('chart sandbox: no postMessage channel')
  }

  var FORBIDDEN = [
    'fetch',
    'XMLHttpRequest',
    'importScripts',
    'setTimeout',
    'setInterval',
    'setImmediate',
    'requestAnimationFrame',
    'WebSocket',
    'EventSource',
    'Worker',
    'SharedArrayBuffer',
    'Atomics',
    'process',
    'require',
    'module',
    'exports',
    'global',
  ]
  FORBIDDEN.forEach(function (k) {
    try {
      delete G[k]
    } catch (e) {
      /* ignore */
    }
    try {
      Object.defineProperty(G, k, {
        get: function () {
          throw new Error('chart sandbox: ' + k + ' is disabled')
        },
        configurable: true,
      })
    } catch (e) {
      /* ignore */
    }
  })

  function stringifyWithFns(v) {
    return JSON.stringify(v, function (k, val) {
      if (typeof val === 'function') return { __chartkit_fn__: String(val) }
      return val
    })
  }

  // 收拢 console:避免示例的 console.log 漏进宿主 stdout,并随结果带回便于诊断
  var logs = []
  var clampLogs = function (args) {
    try {
      logs.push(
        Array.prototype.slice
          .call(args)
          .map(function (a) {
            return typeof a === 'object' ? JSON.stringify(a) : String(a)
          })
          .join(' '),
      )
      if (logs.length > 20) logs.shift()
    } catch (e) {
      /* ignore */
    }
  }
  if (typeof console !== 'undefined') {
    ;['log', 'info', 'warn', 'error'].forEach(function (m) {
      if (typeof console[m] === 'function') {
        console[m] = function () {
          clampLogs(arguments)
        }
      }
    })
  }

  function onMessage(ev) {
    var data = ev && ev.data ? ev.data : ev
    if (!data || data.__chartkit_sandbox__ !== true) return
    var captured
    try {
      var fn = new Function(
        data.code + '\n;return (typeof option !== "undefined" ? option : undefined);',
      )
      captured = fn()
    } catch (e) {
      post({
        __chartkit_sandbox__: true,
        ok: false,
        error: String((e && e.message) || e),
        logs: logs,
      })
      return
    }
    if (captured === undefined || captured === null || typeof captured !== 'object') {
      post({
        __chartkit_sandbox__: true,
        ok: false,
        error: 'no option captured: code must assign option = {...}',
        logs: logs,
      })
      return
    }
    var json
    try {
      json = stringifyWithFns(captured)
    } catch (e) {
      post({
        __chartkit_sandbox__: true,
        ok: false,
        error: 'option not serializable: ' + String((e && e.message) || e),
        logs: logs,
      })
      return
    }
    post({ __chartkit_sandbox__: true, ok: true, optionJson: json, logs: logs })
  }

  if (
    typeof self !== 'undefined' &&
    typeof self.addEventListener === 'function' &&
    typeof window === 'undefined'
  ) {
    self.addEventListener('message', onMessage)
  } else {
    threads.parentPort.on('message', onMessage)
  }
})()
