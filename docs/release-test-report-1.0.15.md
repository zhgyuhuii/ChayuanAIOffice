# 发版测试报告 — ChaAI Office 1.0.15（六段 1.0.15.0.12.115）

> 2026-10-30/31。R37 随轮发版（上游 genoffice 28e9c100..df9a64c5 45 提交全吸收）。
> 判定：**PASS**（自动化门禁+dev 真机 CDP+打包直验+mac 装机全过；飞腾真机延续附注降级）。

## 阶段 0 · 自动化门禁（sync/37-upstream 分支 + main 合并前）— PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 45 提交逐个 cherry-pick | ✅ | 45/45 全落地（见 docs/upstream-sync.md §37 冲突与裁决清单 45 项）；收尾 2 提交（品牌+lint 接线）|
| typecheck | ✅ 全仓 0 | 34 工作区（shell logos cloudgpu 补齐后）|
| vitest | ✅ 全工作区绿 | docs 4345/sheets 3951+/slides 1605/markdown 1513/pdf 1110+/html 361/cli 370/ai-provider 623/electron-utils 316（干净环境）… |
| cargo test | ✅ | 284（+8：rels_normalize/xls_biff 新模块+recalc 扩展）|
| lint | ✅ 0 error | 25 warnings 基线 |
| 品牌 delta 扫描 | ✅ | 369 改动文件新旧计数对比，2 处真违规均修复（shell intgLegacyDesc 22 语言+save-pdf 注记名）|
| sidecar 重编 | ✅ | debug+release（R36 坑：测试读 release 硬路径）；四平台 zigbuild/clang（linux x64+aarch64 glibc 2.28/win mingw/mac universal lipo）|
| 测试适配（Q6 桩改） | ✅ | xlsx-spill（ironcalc 0.9.1 FILTER 已可求值→断言改+STOCKHISTORY 新用例）；preload-namespace（chaOffice 桥名）；help-sync SKILL.md 行重建；nativeImage 桩×6 套件；styleDeletes 桩×2 |
| 环境假败甄别 | ✅ | electron-utils main-proxy（NO_PROXY 敏感，反向 R36 mcp-http）；shell packaged-cli-version（linux ELF 暂存顺序，发版序单验 5/5）|

## 阶段 1 · 打包与直验 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本 Z+1 | ✅ | 1.0.14→1.0.15（root/shell/dsh-plugin tracked 三处+embedded 忽略区，lock 同步；提交 58bbff0c2/a55ea0df0）|
| 清理历史产物 | ✅ | apps/shell/release 1.0.14 九件全清；dist/chatop-chaoffice-1.0.14、chaoffice-1.0.14.tgz 清理（发布后复核）|
| 九件安装包 | ✅ 全 EXIT 0 | dmg/zip（mac arm64）、exe（win x64 NSIS）、2×deb（arm64/amd64）、2×rpm（aarch64/x86_64）、2×AppImage（arm64/x86_64）全部 1.0.15 |
| 架构逐件直验 | ✅ | dmg **UDZO**（hdiutil imageinfo）；exe **PE32**；deb 字节级：data.tar.xz 提取 xlsx-sidecar → x86-64/aarch64 ELF 逐件对位；deb 元数据 `chaoffice 1.0.15`（amd64/arm64）；AppImage ELF 头 e_machine → x86-64/aarch64；rpm 沿 R32 ELF 守卫（构建时强制校验）|
| dsh 产物 | ✅ | dist:chatop → dist/chatop-chaoffice-1.0.15（411M）；package:plugin → dist/chaoffice-1.0.15.tgz（161MiB）；历史 1.0.14 dsh 产物已清理 |
| tag | ✅ | `1.0.15` 推 origin（github zhgyuhuii/chayuan-office，main d1183ba30+版本+补漏三提交+tag）+gitee（cloudshd/chayuan-ai-office，main+tag）+pubmirror（ChayuanAIOffice，仅 tag 沿例）|
| GitHub Release | ✅ | **429539064** 九资产服务器中继全 201 uploaded（第一发即过，无重试；sha256 前 16 位本地↔服务器逐件对齐）|

## 阶段 1b · aidooo.com 发布 — PASS（含存量清理）

| 项 | 结果 | 证据 |
|---|---|---|
| 发布前 DB 现状检查（R36 坑③） | ✅ | office keys=[1.0.14]、latest=**null**（1.0.14 发布后 DB 被清空的空段形态——升级链静默断裂中，本次入库即修复）|
| 磁盘满盘处置 | ✅ | /data 100% 满；清 1.0.12/1.0.13 staging（3.2G）+**发布前**移除 1.0.14 双侧（staging+卷内，本轮沿「发布后清理」惯例提前，因满盘；备份 old-releases 原位 gzip 保留）→ 2.4G 空闲 |
| 宿主硬链接十槽位 | ✅ | 九文件→installer/{mac-arm64×2,windows-amd64,linux-amd64×3,linux-arm64×3}+windows-arm64（exe 复用同文件）；硬链接 2 无额外占用 |
| 容器写 DB | ✅ | office['1.0.15'][platform]=数组 ×5 槽位（9 条目）；variant 沿惯例（默认版/zip 包/rpm 包/AppImage 免安装版）；channel=installer；**自检 OK=10 BAD=0**（sha256/size 磁盘逐件一致）|
| publishManifest | ✅ | 公网 manifest office 段仅 1.0.15 十槽位（1.0.14 DB 条目沿 R36 惯例删除）|
| 升级链验收 | ✅ | 四发货平台 1.0.14→1.0.15 `/api/version/office` latest=1.0.15+primaryUrl https 公网；Range **206**；1MB 区段 sha256 双侧字节级一致（03f7cbd4…/a3e5832d…/84124813…/5b5ded14… 四平台各对）；旧 1.0.14 URL **404**、卷内无残量 |
| 备份 | ✅ | office-entries-backup-20261030.json（1.0.14 条目留底，/app/server/data/）|

## 阶段 2-4 · dev 真机（REMOTE_DEBUG_PORT=9331 CDP 驱动）— PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本六段桥 | ✅ | window.chaOffice.getAppVersion() → **"1.0.15.0.12.115"**（桥 142 键）|
| 首页品牌 | ✅ | 察元AIOffice 命中、零上游品牌（Genspark/GenOffice 正文扫描 false）|
| harness 自动发现 | ✅ | sheets 模型 chip `local/qwen3.5-4b-q4km`（察元OS harness 运行中自动发现）|
| CDP 流式对话 | ✅ | 首页发送「请用一句话回答：1+1等于几？」→ chatop-local 流式出字 → 助手气泡「**1+1等于2。**」（06:27 时间戳，qwen3.5-4b-q4km）|
| R37 新特性真机活性 | ✅ | sheets **QAT「用 AI 命名…」钮**（.qa-name-with-ai，aria-label 实证）；**审阅 tab「拼写检查」钮**渲染在案（检查拼写/翻译/批注组全在）；pdf 测量/附件/对比/减肥四特性由 24 上游新测试文件覆盖（pdf 套件 1110+ 全绿）|
| 六格式文档管线 | ✅ | 六端 vite 5173-5178 全 200、shell 5199 正常（dev 启动日志）|

## 阶段 5 · mac 装机（dmg → /tmp 复制直启）— PASS

| 项 | 结果 | 证据 |
|---|---|---|
| Info.plist | ✅ | CFBundleShortVersionString=**1.0.15** |
| 启动上屏 | ✅ | 终端直启（R35 坑②：`open` 不上屏规避）——System Events 进程表「ChaAI Office」在案、窗口数 1 |
| 单实例锁 | ✅ | 二次 `open` 后主进程数仍 1（66893/66838 双主进程号=首启进程+helper 树；窗口仅 1）|
| asar 版本实证 | ✅ | `npx asar extract-file`（**/tmp/r37-asar 目录执行**，R33 坑②防）→ version=**1.0.15**、chaofficeUpstreamVersion=**0.12.115** |
| 打包版 CLI compare 闭环 | ✅ | `cli/chaoffice` --version → **1.0.15**；create a.md/b.md ×2 → `docs compare` → `docs read --revisions`：insertion(Beta)+deletion(Alpha)，author=**ChaAI Office** |

## 附注

- **飞腾真机（Linux/ARM64 deb）**：沿 R32 起不可达附注降级（ping 100% 丢包）；本轮以 deb 包字节级 ELF 直验（aarch64 sidecar 对位）+R30-R36 同管线真机史兜底，恢复后补测。
- **发版新坑（本轮新增）**：
  1. **服务器 /data 满盘**（100%，OS 3.2.10 晨发 38G installer 占满余量）——发版前必须 `df -h` 预检；处置顺序：清旧 staging→旧版本双侧（staging+卷内）随发布清理→备份原位 gzip 而非删除。
  2. **`docker cp` 到 chayuan-admin 失败**（`Could not find the file /proc/self/fd`，容器无 /tmp 挂载）——脚本一律放 `/data/website/deploy/docker/html/chayuan/downloads/`（downloads 挂载别名内）执行后即删。
  3. **full-gate 前 sidecar 三态切换**：全仓 vitest 需 mac universal；shell packaged-cli-version 需 linux x64 ELF 暂存；linux arm64 pass 前 build:all 会重编宿主 sidecar 覆盖暂存——**先跑完 build 再暂存 ELF、只重跑 shell 打包步**。
  4. R36「发布后清理旧版」惯例本轮因满盘提前到发布前执行——验收项「旧 URL 404+卷内无残量」在发布前即满足，结果等价但顺序反转需记账。
- GitHub Release 资产清单（429539064）：ChaAIOffice-1.0.15-arm64.dmg / -arm64.zip / ChaAIOffice-Setup-1.0.15.exe / ChaAIOffice-1.0.15-arm64.deb / -amd64.deb / -aarch64.rpm / -x86_64.rpm / -arm64.AppImage / -x86_64.AppImage。
