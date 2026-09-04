import { Component, type ReactNode } from 'react'

/**
 * 图表错误边界:单个图表的渲染/-effect 崩溃(如 formatter 引用缺失全局、
 * dispose 内部态损坏)只降级为占位提示,绝不让 React 卸载整棵应用树
 * (React 19 对未捕获错误默认卸载根节点 → 白屏)。
 */

export interface ChartErrorBoundaryProps {
  /** 降级占位标题(如 "图表") */
  label?: string
  /** 可选的静态快照:崩溃时仍有图可看 */
  fallbackImage?: string | null
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ChartErrorBoundary extends Component<ChartErrorBoundaryProps, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.warn('[chart-kit] chart crashed, showing fallback:', error)
  }

  render(): ReactNode {
    if (this.state.error) {
      const { label, fallbackImage } = this.props
      return (
        <div
          className="ck-chart-fallback"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            minHeight: 160,
            border: '1px solid #eceef1',
            borderRadius: 8,
            padding: 16,
            color: '#8f959e',
          }}
        >
          {fallbackImage ? (
            <img
              src={fallbackImage}
              alt={label ?? 'chart'}
              style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain' }}
            />
          ) : (
            <span style={{ fontSize: 28 }} aria-hidden>
              ▦
            </span>
          )}
          <span style={{ fontSize: 12 }}>
            {label ? `${label} ` : ''}
            图表渲染失败,已降级显示
          </span>
        </div>
      )
    }
    return this.props.children
  }
}
