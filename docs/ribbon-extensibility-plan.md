# 动态 Ribbon 与二次开发体系 — 深度分析与技术方案

Status: proposal(设计文档,未实施)。目标:把顶部菜单改造为 WPS 式可动态加载、可二次开发、对外提供接口的 Ribbon 体系,兼容 `ribbon.xml` 声明式配置。

## 一、WPS 的技术方案剖析

WPS 加载项由两部分组成([WPS 加载项开发说明](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-development-instructions)):

**1. 声明式 UI(`ribbon.xml`)** — 遵循微软 CustomUI 规范,纯 XML 描述界面结构:

```xml
<customUI xmlns="http://schemas.microsoft.com/office/2009/07/customui" onLoad="OnAddinLoad">
  <ribbon>
    <tabs>
      <tab id="myTab" label="我的工具">
        <group id="myGroup" label="工具组">
          <button id="btn1" label="盖章" onAction="OnStamp" getImage="GetImage"/>
        </group>
      </tab>
    </tabs>
  </ribbon>
</customUI>
```

**2. 逻辑(`wps.js`)** — 回调按函数名字符串绑定:

```js
window.ribbon = {
  OnAddinLoad(ribbonUI) { ribbonUI.Invalidate(); return true },  // 初始回调
  OnStamp(control) { wps.WpsApplication().ActiveDocument... },   // onAction
  GetImage(control) { return 'https://.../stamp.png' },          // 动态图标
}
```

核心机制(WPS 与 Office 同源):

- **XML 是数据,回调是延迟求值的函数名** —— UI 结构与业务逻辑彻底分离;
- `getEnabled / getVisible / getLabel / getImage` 等 `get*` 回调让 UI 状态动态化;
- `ribbonUI.Invalidate() / InvalidateControl(id)` 触发重查询;
- `idMso / insertBeforeMso / insertAfterMso` 实现与内置标签的**合并**而非替换;
- 右键菜单经 `contextMenus` 同理扩展。

## 二、GenOffice 现状(代码级事实)

| 维度 | 现状 | 评估 |
| --- | --- | --- |
| Ribbon 结构 | docs `Ribbon.tsx` 3,643 行 + `ribbon-tabs.tsx`(1,529)/`ribbon-layout-tab.tsx`(592)/`ribbon-insert-tab.tsx`(1,250) 硬编码 JSX;slides 为 6,000 行平行副本;每 app 各自一套 | ❌ 强耦合、大量重复 |
| 控件规模 | docs 约 231 个按钮 / 33 个分组;控件**项级**已有数据驱动(色板 `THEME_COLORS`、字号、形状库、符号表、页边距预设) | 半数据驱动 |
| 动作层 | ~45 个异构类型回调 props(如 `onInsertSectionBreak(type: 'nextPage'\|...)`)经 `useStableCallbacks` 稳定化;大量 `editor.chain()` 内联在 onClick | ❌ 不可序列化 |
| 命令通道 | 已有字符串键先例:原生菜单 `menu:command` IPC(App.tsx ~36-case switch)、sheets 的 `ribbon-actions.ts` 命令分发器、`shortcuts.ts` 快捷键注册表 | ✅ 可泛化为注册表 |
| 图标 | 每 app 静态 import 的具名 SVG(docs 139 个、slides 169 个、pdf 68 个),无名称注册表 | 需建注册表 |
| i18n | `strings-ribbon.ts` 13,365 行、10 语言,键规整(`ribbonXxx` / `ribbonXxxTip`) | ✅ 直接可作 labelKey 体系 |
| 扩展体系 | 完全没有 plugin/addon 机制 | 全新建设 |
| IPC / 安全 | docs 主进程 56 个 IPC 通道;严格 CSP(`script-src 'self'`);`project-store` 已有持久化范式 | ✅ 声明式 XML 加载不需放宽 CSP;跑第三方代码需专门沙箱 |
| 共享组件 | `@genoffice/ui` 无 ribbon 抽象,但 `rb-big / ribbon-group / ribbon-tab` CSS 类名跨 app 一致(事实契约) | 渲染器共享可行 |

结论:现状是"编译期固定的 JSX Ribbon",与 WPS 方案的差距在三层 —— ① UI 不是数据;② 没有命令注册表;③ 没有外部代码运行时。但代码里已有全部种子(tab 数组、项级数据驱动、`menu:command` 字符串通道、i18n 键体系、CSS 类名约定)。

## 三、总体方案(五层架构)

```
┌─────────────────────────────────────────────────────┐
│ L5 加载项生态: 目录/包/CLI(wpsjs 对标)/签名/市场      │
├─────────────────────────────────────────────────────┤
│ L4 对外 API: @genoffice/api(对象模型+事件+ribbonUI)  │
├─────────────────────────────────────────────────────┤
│ L3 桥接运行时: 沙箱 iframe + postMessage + 权限门卫   │
├─────────────────────────────────────────────────────┤
│ L2 命令注册表: 字符串命令id → run/enabled/pressed     │
│    + Invalidate 机制(泛化 menu:command)             │
├─────────────────────────────────────────────────────┤
│ L1 Ribbon 内核: Schema(TS 类型)+XML 解析器+合并引擎   │
│    + 声明式渲染器(packages/ribbon)                  │
└─────────────────────────────────────────────────────┘
```

### L1 Ribbon 内核(前提,也是收益最大的一步)

**Schema**(TS 定义,XML 是它的序列化形式):

```
customUI → ribbon.tabs[] → tab{ id, idMso?, insertAfter?, labelKey|getLabel }
                        → group → control
```

- 控件目录 9 种(按现有 UI 能力):`button / toggleButton / menu / splitButton / gallery / comboBox / editBox / checkBox / separator`;
- 属性:`size(big|small)、screentip、keytip、image(icon 名或 URL)、visibleWhen(formatState 谓词)`。

**渲染器**放新包 `packages/ribbon`,输出沿用现有 `rb-*` 类名约定;docs/slides/markdown 逐步收敛到同一渲染器(slides 平行副本顺势合并)。

**合并引擎**:内置标签本身改为 Schema 表达;加载项 XML 按 `insertBefore/insertAfter/idMso` 合并;未知元素降级为占位并告警(向前兼容)。

**迁移策略**(保住性能契约):现有 `useStableCallbacks + useShallowStable + memo` 机制不动 —— 渲染器把 `onAction="cmdId"` 解析为注册表查找,处理函数仍是稳定引用;`formatState` 50 字段作为 `getEnabled/getPressed` 的求值输入,变更时按控件粒度重渲染。

### L2 命令注册表

把 App.tsx 的 menu:command switch 泛化为 `CommandRegistry`:

```ts
registerCommand(id, {
  run(args?),                    // 复用 ribbonActions 的稳定回调
  isEnabled?(fmt: RibbonFormatState): boolean,
  isPressed?(fmt): boolean,
})
```

内置 ~231 个控件逐 tab 迁移(从 Home 开始,一个 group 一个 PR);sheets 的 `ribbon-actions.ts` 分发器直接并入;快捷键 `shortcuts.ts`、右键菜单 `ContextMenu.tsx` 后续挂到同一注册表。

### L3 桥接运行时(对外接口的核心)

WPS 用隐藏网页跑 `wps.js`;Electron 下等价物是**沙箱 iframe**(独立 origin):

- 回调桥:`onAction="OnStamp"` → iframe 内 `window.ribbon.OnStamp(control)` ↔ 宿主 postMessage(命令封装、超时、错误隔离);
- `ribbonUI` 对象:`Invalidate() / InvalidateControl(id)` → 宿主重查询对应 `get*` 回调;
- 事件(对标 `ApiEvent`):`DocumentChanged / SelectionChanged / DocSaved`,复用 editor 事件转发。

### L4 对外 API(`@genoffice/api`)

TypeScript SDK,镜像 WPS 对象模型子集 + 本项目特色能力:

```ts
GenOffice.Application.ActiveDocument   // 读写文本/段落/表格(走 docx-engine)
        .Selection                     // 范围、插入、格式
        .InsertText / .InsertTable / .InsertImage
        .Save() / .ExportPdf()
        .On('selectionChanged', fn)
ribbonUI.InvalidateControl('btn1')
```

版本化(`apiVersion: 1`)、能力协商(manifest 声明所需 API,用户授权)。

### L5 加载项包与分发

```
my-addin/
├── manifest.json    # id、名称、版本、权限、入口、适用app(docs/sheets/…)
├── ribbon.xml       # CustomUI 兼容 schema
├── main.js          # 逻辑(沙箱内运行)
└── icons/
```

- **加载路径**:用户目录 `~/Library/Application Support/GenOffice/addins/<id>/`(主进程 `addin:*` IPC + `project-store` 式持久化;安装/启停/卸载 UI 放"文件 → 选项 → 加载项");
- **开发模式**:监听目录热重载(对标 `wpsjs` 调试体验),devtools 直连沙箱 iframe;
- **分发**:zip 包 + manifest 内签名公钥/哈希,安装时校验;企业可策略预装。

### 安全模型(先于生态设计)

- 现行 CSP `script-src 'self'` 下,**纯声明式 ribbon.xml(数据,无代码)可以零放宽加载** —— 这是 P3 阶段安全的前提;
- 跑第三方 JS(P4)时:沙箱 iframe(无 Node、独立 origin、CSP 资源白名单)、manifest 权限清单(`document:read/write、network:<域>、clipboard`)、网络经主进程代理审核、回调超时熔断、单加载项崩溃不影响宿主。

## 四、实施路线图

| 阶段 | 内容 | 量级 | 里程碑 |
| --- | --- | --- | --- |
| P1 命令注册表 | 泛化 `menu:command`;Home tab 全部控件 onClick → `cmdId` | 1–2 周 | 内部完成"UI→命令"解耦 |
| P2 Schema 化 | `packages/ribbon` 类型+渲染器;tab/group 级迁移(docs 先行,slides 跟进合并) | 3–6 周 | 内置 Ribbon 全数据驱动,视觉零变化(截图回归保障) |
| P3 XML 加载 | CustomUI 兼容解析器+合并引擎;`addin:*` IPC;声明式加载项(仅 XML+图标,无代码)可装 | 2 周 | 第一个对外能力:改 XML 即改菜单 |
| P4 桥接+API | 沙箱运行时、回调桥、`@genoffice/api` 对象模型、Invalidate | 4–6 周 | 完整 WPS 级二次开发 |
| P5 生态 | CLI(`genoffice addin create/dev/build`)、签名、文档、示例库 | 持续 | 开发者生态 |

**WPS 迁移友好性**:schema 取 CustomUI 兼容子集 + 相同回调命名,存量 WPS 加载项把 `wps.*` 调用改为 `GenOffice.*` 即可完成大部分移植 —— 本身就是生态切入点。

## 五、关键风险与对策

1. **性能回归**(Ribbon 是热路径):渲染器必须保持 `memo` + 稳定回调契约;控件粒度订阅 `formatState` 切片;渲染基准测试门禁。
2. **231 个控件迁移量大**:按 group 切 PR、codemod 辅助 JSX→Schema 转换、每步截图回归(`theme-visual` e2e 已有先例)。
3. **API 表面积失控**:首版对象模型只暴露高频 30 个方法;`apiVersion` 严格版本化,不承诺不稳定接口。
4. **安全是生态生死线**:P3(纯声明式)与 P4(代码沙箱)分离发布;沙箱先内部红队再开放。

## 附:关键代码位置索引(实施时对照)

| 用途 | 文件 |
| --- | --- |
| Tab 定义数组 / 标签键 | `apps/docs/src/renderer/components/Ribbon.tsx`(TABS、TAB_LABEL_KEYS) |
| 动作 props 流 | `apps/docs/src/renderer/App.tsx`(ribbonActions → useStableCallbacks) |
| 稳定回调机制 | `apps/docs/src/renderer/use-stable.ts` |
| 选中态快照(50 字段) | `apps/docs/src/renderer/components/ribbon-format-state.ts` |
| 命令分发器先例 | `apps/sheets/src/renderer/ribbon-actions.ts` |
| 菜单命令 IPC 先例 | `apps/docs/src/shared/ipc.ts`(menu:command)+ App.tsx switch |
| 快捷键注册表 | `apps/docs/src/renderer/shortcuts.ts` |
| 图标(docs) | `apps/docs/src/renderer/components/icons.tsx` |
| Ribbon i18n | `apps/docs/src/renderer/i18n/strings-ribbon.ts` |
| 持久化范式 | `packages/project-store` |
| CSP | `apps/docs/src/renderer/index.html` |

## 参考

- [WPS 加载项开发说明(官方)](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-development-instructions)
- [自定义功能区概述 - WPS 开放平台](https://open.wps.cn/previous/docs/client/js-api/load-item/function)
- [wps 加载项 ribbon.js 与 ribbon.xml 的交互(掘金)](https://juejin.cn/post/7539134398828003328)
- [WPS 加载项深入开发代码解析(知乎)](https://zhuanlan.zhihu.com/p/266673886)
- [ribbon.xml 实战:构建 OA 辅助功能区(CSDN)](https://wenku.csdn.net/column/399g31cxmki)
- [Ribbon 菜单话题 - WPS 官方社区](https://bbs.wps.cn/topics/tag/3890)
