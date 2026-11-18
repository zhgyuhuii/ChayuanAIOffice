# 发版测试报告 — ChaAI Office 1.0.18（六段 1.0.18.0.13.18）

> 2026-11-18。R41 随轮发版（上游 genoffice 0ac588ff..19a389b39 120 提交全吸收，tag v0.13.18，历轮最大单轮）+ 用户真机报告的 dsh 演示稿编辑链存量断根治，一并对外发布。
> 判定：**PASS**（四 pass 打包+装机冒烟+发布链三方对账全过；dsh 形态演示稿端到端实证）。

## 阶段 0 · 发版前置检查 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 仓库状态 | ✅ | main=17dd47e7a（R41 五步核对+三轮审查+真机测试全绿后），干净树起版 |
| aidooo 磁盘（R37 坑①） | ✅ | 99%→A/B 级清理（builder prune 1.9G+pre-deploy 快照+prerelease 副本+nginx truncate）→6G 空闲；旧 1.0.17 槽位（硬链接假占用，技能坑②）识别后清 |
| 工具链 | ✅ | zig/cargo-zigbuild/mingw 在位；gh 本地无=服务器中继口径沿例 |
| 签名/公证 | ✅ | 0 identities（R37-R40 同口径：未签名 dmg，公证钩子自跳过） |

## 阶段 1 · 版本 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本 Z+1 | ✅ | 1.0.17→1.0.18（root/shell/dsh-plugin+双 lock 五文件；14be28222） |
| 上游口径 | ✅ | chaofficeUpstreamVersion 0.12.852→**0.13.18**（R41 已落）；六段 **1.0.18.0.13.18** |

## 阶段 2 · sidecar 重编与九件打包 — PASS（两轮：首版+slides 修复重打）

| 项 | 结果 | 证据 |
|---|---|---|
| linux x64/aarch64 zigbuild（glibc 2.28） | ✅ | 10.8M/9.7M（R41 Rust：sparklines.rs 新模块+5 文件） |
| win x64 mingw | ✅ | xlsx-sidecar.exe 17.0M + **win-clipboard-helper.exe 1.5M（新 crate #2588）**双件 |
| mac universal | ✅ | dist:mac 内 lipo（beforePack 双架构断言） |
| 四 pass ×2 轮 | ✅ 全 EXIT 0 | 首版九件+「dsh 演示稿修复」重打九件（slides/tsx/server 改动进包）；mac dmg 232M+zip→win exe 189M→linux x64→arm64 |
| 架构逐件直验 | ✅ | dmg UDZO；exe PE32（NSIS 32 位桩）；deb 双架 sidecar ELF e_machine 0x3e/0xb7 对位；AppImage 双架 ELF；rpm `rpm -qp` chaoffice 1.0.18 x86_64 |
| dsh 链 | ✅ | chaoffice-1.0.18.tgz（173.8M，vendor sidecar 含 pptx-ops+新 web bundle）+ dist/chatop-chaoffice-1.0.18 |

## 阶段 3 · 发版前冒烟 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| Info.plist / asar | ✅ | CFBundleShortVersionString=CFBundleVersion=**1.0.18**；asar version=1.0.18、chaofficeUpstreamVersion=0.13.18 |
| 版本六段桥（CDP） | ✅ | `1.0.18.0.13.18`（150 桥键） |
| 首页品牌 | ✅ | 察元AIOffice 命中；GenOffice/Genspark 正文 0 |
| CLI 闭环 | ✅ | 打包版 cli `--version` → **1.0.18**；create ×2 → docs compare redline 输出（tracked changes w:ins/w:del 生成）；docs read 2 blocks |
| 单实例锁 | ✅ | 二次直启后主进程数仍 1 |
| **dsh 形态演示稿端到端** | ✅ | **本治理新增项**：staged sidecar 同源（5210）上 playwright 真浏览器：磁贴→新建演示稿（canvas 渲染）→插入表格（pptx.command→tbl 节点落画布，sourceId=tbl_0）→重镜像后复验再过；零 pageerror |

## 阶段 4 · tag 与 GitHub Release — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| tag 三仓 | ✅ | origin/gitee/pubmirror 三仓 tag 1.0.18（pubmirror 沿例只推 tag） |
| GitHub Release | ✅ | release **449196371** 九资产服务器中继全 201、SIZE_MATCH_ALL: true（body 覆盖 R41 全量内容） |

## 阶段 5 · aidooo.com 发布 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 旧版双侧清理 | ✅ | 1.0.17 槽位（installers+installer 挂载）删净 |
| 宿主硬链接十槽位 | ✅ | mac-arm64×2/windows-amd64/windows-arm64(exe 复用)/linux-amd64×3/linux-arm64×3 |
| DB 入库（db.js API） | ✅ | releases-admin.json office['1.0.18'] 十条目（db.js readDb/writeDb 真函数+publishManifest()；variant 沿 R35 坑④ 惯例）；**存量故障顺带修复：products.json 误写域清除+releases-admin office 段空段补齐（1.0.17 槽位清盘时 DB 空段，升级链已断——本次入库即恢复）** |
| 升级链验收 | ✅ | 公网 /api/version/office **latest=1.0.18**；/api/update/check 五平台 1.0.17→1.0.18 **updateAvailable=true**；Range **206**；**1MB 段 sha 三方一致**（5f3ec04c… 本地=aidooo=公网） |

## 阶段 6 · dsh 形态送达（察元AI OS）— PASS

| 项 | 结果 | 证据 |
|---|---|---|
| harness 重铺 | ✅ | chayuan-harness `build.mjs chatoffice` → desktop/resources/chatoffice **1.0.18** |
| OS app 原位覆盖 | ✅ | /Applications/察元AI OS.app/Contents/Resources/chatoffice **1.0.18**（651M，rsync --delete） |
| staged 一致性 | ✅ | shared/plugins/bundled/chaoffice（dist-chatop 自铺+重镜像）1.0.18；三方 main.ts/web bundle sha 同源 |
| 桌面进程 | ✅ | 重铺全程桌面未运行（0 进程），启动后内容签名一致不回滚 |

## 治理记录：dsh 演示稿编辑链存量断（用户真机报告根治）

> 用户报告「dsh 形态演示稿基本不可用：无法插入图片/表格等一切内容、新演示稿等失效」。诊断=**1.0.17 存量缺口**（非 R41 回归），两层断链 + tsx 链三坑，17dd47e7a 全量根治并端到端实证。

1. **编辑动词缺位**：web-bridge slides shim 只有 open/new/save 三端点，insertImage/addTable 等动词全部结构化 reject（shim-factory 动词法不降级）。修复=server pptx service 加 `command` 端点（runTxn+buildOneRenderSlide 单页重建，返回 renderer 契约 {slide,sourceIds}）+ shim 补动词族（addTable/addImageBytes/insertImage→fs.pick/remoteImage/clipboardProbe 消音）。
2. **新建意图丢失**：web 壳 tab-manager 对 newBlank 只开空 iframe（sheets 有 consumeNewBlankWorkbook 握手、slides 无）——boot 流（consumePendingOpen null→bootBlank→newBlank）实测已通，配合 shim newBlank server 管线。
3. **tsx 链三坑**（dsh sidecar 源码运行态）：`?raw`/`?asset` ESM import 无 loader（ts-asset loader 注册 ESM resolve/load 双钩+裸包名两段解析）；`.cts` 强制 CJS 文件 require 不认（tsx-assets 补 .cts/.mts 转发）；harfbuzz/Carlito `?asset` 双模运行时解析兜底（bundler 动态 mjs import + CJS hooks fallback，炸点全 catch）。
4. **打包面连带**：package-embedded PACKAGES 补 pptx-ops（npm install synthetic workspace 解析失败教训）+ server package.json 依赖登记。

## 追加治理：dsh/web 新建表格 trim 崩溃（用户真机报告，add203af8）

> 用户报告「新建表格文件很慢 基本上无法新建」。诊断=web shim sheets impl 缺 `getUserDisplayName`（get* 安全降级返回 undefined → threaded-comments setAuthor(name.trim()) 炸断 boot 链，用户感知为慢/失败）。修复=sheets impl 补空串兜底；**服务链本身实测 570ms/次（两次连续）**，零错误。dsh tgz/staged/OS app 三方已重铺（含修复）。注：桌面 sidecar 首启含 xlsx wasm 编译一次性开销（~20s），属首次成本非回归。

## 追加治理 2：安装包新建表格「正在打开工作簿…」永挂（用户报告，876e0c96f）

> 安装包（Electron 形态）新建表格卡「正在打开工作簿…」不撤。诊断=**R41 链上采纳的上游 #2545 撤屏增强**（finishOpening 绑 onInitialRangeLoaded）与流式懒加载语义冲突：该回调只在「无活动工作簿」分支触发，空白底簿（1 行）走激活分支永不回调 → 撤屏永挂。main 基线的 `finally { workbookOpeningRef.current = false }` 无条件语义才是对的。
> 修复=对齐 main finally 语义（保留 setOpeningWorkbook 增强与幂等 finishOpening）。
> **装机验证时发现重打 dmg 实为旧产物**（dist:mac 的 electron-builder 增量缓存复用旧 modules/sheets——`ls -S` 对比 out/ 与安装内 bundle 名，DrJyyhDd 旧 vs xn9R9blU 新），重装正确 dmg 后端到端复验：**新建即撤屏（首个 2s 探针起 opening=false），连开四 tab 全 OK**。
> 送达链：mac dmg/zip 重传 aidooo（DB sha/size 刷新+publishManifest，公网 1MB 段 945550bc… 三方一致）+ GitHub 两资产 delete+reupload 201；其余平台安装包同源代码已在首轮构建中（无此 bug 暴露差异，不需重传）。

## 附注

- 中继脚本 /root/gh-upload-1.0.18.mjs（1.0.17 版 sed+body 拼接，日志 /root/gh-upload-1.0.18.log）。
- **新坑记账**：①dsh 形态 slides 编辑链自 1.0.15 起仅为「打开/保存」闭环，编辑动词从未接线——**发版冒烟只验页面 200 会漏交互层**，dsh 形态验证需逐端点真机交互（本轮 playwright 真浏览器路径为标准）；②tsx `--import` 链的 ESM hooks（register）与 CJS hooks（Module._extensions）覆盖面不同，`?asset/?raw` 双语义须双路兜底；③products.json 与 releases-admin.json 是两个域（office 版本在 releases-admin），入库脚本勿串。
- 飞腾真机（Linux/ARM64 deb）：沿 R32 起不可达附注降级；deb aarch64 ELF 字节级直验+同管线真机史兜底。
