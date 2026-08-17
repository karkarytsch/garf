import { useMemo, useRef, useState } from 'react'
import type { ECharts, EChartsOption } from 'echarts'
import { EChart } from '../components/EChart'

type LineSeries = { name: string; color: string; data: Array<{ label: string; value: number }> }
type ScatterSeries = { name: string; color: string; data: Array<[number, number]> }
type BarSeries = { name: string; color: string; data: Array<number | null> }
type HistogramBin = { label: string; count: number }

type DatasetChartProps = {
  type: 'line' | 'scatter' | 'bar' | 'histogram'
  xAxisName: string | null
  lineLabels: string[]
  lineSeries: LineSeries[]
  scatterSeries: ScatterSeries[]
  barCategories: string[]
  barSeries: BarSeries[]
  histogramBins: HistogramBin[]
}

type ClickEvent = { componentType?: string; seriesName?: string; name?: string; value?: number | [number, number] }

export function DatasetChart({ type, xAxisName, lineLabels, lineSeries, scatterSeries, barCategories, barSeries, histogramBins }: DatasetChartProps) {
  const chartRef = useRef<ECharts | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<{ series: string; label: string; value: number } | null>(null)
  const [selectedRangeCount, setSelectedRangeCount] = useState<number | null>(null)
  const usesCategoryZoom = type === 'line' || type === 'bar'

  const option = useMemo<EChartsOption>(() => {
    const common: EChartsOption = {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 56, right: 22, top: 20, bottom: usesCategoryZoom ? 96 : 38 },
      tooltip: {
        trigger: type === 'scatter' ? 'item' : 'axis',
        axisPointer: { type: type === 'scatter' ? 'none' : 'cross', label: { backgroundColor: '#514a43', color: '#fffdf9' } },
        backgroundColor: '#2d2925', borderWidth: 0, padding: [8, 10], textStyle: { color: '#fffdf9', fontSize: 12 },
      },
      legend: { show: false },
    }

    if (type === 'line') {
      return {
        ...common,
        xAxis: { type: 'category', boundaryGap: false, data: lineLabels, name: xAxisName ?? undefined, nameLocation: 'middle', nameGap: 30, axisLine: { lineStyle: { color: '#bdb7ad' } }, axisTick: { show: false }, axisLabel: { color: '#766f65', fontSize: 11, hideOverlap: true } },
        yAxis: { type: 'value', scale: true, splitNumber: 4, axisLabel: { color: '#766f65', fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: '#e8e3da', type: 'dashed' } } },
        dataZoom: [
          { type: 'inside', start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false },
          { type: 'slider', start: 0, end: 100, height: 20, bottom: 5, borderColor: '#d8d1c7', backgroundColor: '#f2eee7', fillerColor: 'rgba(241, 102, 40, 0.16)', handleStyle: { color: '#f16628', borderColor: '#f16628' }, textStyle: { color: '#817970' }, dataBackground: { lineStyle: { color: '#d2c9be' }, areaStyle: { color: '#eee8df' } } },
        ],
        brush: { xAxisIndex: 0, brushType: 'lineX', brushMode: 'single', throttleType: 'fixRate', throttleDelay: 120, brushStyle: { borderColor: '#d85c2a', borderWidth: 1, color: 'rgba(241, 102, 40, 0.14)' } },
        series: lineSeries.map((series) => {
          const values = new Map(series.data.map((point) => [point.label, point.value]))
          return { name: series.name, type: 'line' as const, data: lineLabels.map((label) => values.get(label) ?? null), symbol: 'circle', symbolSize: 5, showSymbol: true, lineStyle: { color: series.color, width: 2.1 }, itemStyle: { color: series.color }, emphasis: { itemStyle: { borderColor: '#fffdf9', borderWidth: 2 } } }
        }),
      }
    }

    if (type === 'scatter') return {
      ...common,
      xAxis: { type: 'value', name: xAxisName ?? undefined, nameLocation: 'middle', nameGap: 28, axisLine: { lineStyle: { color: '#bdb7ad' } }, axisTick: { show: false }, axisLabel: { color: '#766f65', fontSize: 11 }, splitLine: { lineStyle: { color: '#e8e3da', type: 'dashed' } } },
      yAxis: { type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#766f65', fontSize: 11 }, splitLine: { lineStyle: { color: '#e8e3da', type: 'dashed' } } },
      series: scatterSeries.map((series) => ({ name: series.name, type: 'scatter' as const, data: series.data, symbolSize: 7, itemStyle: { color: series.color, opacity: .78 } })),
    }

    if (type === 'bar') return {
      ...common,
      xAxis: { type: 'category', data: barCategories, name: xAxisName ?? undefined, nameLocation: 'middle', nameGap: 30, axisLine: { lineStyle: { color: '#bdb7ad' } }, axisTick: { show: false }, axisLabel: { color: '#766f65', fontSize: 11, hideOverlap: true } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#766f65', fontSize: 11 }, splitLine: { lineStyle: { color: '#e8e3da', type: 'dashed' } } },
      dataZoom: [{ type: 'inside', start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false }, { type: 'slider', start: 0, end: 100, height: 20, bottom: 5, borderColor: '#d8d1c7', backgroundColor: '#f2eee7', fillerColor: 'rgba(241, 102, 40, 0.16)', handleStyle: { color: '#f16628', borderColor: '#f16628' }, textStyle: { color: '#817970' } }],
      series: barSeries.map((series) => ({ name: series.name, type: 'bar' as const, data: series.data, itemStyle: { color: series.color, borderRadius: [3, 3, 0, 0] } })),
    }

    return {
      ...common,
      xAxis: { type: 'category', data: histogramBins.map((bin) => bin.label), axisLine: { lineStyle: { color: '#bdb7ad' } }, axisTick: { show: false }, axisLabel: { color: '#766f65', fontSize: 10, hideOverlap: true } },
      yAxis: { type: 'value', minInterval: 1, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#766f65', fontSize: 11 }, splitLine: { lineStyle: { color: '#e8e3da', type: 'dashed' } } },
      series: [{ name: 'Observations', type: 'bar' as const, data: histogramBins.map((bin) => bin.count), itemStyle: { color: '#f16628', borderRadius: [3, 3, 0, 0] } }],
    }
  }, [barCategories, barSeries, histogramBins, lineLabels, lineSeries, scatterSeries, type, usesCategoryZoom, xAxisName])

  function handleClick(event: ClickEvent) {
    if (event.componentType !== 'series' || typeof event.value !== 'number') return
    setSelectedPoint({ series: event.seriesName ?? 'Series', label: event.name ?? 'Observation', value: event.value })
  }

  function handleBrush(event: { areas?: Array<{ coordRange?: number[][] }> }) {
    const range = event.areas?.[0]?.coordRange?.[0]
    if (!range || type !== 'line') { setSelectedRangeCount(null); return }
    const [start, end] = range
    setSelectedRangeCount(Math.max(0, Math.floor(end) - Math.ceil(start) + 1))
  }

  function activateRangeBrush(chart: ECharts) {
    chartRef.current = chart
    if (type === 'line') chart.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX' } })
  }

  return <>
    {usesCategoryZoom && <div className="echarts-dataset__controls"><span>Scroll to zoom · drag to pan{type === 'line' ? ' · drag on the plot to select a range' : ''}</span><button type="button" onClick={() => { chartRef.current?.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 0, end: 100 }); chartRef.current?.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start: 0, end: 100 }) }}>Reset view</button></div>}
    <EChart className="echarts-dataset" option={option} onReady={activateRangeBrush} onEvents={{ click: (event) => handleClick(event as ClickEvent), brushselected: (event) => handleBrush(event as { areas?: Array<{ coordRange?: number[][] }> }) }} />
    {(selectedPoint || selectedRangeCount !== null) && <p className="echarts-dataset__selection">{selectedPoint && <>Selected observation · <strong>{selectedPoint.series}</strong> · {selectedPoint.label}: {selectedPoint.value.toLocaleString(undefined, { maximumFractionDigits: 6 })}</>}{selectedPoint && selectedRangeCount !== null && ' · '}{selectedRangeCount !== null && <><strong>{selectedRangeCount}</strong> observations selected in chart</>}</p>}
  </>
}
