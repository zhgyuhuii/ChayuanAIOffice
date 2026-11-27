# R46 上游同步真机测试报告（dev CDP + CLI 双通道，2026-11-28）

> 对象：main 27f58c7d5（sync/46-upstream 合并+三轮审查存档，六段 1.0.22.0.13.886）。
> 方法：`build:all` 产物 + `electron apps/shell --remote-debugging-port=9223` + node WebSocket CDP `Runtime.evaluate` 注入；CLI 侧 `packages/cli/dist/chaoffice.cjs` 真机闭环。
> 前置：阶段 0 自动化门禁已在合并轮完成——全量根套件 38 工作区 exit 0（直捕获）/typecheck 0/lint 0 error/check:* 十二门/build:web/cargo 338/品牌零新增（详见台账 §R46）。

## 阶段 1 · dev 真机基线 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本六段桥 | ✅ | CDP `window.chaOffice.getAppVersion()` → **"1.0.22.0.13.886"**（Home 页） |
| 首页品牌 | ✅ | Home/Sheets/docs 三页 `genoffice|GenOffice` 正文扫描 **0** |
| 渲染 scheme 在役 | ✅ | 编辑页 URL `chaoffice-app://sheets/index.html?mode=tab`、`chaoffice-app://docs/…` 正常加载（#2997 改动的 renderer-scheme 基础面无回归） |
| GUI 打开链 | ✅ | `chaoffice open` book.xlsx+hl-frame.docx 双开成功（zip-gate #2999 加固对正常档案零误伤） |
| docs 编辑页 | ✅ | ProseMirror editable；CLI 编辑内容「para ONE edited」与超链接文本「framed link」在屏渲染 |
| build:all | ✅ | exit 0（八工作区产物链） |

## 阶段 2 · R46 新特性/加固逐项 — PASS（附注 3 项）

| 项 | 来源 | 真机证据 |
|---|---|---|
| **#2997 生成图缩略图同源服务** | renderer-scheme `/generated-images/` | CDP 在 `chaoffice-app://` 页 fetch：store 内 UUID 名 PNG → **200 + content-type image/png + 70 字节精确命中**；路径穿越 `..%2F..%2Fetc%2Fpasswd` → **404**；非 UUID 名 → **404**（RE 白名单拒绝生效） |
| **#2982 超链接 frame/location 往返保留** | import 保留 tgtFrame/docLocation | 手工注入 `w:tgtFrame="_blank" w:docLocation="page-two" w:history="1"` 的 docx 经 CLI `docs apply findReplace` 真实编辑链路保存后，三属性**逐字保留**；重开在屏渲染 |
| **#2893 Rust 引擎链（quick-xml 0.42/calamine 0.38/DecodingReader）** | xlsx-engine crates 升级 | CLI create xlsx（CJK/emoji 全角混合）→ sheet read 往返逐格正确；应用内打开正常；cargo 338 测试含 legacy code page/UTF-16 BOM 两编码测试修复 |
| **#2999 EOCD 防伪（zip64 融合后）** | zip-gate | 正常 xlsx 应用内打开零误伤（上）；zip64 三红已修、22/22 单测绿；注释走私负例由单测钉 |
| **#3003 CSV 引号空字段成格** | csv-import | 应用打开管线在役；格子级断言为 canvas 渲染不适用 DOM 断言（附注 1），xlsx-gateway 530 单测含新用例绿 |
| **#3002 extractPagesBytes 页索引去重** | pdf | 单测绿（1374）；CLI 无 extract 直达面（附注 2） |
| **#2923 滚轮缩放共享手势** | ui/wheel-zoom | 三端新测试（docs/sheets/slides wheel-zoom stream/burst）单测全绿；GUI 合成滚轮事件不在 CDP 断言面（附注 3） |
| **#2991 ScreenTips 避让 / #2907 网格线精度+缩略滚动延迟 / #2996 EMF 上限 / #2976/#2978 页眉图片链 / #2979 $ 字面化 / #2977 customXml / #2998/#3001/#3005/#3007/#3008/#3009/#3010 非有限值族** | 各引擎 | 引擎/组件单测全绿覆盖（ui 373/docx-engine 3222/pptx-engine 1378/pdf 1374/hwp 58/xlsx-gateway 530/zip-gate 22）；均为防御性或视觉微调，无 GUI 断言面 |

## 附注

1. **CSV 格子级 GUI 断言**：sheets 网格为 canvas 渲染，innerText 不含格文本；#3003 的行为断言由 xlsx-gateway csv-import 单测钉（含上游新用例），应用管线在役由 open 链证明。
2. **pdf 页提取**：CLI 未暴露 extract 页面子命令；#3002 去重逻辑由 apps/pdf 单测覆盖（1374 绿）。
3. **滚轮缩放/ScreenTips**：合成滚轮事件与悬停提示不在 CDP 断言面；三端 wheel-zoom 流式测试+ui 373 单测覆盖，装机冒烟可人工复核。

## 判定

**PASS**（阶段 1/2 全过；附注 3 项均有明确断言面归因+单测覆盖，留装机冒烟清单）。
