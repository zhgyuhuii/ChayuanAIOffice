// 启动等待层的名称二选一:此时 bundle 未加载、IPC 桥不可用,CSP 又禁内联脚本,
// 所以做成 public 下的外链小脚本,在首帧前按系统环境语言填入唯一名称。
;(function () {
  var zh = /^zh/i.test(navigator.language || '')
  // the OS chrome (Dock hover preview / Mission Control / Window menu) shows the
  // live page title, not the BrowserWindow's title option — the static <title>
  // ("ChaAI Office") would win once the page parses, so re-apply the same
  // locale rule to document.title here, at first frame.
  document.title = zh ? '察元AIOffice' : 'ChaAI Office'
  var el = document.querySelector('.boot-title')
  if (el) el.textContent = zh ? '察元AIOffice' : 'ChaAI Office'
})()
