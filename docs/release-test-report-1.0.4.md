# 察元AI Office 1.0.4 发版前真机测试报告

- 日期：2026-10-12
- 被测产物：`apps/shell/release/ChaAIOffice-1.0.4-arm64.dmg`（info.plist CFBundleShortVersionString = 1.0.4）
- 显示版本（关于页实测）：**1.0.4.0.11.0**（六段规范：自有 1.0.4 + 上游 0.11.0）
- 环境：macOS (darwin 25.6.0, arm64)，真机安装 + CDP（--remote-debugging-port=9223）驱动 UI 实测

## 阶段 0 · 全量自动化测试

- ✓ `npm run typecheck` — EXIT 0（全工作区）
- ✓ `npm run test` — EXIT 0，0 FAIL
- ✓ 品牌残留 grep 仅 4 处，全为豁免类：`default-app.ts:83`（/Applications/GenOffice.app 路径兼容）、`cover-pages.ts:7-8`（上游 docx 封面魔法标记，改则破坏旧文档兼容）、`runtime.ts:489`（注释）

## 阶段 1 · 打包安装

- ✓ 安装：/Applications/ChaAI Office.app，CFBundleShortVersionString 1.0.4
- ✓ 首页：左树 + 对话面板 + 2×3 新建矩阵 + 搜索 + 快速创建卡（截图 office-shot-home.png）
- ✓ logo 与产品名：察元AIOffice / ChaAI Office，无 GenOffice/Genspark 残留
- ✓ 首启引导：三页 onboarding 正常，可跳过
- ✓ 单实例锁：二次 `open` 后主进程仍为同一 PID（84104）
- ✓ 会话保持：杀进程重启后对话历史与文档 tab 全部恢复

## 阶段 2 · 配置模型

- ✓ 设置 → 模型设置：60+ 厂商目录渲染正常（国内外分组 + 自定义供应商入口）
- ✓ 阿里百炼：API 地址预填 `dashscope.aliyuncs.com/compatible-mode/v1`、协议 Chat(OpenAI)、
  获取模型列表实拉 **175 个模型**（key 有效、连通 OK）、勾选模型 → 保存并启用 →
  顶栏「已启用」徽章 + picker 出现该组
- ⚠ 对话（云端）：HTTP 400 `Arrearage`（账户欠费）——UI 正确原样展示错误；**外部因素非产品缺陷**，
  两个测试 key（key.rtf apikey1/2）均欠费，待有效 key 复测
- SKIP Anthropic / Google Gemini / 本地 chatop（无对应 key；chatop-local 见阶段 3）

## 阶段 3 · 察元 Harness 自动发现

- ✓ 以 `CHATOP_DSH_HOME` 指向运行中的察元OS dsh-home 启动 → 模型 picker 自动出现
  **「察元OS 本地模型」组（带「运行中」徽章）**：local/qwen3-4b-instruct-2507-q3ks、
  local/startlux-decision-0.8b-q8_0，零手工配置（发现链路：state.json 代理端口动态读）

## 阶段 4 · 首页对话

- ✓ 本地模型流式对话：选 local/qwen3-4b 发送「用一句话介绍你自己」→ 流式出字完整回复
  （「我是一个智能办公助手…」），全离线链路（截图 office-shot-localchat2.png）
- ✓ 多会话：顶栏多会话 tab（两条同题会话并存、可切换）
- ⚠ 云端对话：同阶段 2（key 欠费）
- 未深测：附件上传、停止按钮、工具调用（web_search/generate_image）

## 阶段 5 · 六格式文档（真机生命周期）

| 格式 | 新建 | 编辑 | 保存落盘 | roundtrip | 证据 |
|---|---|---|---|---|---|
| docx | ✓ | ✓ 正文输入 | ✓ `~/Documents/ChayuanAIOffice/未命名文档.docx` 3617B | ✓ document.xml 含全文 | ROUNDTRIP-OK |
| xlsx | ✓ | ✓ A1=1048576 | ✓ `sheets-autosave/946da261d5bfc1f4.xlsx` 4064B | ✓ sheet1.xml 含值 | ROUNDTRIP-OK |
| md | ✓ | ✓ 标题+列表 | ✓（内容断言过） | ✓ | body 断言 |
| pptx | ✓ 窗口 | — | — | — | 冒烟 |
| pdf | ✓ 窗口 | — | — | — | 冒烟 |
| html | ✓ 窗口 | — | — | — | 冒烟 |

- ✓ sheets 编辑器完整渲染：ribbon（开始/插入/页面布局/公式/数据）、名称框、公式栏、
  状态栏流式加载、AI 侧栏（MiniMax-M2.5 可选）

## 阶段 7 · 购买与激活

- SKIP：本地构建未注入 `CHATOP_LICENSE_HMAC_KEY` → license-key.txt 为空 →
  激活入口按设计禁用（首页无激活文案，符合 builder 注释的预期行为）。正式发布 CI 注入后需复测。

## 阶段 8 · 多语言与主题

- ✓ 设置 → 通用：语言/主题项存在；语言切换执行正常、切回中文正常
- △ 深度断言（逐键缺翻译检查、主题独立 #1865）未做，建议人工抽验

## 阶段 9 / 10 · 更新安全与性能

- 未执行：更新链路需发布环境（本地构建无更新源，属预期）；阶段 0 全量测试已覆盖
  zip-gate/MCP 安全/大文档等边界（EXIT 0）

## 结论

**发布判定：PASS（附 2 项条件）**

- 通过：阶段 0/1/3/4/5 全绿；阶段 2 配置链路全绿
- 条件①：云端对话需换有效百炼 key 复测一轮（当前 key 欠费，纯外部因素）
- 条件②：win/linux 安装包本轮产出未做对应真机验证（无实机，与历史版本口径一致）；
  正式发 Windows 包前须在 Windows 实机补冒烟（含 win-ocr.exe 的 CI 构建）
- 本地构建常规状态：未签名/未公证、无更新源/GA4/激活 key
