# 发版测试报告 — ChaAI Office 1.0.17（六段 1.0.17.0.12.852）

> 2026-11-09。R40 随轮发版（上游 genoffice e1f50e90..0ac588ff 60 提交全吸收，v0.12.852）+ 承接 1.0.16（web/dsh 技能链+pdf 分片，未单独外发）两轮内容对外发布。
> 判定：**PASS**（自动化打包链 + 发版前冒烟实测 + 发布链三方对账全过）。

## 阶段 0 · 发版前置检查 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 仓库状态 | ✅ | main=dcaafab37（R40 门禁绿终态），干净树起版 |
| aidooo 磁盘预检（R37 坑①） | ✅ | /data 93%→清理后 89%，发布全程 ≥9.4G 空闲 |
| 交叉 sidecar 现势审计 | ✅ | Oct 30 旧二进制（R38 批）对 R40 改动的 9 个 Rust 文件已过期、win 侧缺失 → 三平台全量重编（见下） |
| 签名/公证凭据 | ✅ 口径确认 | 本机 0 identities（与 R37/R38/R39 本地打包一致：未签名 dmg，公证钩子自跳过） |

## 阶段 1 · 版本与修复 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本 Z+1 | ✅ | 1.0.16→1.0.17（root/shell/dsh-plugin+双 lock 五文件；e6028bf3e） |
| **CSS 断点修复（发版冒烟兜出）** | ✅ | R40 pick #2503 快照与本地 `.doc-hangul-space` 拼接吞 `}` → `styles.css:5350 Unclosed block` → **build:web 全链堵死**（typecheck/lint/vitest 均不跑 vite renderer build 故 R40 门禁漏网）；对上游 5196-5198 原样补闭合（30ee11b9a） |
| dist/web 版本注入 | ✅ | window.CHAOFFICE_VERSION = "1.0.17" |

## 阶段 2 · sidecar 重编与九件打包 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| linux x64/aarch64 zigbuild（glibc 2.28） | ✅ | target/{x86_64,aarch64}-unknown-linux-gnu/release 10.78M/9.73M（Nov 9，R40 Rust 源全量） |
| win x64 mingw | ✅ | target/x86_64-pc-windows-gnu/release/xlsx-sidecar.exe 17.0M |
| mac universal | ✅ | dist:mac 内 native:build:universal lipo（beforePack 断言双架构） |
| 四 pass | ✅ 全 EXIT 0 | mac（dmg+zip arm64）→win（NSIS exe）→CHAOFFICE_LINUX_X64=1（deb/rpm/AppImage x64）→arm64（deb/rpm/AppImage）；九件全 1.0.17 |
| 架构逐件直验 | ✅ | dmg **UDZO**（hdiutil imageinfo）；exe **PE32**（NSIS 32 位桩，R37 同口径）；deb 双架构字节级（data.tar.xz 提取 sidecar ELF=x86_64/aarch64 对位+control `chaoffice 1.0.17` amd64/arm64）；AppImage 双架构运行时 ELF 头对位；rpm `rpm -qp` chaoffice 1.0.17 x86_64/aarch64 |
| 打包期内置门禁 | ✅ | beforePack 模块树断言×8+CLI 版本门（ensureCliBundleCarriesAppVersion 重烘 1.0.17）+ELF e_machine 守卫+第三方通告校验 |
| dsh 链 | ✅ | chaoffice-1.0.17.tgz（172M，tgz 内 package.json=1.0.17、skills/recommended 107 件、vendor sidecar 在位）+ dist/chatop-chaoffice-1.0.17 |

## 阶段 3 · 发版前冒烟测试（用户令）— PASS

**dmg 装机直启**（/tmp 拷贝直启，R35 坑②规避 `open`）：

| 项 | 结果 | 证据 |
|---|---|---|
| Info.plist | ✅ | CFBundleShortVersionString=CFBundleVersion=**1.0.17** |
| asar 版本（/tmp 执行 asar，R33 坑②） | ✅ | version=1.0.17、chaofficeUpstreamVersion=0.12.852 |
| 版本六段桥（CDP） | ✅ | window.chaOffice.getAppVersion() → **"1.0.17.0.12.852"**（桥 146 键） |
| 首页品牌 | ✅ | 察元AIOffice 命中、零上游品牌（Genspark/GenOffice 正文 false） |
| 编辑器真机活性 | ✅ | 新建 docx → 功能区/AI 面板全载（「正在打开」收敛，修订追踪在案）；恢复会话 sheets tab 渲染+模型 chip `local/qwen3.5-4b-q4km`（harness 自动发现） |
| 打包版 CLI 闭环 | ✅ | cli/chaoffice --version → **1.0.17**；create docx×2 → docs compare → revisions：insertion(Beta×2)+deletion(Alpha)、author=**ChaAI Office** |
| 单实例锁 | ✅ | 二次直启后主进程数仍 1 |

## 阶段 4 · tag 与 GitHub Release — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| tag 三仓 | ✅ | origin（github zhgyuhuii/chayuan-office）main dcaafab37..30ee11b9a+tag、gitee main+tag、pubmirror（ChayuanAIOffice）tag 沿例 |
| GitHub Release | ✅ | tag 1.0.17（release body 覆盖 1.0.16+1.0.17 两轮）；九资产服务器中继（R37 坑③口径）**一发全 201 无重试**、FINAL 9/9 size-match |
| 三方对账 | ✅ | dmg 1MB 段 sha256 本地=aidooo=GitHub **7f38a47c…** 一致（exe 88e64dea… 双侧一致） |

## 阶段 5 · aidooo.com 发布 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| DB 备份 | ✅ | office-entries-backup-20261109.json（1.0.15 十条目留底） |
| 旧版双侧清理（R37 满盘惯例提前） | ✅ | /data/installers/chaoffice-1.0.15 + downloads/office/installer/* 九件删净 |
| scp+硬链接十槽位 | ✅ | 九文件 sha256 逐件=本地；installer/{mac-arm64×2,windows-amd64,linux-amd64×3,linux-arm64×3}+windows-arm64（exe 复用）=10 链接 |
| 容器写 DB（脚本入 downloads 挂载执行后删，R37 坑②） | ✅ | office={1.0.15 删,1.0.17 十条目}；**自检 ok=10 bad=0**（sha/size 磁盘逐件一致）；真实 publishManifest() 调用成功 |
| 升级链验收 | ✅ | 公网 /api/version/office **latest=1.0.17** 五平台+primaryUrl https；Range **206**；1MB 段 sha 双侧一致（dmg 7f38a47c/exe 88e64dea）；旧 1.0.15 槽位零残量 |

## 阶段 6 · dsh 形态送达（察元AI OS）— PASS

| 项 | 结果 | 证据 |
|---|---|---|
| harness 重铺 | ✅ | `build.mjs chatoffice` → desktop/resources/chatoffice **1.0.17**（vendor 瘦身 1494 map+33 test 目录；web shim 免补丁判定） |
| OS app 原位覆盖 | ✅ | /Applications/察元AI OS.app/Contents/Resources/chatoffice **1.0.17**（657M，rsync --delete 镜像） |
| staged 内容签名重铺实测 | ✅ | 桌面启动 ~5s staged（chatop-data shared/plugins/bundled/chaoffice）1.0.16→**1.0.17**；sidecar 从 staged 路径起进程（tsx+esbuild service） |
| sidecar HTTP 面 | ✅ | 六编辑器 /editors/* 全 **200**；window.CHAOFFICE_VERSION="1.0.17"；`/ai/skills/status` `{"webForm":true,…}`（R39 技能链活性）；验证后桌面退出恢复原态 |

## 附注

- 服务器中继脚本 /root/gh-upload-1.0.17.mjs（沿 gh-upload-1.0.15.mjs 模式，日志 /root/gh-upload-1.0.17.log）。
- **新坑记账**：①R40 类同步轮的 pick/品牌重放可引入 **CSS/HTML 级语法断点**——现有门禁（typecheck/lint/vitest）不跑 vite renderer build，**发版前 build:web 是唯一兜底**，建议纳入同步轮门禁（本轮冒烟兜出 styles.css 吞 `}` 一例）；②shell 管道 `npm run build:web | tail` 会让退出码归零——后台任务勿接管道（本轮首跑失败被吞，直跑即现形）。
- 飞腾真机（Linux/ARM64 deb）：沿 R32 起不可达附注降级；以 deb 字节级 aarch64 ELF 直验+R30-R37 同管线真机史兜底，恢复后补测。
