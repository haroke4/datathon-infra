import { Component, lazy, Suspense } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AnalyticsDashboard as DashboardType } from './analytics'

type Props = ComponentProps<typeof DashboardType>
const Dashboard = lazy(() =>
  import('./analytics').then((module) => ({
    default: module.AnalyticsDashboard,
  }))
)

// Analytics loads only when opened. Its loading/render failures stay inside this page.
class AnalyticsBoundary extends Component<
  { children: ReactNode; onUpload: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed)
      return (
        <div className="processing-state error-state">
          <TriangleAlert size={26} />
          <h1>Не удалось открыть аналитику</h1>
          <p role="alert">
            Можно продолжить загрузку и просмотр видео через сайдбар.
          </p>
          <Button variant="outline" onClick={this.props.onUpload}>
            К загрузке видео
          </Button>
        </div>
      )
    return this.props.children
  }
}

export function AnalyticsDashboard(props: Props) {
  return (
    <AnalyticsBoundary onUpload={props.onUpload}>
      <Suspense
        fallback={
          <div className="analytics-loading" role="status">
            <LoaderCircle className="animate-spin" size={24} />
            Загружаем аналитику…
          </div>
        }
      >
        <Dashboard {...props} />
      </Suspense>
    </AnalyticsBoundary>
  )
}
