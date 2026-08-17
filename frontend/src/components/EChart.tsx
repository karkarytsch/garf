import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { ECharts, EChartsOption } from 'echarts'

type EChartProps = {
  option: EChartsOption
  className?: string
  onEvents?: Record<string, (params: unknown) => void>
  onReady?: (chart: ECharts) => void
}

export function EChart({ option, className, onEvents, onReady }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ECharts | null>(null)
  const eventHandlersRef = useRef(onEvents)
  eventHandlersRef.current = onEvents

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = echarts.init(container, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    onReady?.(chart)
    Object.keys(eventHandlersRef.current ?? {}).forEach((eventName) => {
      chart.on(eventName, (params: unknown) => eventHandlersRef.current?.[eventName]?.(params))
    })

    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container)

    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true, lazyUpdate: true })
  }, [option])

  return <div ref={containerRef} className={className} />
}
