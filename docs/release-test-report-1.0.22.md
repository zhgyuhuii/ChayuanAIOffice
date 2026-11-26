# 发版测试报告 — ChaAI Office 1.0.22（六段 1.0.22.0.13.886）

> 2026-11-26。大文件打开战役（office_1gb P0+P1 全落地）+ 微信扫码登录全链 + markdown 巨文本键入根治随轮发版。
> 判定：**PASS**（全量门禁绿 + 四 pass 九件 + 逐包直验 + 装机冒烟三面 + 全渠道送达）。

## 本轮变更（1.0.21 → 1.0.22 共 10 提交）

**大文件打开战役**（R45 后吸收落地）：

| 提交 | 内容 |
|---|---|
| be42d8edd | zip-gate ZIP64 全支持 + 本地文件预算限额；docx-engine 字节级扫描器与 giant 会话 |
| ce46cda3f | 超大 Word 文档只读虚拟窗口（GiantDocView） |
| 5eff8505d | PDF Range 流式打开 + 真增量保存 |
| c79bf1fdd | 幻灯片音视频协议直出去 base64 + 解码图片 128MB LRU |
| 464440511 | 表格 sharedStrings mmap 偏移索引化（百万行 Rust 峰值消除） |
| 5c4f3f653 | txt/json 走真源码模式（6.8MB JSON 打开 4.5 分钟假死 → 亚秒） |

**本轮新提交**：

| 提交 | 内容 |
|---|---|
| 5623a532f | 源码模式接 CM6 PlainTextEditor——巨文本键入卡顿根治（textarea 50-75ms/键 → 5-43ms）+全出血排版；setDoc 防 undo 回写 |
| 1fa078912 | 微信扫码登录全链——账户面板+设置面板双入口（aidooo.com 服务端，扫码/完善资料/重启持久化/自动出码） |
| 986a0ab87 | 察元AI 入口降级档保持竖排大按钮 |
| 6a64fc750 | office_1gb 方案文档存档 |
| 183800529 | 版本 Z+1：1.0.22（五文件） |

## 阶段 1 · 门禁与版本 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 全量 typecheck | ✅ | TYPECHECK_EXIT=0（38 工作区） |
| 全量 vitest | ✅ | 38/38 工作区 TEST_EXIT=0（含新增 plain-source-editor、wx-auth 套件） |
| 版本 Z+1 | ✅ | 1.0.21→1.0.22（root/shell/dsh-plugin package.json+双 lock 五文件；183800529） |
| 上游口径 | ✅ | chaofficeUpstreamVersion 0.13.886 不动；六段 **1.0.22.0.13.886** |

## 阶段 2 · sidecar 与九件打包 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| sidecar 重编 | ✅ | 本轮含 Rust 改动（464440511 mmap）：zigbuild x64/arm64 + mingw win 三枚交叉产物 11-26 14:05-14:07 全新；host 侧由 native:build:universal 双 Apple 目标 lipo |
| 四 pass | ✅ 全 EXIT=0 | mac dmg+zip（14:10）→win exe（14:13）→CHAOFFICE_LINUX_X64=1 linux x64（14:15-17）→linux arm64（14:18-23） |
| app-update.yml | ✅ | dmg 挂载 + zip 解包 + exe 内嵌 app-64.7z 三路直验：generic → aidooo.com/downloads/office/update |
| 逐包直验 | ✅ | deb 双架在包 sidecar 0x3e/0xb7；AppImage 双架在包 0x3e/0xb7（7z -tsquashfs 解段）；rpm 双架元数据 1.0.22；exe 内嵌双 helper PE x64 + asar package.json 1.0.22；dmg CFBundleVersion 1.0.22 |

## 阶段 3 · 装机冒烟 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 隔离 profile | ✅ | zip 解包→asar 补丁 name/productName→ad-hoc 重签；userData 落 `ChaOfficeRelSmoke`（进程参数活体确认） |
| 版本六段桥 | ✅ | CDP `getAppVersion()` → **1.0.22.0.13.886** |
| 大 JSON 源码模式 | ✅ | 7.1MB 合成 JSON openPath：CM6 挂载（.cm-editor）+ ProseMirror 无 + 全文高度 289 万 px + 滚底 1ms |
| 扫码登录面 | ✅ | `wxStatus()` → {loggedIn:false}；未登录自动出码（640px PNG data URL）——aidooo 生产 qr-start 链路通 |
| 清理 | ✅ | 实例 pkill 零残留；合成件/隔离 profile/冒烟 app 全删 |

## 阶段 4 · tag 与 GitHub Release — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| tag 三仓 | ✅ | origin main 6a64fc750→183800529 + tag 1.0.22；gitee main c666dd7bf→183800529 + tag；pubmirror 沿例只 tag |
| GitHub Release | ✅ | **release 459042757** 九资产全 201、FINAL assets=9 uploaded=9、**SIZE_MATCH_ALL: true**；body 按「无上游品牌」规范撰写（中继脚本 /root/gh-upload-1.0.22.mjs） |

## 阶段 5 · aidooo.com 发布 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 旧版双侧清理 | ✅ | /data/installers/chaoffice-1.0.21 删除（另：1.0.19 残留 staging 一并清出 1.75G）；槽位 1.0.21 文件删净（find=0）；DB office['1.0.21'] 删除（备份 .bak-release-1.0.22） |
| 硬链接十槽位 | ✅ | mac×2/win×2（exe 复用）/linux×6，find=10 |
| DB 入库 | ✅ | office['1.0.22'] 五条目（variant 沿例：zip 包/默认版×2/AppImage 免安装版×2；sha256+size 槽位真算） |
| 升级链验收 | ✅ | 公网 latest=**1.0.22**；五平台 1.0.21→1.0.22 updateAvailable 全 True；Range **206**；1MB 段 **本地=公网一致（fc8931b7…）** |
| feed 重发 | ✅ | latest-mac/win/linux.yml → version **1.0.22**（脚本自校验三平台全过） |

## 阶段 6 · dsh 形态送达 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| dsh 产物 | ✅ | dist/chatop-chaoffice-1.0.22 + chaoffice-1.0.22.tgz（177.7M）全 EXIT 0 |
| 重铺双落位 | ✅ | harness desktop/resources/chatoffice 与 /Applications/察元AI OS.app/…/chatoffice 均 **1.0.22**（桌面 0 进程时 rsync --delete） |
| 三方 sha 同源 | ✅ | harness=OS app=dsh-plugin 的 dist/host.js 一致（070a24ac…） |
| 内嵌 sidecar | ✅ | 部署内嵌 native/xlsx-sidecar/xlsx-sidecar：Mach-O arm64、14:33 新鲜 |

## 附注

- 1.0.21 已装用户将通过应用内更新卡片直接收 1.0.22（提示链 1.0.20 起已通；mac 手动引导/Win·Linux 全自动）。
- 本轮直验新工具链：**AppImage 无需 Linux 运行时**——按 hsqs 魔数切出 squashfs 段后 `7z x -tsquashfs` 直接解包（x64 AppImage 在 arm64 宿主无法 exec 的解法，deb/rpm 同口径双证）。
- 重铺坑两则：①部署 chatoffice 的 vendor/chaoffice-sidecar 形态 = **dsh-plugin/embedded/**（构建剪裁产物）而非 dsh-plugin/vendor 源目录——按旧版文件清单（落位 ⊂ embedded，0 多余）坐实后复刻；②rsync 必须 `-a`——裸 `-r` 丢 node_modules/.bin 与 @chaoffice/* 工作区符号链接，sidecar 起不来。
- 服务器磁盘 96% 满（4.7G）状态下发版：上传前清 1.0.19 残留 staging（槽位已不存在、link=1 的真垃圾）换出空间；1.0.21 staging 与槽位同 inode（清理技能坑②），随槽位删除释放。
