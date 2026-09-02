# dsh 应用注册槽位协议（Application Slot Protocol）

**状态**：提案（待 chayuan-harness 合入 PR）。作者：ChatOffice 插件化改造（总体计划 v2.1，决策 #11）。

## 动机

当前 dsh 插件槽位只有 `root`（整体外壳接管，最低 priority 者当选）。生产力应用
（办公套件、IDE 类插件）需要的是**在桌面里注册为一个应用**：Dock 图标、点击开窗、
与 harness 会话窗口并排使用——而不是替换整个界面。root 槽是单赢家，无法表达
“多应用共存”。

## 槽位定义

新槽位：`dsh.app-registry`（多单元格槽，所有注册项共存，无优先级竞选）。

```ts
interface AppRegistrySlot {
  registerApp(app: AppRegistration): Unregister
  unregisterApp(appId: string): void
  listApps(): AppRegistration[]
  openWindow(win: WindowRequest): WindowHandle
}

interface AppRegistration {
  id: string                    // 反向域名，如 "ai.chatoffice.suite"
  title: string                 // Dock/启动台显示名
  icon: string | { dataUrl: string }
  open(request: OpenRequest): void | WindowHandle
}

interface OpenRequest {
  /** 宿主半注入的本地 origin（受管 sidecar）或远端 URL */
  origin?: string
  /** 应用自定义参数（文件路径等） */
  args?: Record<string, unknown>
}

interface WindowRequest {
  appId: string
  url: string
  width?: number
  height?: number
  onReady?(win: PostTarget): void
}

interface WindowHandle {
  close(): void
  postMessage(data: unknown, targetOrigin: string): void
}
```

## 内核铁律的映射

- **注册即效应**：`registerApp` 经 `ctx.effect()` 登记，插件卸载时逆序回滚
  （应用从 Dock 消失，窗口按宿主策略关闭或残留孤儿提示）。
- **插件化而非改内核**：chatop-shell 之类桌面插件向 `dsh.app-registry`
  注册自己的实现（消费端），内核只维护槽位转发；没有桌面插件时内核提供
  fallback 注册表（应用列在官方 harness 界面的侧栏）。
- **组合即清单**：应用插件的 manifest 不变，仅多 `client` 侧依赖声明。

## 安全

- `WindowRequest.url` 仅允许 `http://127.0.0.1:*`（本机受管 sidecar）与经
  用户确认的 https origin；应用不得获得宿主 DOM 权限，窗口即 iframe/WebContents
  边界。
- 凭据经 `postMessage` 定向 origin 传递，宿主不代存。

## 与 chatop-shell 的关系

chatop-shell 继续独占 root；本协议不触碰 root。chatop 桌面作为
`dsh.app-registry` 的第一个消费端，把注册进来的应用渲染为 Dock 图标 +
可拖拽窗口（复用其现有 Safari 窗口机制）。
