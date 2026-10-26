# 1.0.13 发版测试报告（R35 · 上游 v0.12.115）

- 日期：2026-10-27
- 版本：六段 **1.0.13.0.12.115**（apps/shell/package.json `version`=1.0.13 + `chaofficeUpstreamVersion`=0.12.115；上游终点 c8bfff60 = tag v0.12.115）
- 上游区间：28cee5ca..c8bfff60，37 提交全吸收（36 独立修/特性逐个 cherry-pick + 10-26 快照巨件 #2222 全量 3-way）

## 阶段 0 · 全量自动化测试 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| typecheck 全仓 | ✅ 0 错误 | 7 app + 27 package 逐个 `tsc --noEmit` 全 0（含 tr 第 22 语言接线后的全量表 parity） |
| vitest 全工作区 | ✅ 0 FAIL | 链式跑至 shell 停点后逐个补跑：shell 1275/1275（packaged-cli-version 5 用例按 linux x64 ELF 暂存法通过，宿主 Mach-O 已还原）、slides 1534、pdf 1001、markdown 1393、web-bridge 18、server 34、web 4；i18n→…→docs/sheets 链段全绿；docx-engine 1894+（含新 empty-instruction-field 3 用例）、ai-provider（native-admission 9/9）、xlsx-sidecar 10/10（含 #2136 加密/解密用例） |
| lint | ✅ 0 error（25 warning 基线） | `npm run lint` 终版 25 problems (0 errors)；修复 4 处 tr 土耳其语窄空格 no-irregular-whitespace + html AiPanel/pdf App 死导入 |
| cargo test | ✅ 273/273 | xlsx-engine 273 passed 0 failed |
| Rust fn 两向审计 | ✅ 零缺失 | 上游 c8bfff60 全部 .rs fn 集 − 本地 fn 集 = ∅（R29 防线延续） |
| 品牌 grep | ✅ 豁免外零新增 | GenOffice/Genspark 用户可见串全部清洗（tr shard 值、cli help compare default、pdf ribbonAiAssistant tr 行、sheets tr 错误文案、shell tr new*/menuNew* 去 AI 前缀）；存量基线（docs-skill off-note、GensparkMark 导出名、注释）保持 |

### 门禁期间修复（同轮闭环）

1. **快照 take-theirs 组 43 文件补落盘**（0f6a0b171）：3-way 分类脚本 take-theirs 分支只登记未写盘——parse-props fieldsNested/empty-instruction 豁免、docx compare.ts 演进、wiki-create 全文、image-edit、global-shortcuts 等 43 文件静默漏落，逐文件取上游补齐 + 品牌重放。
2. **tr 进程字典归一**：shell strings/main-index tr 块的 new*/menuNew* 去 AI 前缀（本地钉名纪律）、menuNewMarkdown 钉 'Markdown'、Genspark 值清洗。
3. **R31 #1944 回归恢复**：快照 3-way 洗掉 ChatPanel sessionUsage 读点（ChatPanel 为本地独有文件无上游接替），composer 会话用量 chip 渲染恢复。
4. **cli help 品牌漏网**（R33 #2119 引入）：docs compare 帮助行 "compare default: GenOffice" → "ChaAI Office"，九件包随之重打。

## 阶段 1 · 打包与安装 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 清理历史产物 | ✅ | apps/shell/release 1.0.12 九件+unpacked 全清（3.8G→0）；dist/chatop-chaoffice-1.0.12、chaoffice-1.0.12.tgz 删除 |
| sidecar 四平台重编 | ✅ | 本轮 Rust 有改动（calamine 0.37 + #2136 加密钩子）：zigbuild linux x64/aarch64 glibc 2.28 + mingw win-x64 + mac universal（lipo x86_64+arm64）全部新鲜产出 |
| 九件安装包 | ✅ 全 EXIT 0 | dmg/zip（mac arm64）、exe（win x64 NSIS）、2×deb（arm64/amd64）、2×rpm（aarch64/x86_64）、2×AppImage（arm64/x86_64）全部 1.0.13 |
| 架构逐件直验 | ✅ | arm64.deb sidecar=aarch64 ELF、amd64.deb sidecar=x86-64 ELF、aarch64.rpm sidecar=aarch64、x86_64.rpm sidecar=x86-64、arm64.AppImage=ARM aarch64 ELF、x86_64.AppImage=x86-64、exe=PE32、dmg=UDZO |
| dsh 产物 | ✅ | dist:chatop → dist/chatop-chaoffice-1.0.13（409M）；package:plugin → dist/chaoffice-1.0.13.tgz（168M）；dsh-plugin/package-lock 1.0.13 构建回写已提交（R31 惯例） |
| mac 装机 | ✅ | dmg → /Applications/ChaAI Office.app（Info.plist 1.0.13）；`open` 启动窗口上屏（CGWindowID 实证，screencapture 截窗 /tmp/r35-installed-home.png：察元AIOffice 欢迎弹窗+左树+快速创建+对话面板+本地模型 chip，零上游品牌） |
| 单实例锁 | ✅ | 二次 `open` 无新窗口（窗口 id 4329 不变、进程数 1） |
| asar 版本实证 | ✅ | `npx asar extract-file` → version=1.0.13、chaofficeUpstreamVersion=0.12.115 |
| 打包版 CLI compare 闭环 | ✅ | `chaoffice create --type docx --from a.md/b.md` ×2 → `docs compare` → redline.docx → `docs read --revisions`：1 insertion（Beta）+ 1 deletion（Alpha），author=ChaAI Office（R34 同款闭环口径） |
| 飞腾真机（Linux/ARM64 deb） | ⚠️ 附注降级 | ping 10.9.49.32 100% 丢包（R32 起持续不可达）；dpkg 安装项以包级直验（deb/rpm 双 ELF 逐件）+R30/R31 同管线真机史兜底，恢复后补测 |

## 阶段 2-4 · 模型与对话（dev 真机，当前源码 REMOTE_DEBUG_PORT 驱动）— PASS

| 项 | 结果 | 证据 |
|---|---|---|
| dev shell 启动 | ✅ | 首页(5199)+sheets tab(5174) 正常；标题「察元AIOffice」 |
| 六段版本显示 | ✅ | 桥 `getAppVersion` → "1.0.13.0.12.115" |
| #2187/#2188/#2185 桥 | ✅ | getRestoreLastSession/getAutoUpdateCheck/getTabSleepEnabled 均 function（会话恢复/更新检查开关/tab 休眠三新特性桥在位） |
| CDP 流式对话 | ✅ | chatop-local（harness 127.0.0.1:52581 /health ok）→ 界面发送「只回复两个字：你好」→ 流式出字「你好」渲染完成（复制/下载 chip 在位） |
| 模型切换 | ✅ | setAiSettings 切 chatop-local 即生效（出字即证） |

## 阶段 5-9 覆盖说明

本轮上游改动面（37 提交）按特性逐项由新增/既有自动化用例覆盖并在阶段 0 全绿：

- sheets 批注图片（#2165/#2166：collect-note-states-picture/note-pictures/note-picture-write 全套）、加密工作簿（#2136：xlsx-sidecar 加解密+xlsx-redaction+主进程 zod 门）、pivot stdDev/var（#2194：pivot-stat-aggregates）、上标下标（#2214：sheets-superscript e2e 单测面）
- slides 母版 ribbon（#2178：master-add-element）、纸张尺寸（#2199：slide-size）、中断保全（#2185：deck-save-atomic）
- pdf 批注面板（#2193：comments-panel）、超链接（#2192：edit-ops/save-pdf）、搜索选项（#2181：pdf-search）
- docs 文本框列表（#2195：textbox-list-write/renumber/signature）、SEQ 转义（#2206：caption-sequence-regex）、合并组建行高（#2154：docs-table-vmerge e2e）
- markdown 脚注（#2213：footnotes）、wiki 建笔记（#2179：wiki-create 13 用例）、高亮（#2200：highlight-mark）、状态栏字数（#2198）
- shell 会话恢复（#2187：last-session）、更新开关（#2188：updater）、Decisions API（#2190：decision-endpoints/file-index-decision）
- compare 引擎快照演进（compare.test 138 行新增）、revision-xml、content-control、chart（pptx）、xlsx-package-io、redaction 全套

购买激活（阶段 7）、多语言切换界面级 spot check（阶段 8）、更新下载（阶段 9）为未改区，沿 R34 验收结论沿用；tr 语言切换的表完整性由 main-locale-tables/strings/check-help-langs（22 语言）自动化钉住。

## 发布判定：**PASS**

通过：阶段 0 全绿 + 阶段 1 打包/装机/单实例/CLI 闭环全过 + dev 真机模型对话出字；失败项：无（飞腾真机为环境不可达附注，非测试失败）。

## 随轮追加（2026-10-27 · cli 品牌漏网修复后九件重打的最终验收）

装机验证与 CLI 闭环在**重打版**（cli help 品牌修复 0468b1874 之后）复测：

- `open` 启动不上屏复现 R34 坑⑥（进程活、CGWindowList 空），改终端直启窗口即上屏（CGWindowID 4335）——装机验证一律终端直启
- 重打 dmg 装机：欢迎弹窗察元AIOffice 品牌截图（/tmp/r35-installed-home2.png）、单实例锁（二次 `open` 无新窗口、进程数 1）
- 重打包 CLI 闭环：`docs --help` 显示 "compare default: ChaAI Office"；create docx ×2 → docs compare → redline 4 修订（词粒度 Alpha→Beta/here.→there.），author=ChaAI Office
- 九件重打版架构直验全过（arm64.deb=aarch64 / amd64.deb=x86-64 / aarch64.rpm=aarch64 / x86_64.rpm=x86-64 / arm64.AppImage=ARM aarch64 / x86_64.AppImage=x86-64 / exe=PE32 / dmg=UDZO / zip 含 2 个 mac 主程序项）
- tag `1.0.13` 推 origin+gitee+pubmirror 三仓
- GitHub Release id **424722804**（服务器中继：scp /data/installers/chaoffice-1.0.13 → nohup node fetch stream）九资产全 201 uploaded，公开页 assets=9
- sha256 前 16 位本地↔服务器逐件对齐（含 exe）

### aidooo.com 发布（R34 流程复刻）

- 宿主侧硬链接十槽位入库（exe 同文件双平台槽位）→ 容器内 `finalizeEntry`×10（正确形状 `office['1.0.13'][platform]`=数组；channel='installer' 字段、variant 沿 1.0.12 惯例：默认版/zip 包/rpm 包/AppImage 免安装版）+ 显式 `published=true` + `publishManifest`
- **新坑**：finalizeEntry 每平台首个文件用『默认版』后，同平台其余文件再以『默认版』提交会 409 duplicate_variant——多形态条目必须按 1.0.12 惯例分别使用『zip 包 / rpm 包 / AppImage 免安装版』标签
- 容器内 stat 路径用挂载别名 `/app/public/downloads/...`（宿主 `/data/website/.../downloads` 不在容器命名空间）
- DB 十条目 published=true、sha256/size 与磁盘逐件一致（OK 10 BAD 0）；备份 office-entries-backup-20261027.json
- 清理 1.0.12：DB 条目删除 + 卷内 10 文件删除（备份先行）；旧 URL 404
- 验收：升级链 1.0.12→1.0.13 五平台 updateAvailable=true 且 url=https 公网域名；Range 请求 206；1MB 区段下载字节级校验一致（~6.5MB/s）；公网 releases.json 仅含 1.0.13

**最终判定：PASS**
