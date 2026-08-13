import { useEffect, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { deleteDataset, deleteVariable, getDatasets, getDescriptiveStatistics, getPreview, queryPreview, renameVariable, setDateOnlyDisplay, uploadDataset } from '../api'
import type { DatasetPreview, DatasetSummary, DescriptiveStatistic, FilterOperator, PreviewFilter, VariableMetadata } from '../api'

interface UploadButtonProps {
  className?: string
  isImporting: boolean
  label?: string
  onFileSelected: (event: ChangeEvent<HTMLInputElement>) => void
}

type PendingDeletion =
  | { kind: 'dataset'; label: string }
  | { kind: 'variable'; name: string }

const SKIP_DATASET_DELETE_CONFIRMATION_KEY = 'garf.skipDatasetDeleteConfirmation'
const SKIP_VARIABLE_DELETE_CONFIRMATION_KEY = 'garf.skipVariableDeleteConfirmation'
const PREVIEW_SCROLL_LIMIT = 1000
const PREVIEW_FILTERS_KEY = 'garf.previewFilters'

const FILTER_LABELS: Record<FilterOperator, string> = {
  equals: 'is', not_equals: 'is not', contains: 'contains', greater_than: 'is greater than', less_than: 'is less than', between: 'is between', before: 'is before', after: 'is after', is_missing: 'is missing', is_not_missing: 'is not missing',
}

function operatorsFor(variable: VariableMetadata): FilterOperator[] {
  if (variable.logical_type === 'numeric') return ['equals', 'not_equals', 'greater_than', 'less_than', 'between', 'is_missing', 'is_not_missing']
  if (variable.logical_type === 'datetime') return ['equals', 'not_equals', 'before', 'after', 'between', 'is_missing', 'is_not_missing']
  return ['equals', 'not_equals', 'contains', 'is_missing', 'is_not_missing']
}

function readSavedFilters(datasetId: string): PreviewFilter[] {
  try {
    const stored = JSON.parse(localStorage.getItem(PREVIEW_FILTERS_KEY) ?? '{}') as Record<string, PreviewFilter[]>
    return Array.isArray(stored[datasetId]) ? stored[datasetId] : []
  } catch { return [] }
}

function saveFilters(datasetId: string, filters: PreviewFilter[]) {
  try {
    const stored = JSON.parse(localStorage.getItem(PREVIEW_FILTERS_KEY) ?? '{}') as Record<string, PreviewFilter[]>
    if (filters.length) stored[datasetId] = filters
    else delete stored[datasetId]
    localStorage.setItem(PREVIEW_FILTERS_KEY, JSON.stringify(stored))
  } catch { /* Storage may be unavailable in a restricted browser context. */ }
}

function UploadButton({ className = '', isImporting, label = 'Upload dataset', onFileSelected }: UploadButtonProps) {
  return (
    <label className={`button button--primary ${className}`}>
      <span aria-hidden="true">↑</span>
      {isImporting ? 'Importing…' : label}
      <input type="file" accept=".csv,.xlsx,.parquet" aria-label={label} disabled={isImporting} onChange={onFileSelected} />
    </label>
  )
}

function valueForCell(value: unknown) {
  if (value === null || value === undefined) return '—'
  return String(value)
}

export function StudentWorkspacePage() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [dataset, setDataset] = useState<DatasetSummary | null>(null)
  const [preview, setPreview] = useState<DatasetPreview | null>(null)
  const [filters, setFilters] = useState<PreviewFilter[]>([])
  const [draftColumn, setDraftColumn] = useState('')
  const [draftOperator, setDraftOperator] = useState<FilterOperator>('equals')
  const [draftValue, setDraftValue] = useState('')
  const [draftSecondValue, setDraftSecondValue] = useState('')
  const [isFiltering, setIsFiltering] = useState(false)
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'ascending' | 'descending' | null>(null)
  const [isSorting, setIsSorting] = useState(false)
  const [isDataCollapsed, setIsDataCollapsed] = useState(false)
  const [isAnalysisCollapsed, setIsAnalysisCollapsed] = useState(false)
  const [isResultsCollapsed, setIsResultsCollapsed] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deletingVariable, setDeletingVariable] = useState<string | null>(null)
  const [renamingVariable, setRenamingVariable] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null)
  const [skipDatasetDeleteConfirmation, setSkipDatasetDeleteConfirmation] = useState(() => localStorage.getItem(SKIP_DATASET_DELETE_CONFIRMATION_KEY) === 'true')
  const [skipVariableDeleteConfirmation, setSkipVariableDeleteConfirmation] = useState(() => localStorage.getItem(SKIP_VARIABLE_DELETE_CONFIRMATION_KEY) === 'true')
  const [selectedDateSuggestion, setSelectedDateSuggestion] = useState<string | null>(null)
  const [isApplyingDateDisplay, setIsApplyingDateDisplay] = useState(false)
  const [chartType, setChartType] = useState<'line' | 'scatter' | 'bar' | 'histogram'>('line')
  const [plotXAxis, setPlotXAxis] = useState<string | null>(null)
  const [plotYAxes, setPlotYAxes] = useState<string[]>([])
  const [draggingVariable, setDraggingVariable] = useState<string | null>(null)
  const [activeDropZone, setActiveDropZone] = useState<'x' | 'y' | null>(null)
  const [canvasMode, setCanvasMode] = useState<'builder' | 'preview' | 'chart' | 'model'>('builder')
  const [isChartSettingsOpen, setIsChartSettingsOpen] = useState(false)
  const [chartFrequency, setChartFrequency] = useState<'original' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'>('original')
  const [chartAggregation, setChartAggregation] = useState<'mean' | 'sum' | 'last'>('mean')
  const [chartTransformation, setChartTransformation] = useState<'original' | 'simple_diff' | 'log_diff'>('original')
  const [chartStartDate, setChartStartDate] = useState('')
  const [chartEndDate, setChartEndDate] = useState('')
  const [chartZoom, setChartZoom] = useState(1)
  const [chartZoomStart, setChartZoomStart] = useState(0)
  const [isRestoring, setIsRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function activateDataset(nextDataset: DatasetSummary) {
    const savedFilters = readSavedFilters(nextDataset.id)
    const nextPreview = savedFilters.length
      ? await queryPreview(nextDataset.id, savedFilters, null, false, 0, PREVIEW_SCROLL_LIMIT)
      : await getPreview(nextDataset.id, null, false, 0, PREVIEW_SCROLL_LIMIT)
    const firstVariable = nextDataset.variables[0]
    setDataset(nextDataset)
    setPlotXAxis(null)
    setPlotYAxes([])
    setDraggingVariable(null)
    setActiveDropZone(null)
    setCanvasMode('builder')
    setIsChartSettingsOpen(false)
    setChartFrequency('original')
    setChartAggregation('mean')
    setChartTransformation('original')
    setChartStartDate('')
    setChartEndDate('')
    setSortColumn(null)
    setSortDirection(null)
    setFilters(savedFilters)
    setDraftColumn(firstVariable?.name ?? '')
    setDraftOperator(firstVariable ? operatorsFor(firstVariable)[0] : 'equals')
    setDraftValue('')
    setDraftSecondValue('')
    setPreview(nextPreview)
  }

  useEffect(() => {
    let isCurrent = true

    async function restoreLatestDataset() {
      try {
        const savedDatasets = await getDatasets()
        if (!isCurrent) return
        setDatasets(savedDatasets)
        if (savedDatasets[0]) await activateDataset(savedDatasets[0])
      } catch {
        // A new workspace or a temporarily unavailable local API starts empty.
      } finally {
        if (isCurrent) setIsRestoring(false)
      }
    }

    void restoreLatestDataset()
    return () => { isCurrent = false }
  }, [])

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    setIsImporting(true)
    try {
      const imported = await uploadDataset(file)
      const importedPreview = await getPreview(imported.id, null, false, 0, PREVIEW_SCROLL_LIMIT)
      const firstVariable = imported.variables[0]
      setDatasets((current) => [imported, ...current.filter((item) => item.id !== imported.id)])
      setDataset(imported)
      setPlotXAxis(null)
      setPlotYAxes([])
      setDraggingVariable(null)
      setActiveDropZone(null)
      setCanvasMode('builder')
      setSortColumn(null)
    setSortDirection(null)
      setFilters([])
      setDraftColumn(firstVariable?.name ?? '')
      setDraftOperator(firstVariable ? operatorsFor(firstVariable)[0] : 'equals')
      setDraftValue('')
      setDraftSecondValue('')
      setPreview(importedPreview)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Garf could not import this dataset.')
    } finally {
      setIsImporting(false)
    }
  }

  async function handleDatasetSelection(nextDataset: DatasetSummary) {
    if (nextDataset.id === dataset?.id) return
    setError(null)
    try {
      await activateDataset(nextDataset)
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'Garf could not load this dataset.')
    }
  }

  async function handleDeleteDataset() {
    if (!dataset || isDeleting) return

    setError(null)
    setIsDeleting(true)
    try {
      await deleteDataset(dataset.id)
      const remaining = datasets.filter((item) => item.id !== dataset.id)
      setDatasets(remaining)
      if (remaining[0]) {
        await activateDataset(remaining[0])
      } else {
        setDataset(null)
        setPreview(null)
      }
    } catch (deletionError) {
      setError(deletionError instanceof Error ? deletionError.message : 'Garf could not delete this dataset.')
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleDeleteVariable(variableName: string) {
    if (!dataset || deletingVariable || dataset.variables.length <= 1) return

    setError(null)
    setDeletingVariable(variableName)
    try {
      const updatedDataset = await deleteVariable(dataset.id, variableName)
      const updatedPreview = await getPreview(updatedDataset.id)
      setDataset(updatedDataset)
      setPlotXAxis((current) => current === variableName ? null : current)
      setPlotYAxes((current) => current.filter((item) => item !== variableName))
      setSortColumn(null)
    setSortDirection(null)
      setPreview(updatedPreview)
      setSelectedDateSuggestion(null)
      setDatasets((current) => current.map((item) => item.id === updatedDataset.id ? updatedDataset : item))
    } catch (deletionError) {
      setError(deletionError instanceof Error ? deletionError.message : 'Garf could not delete this variable.')
    } finally {
      setDeletingVariable(null)
    }
  }

  function beginRename(variableName: string) {
    setError(null)
    setRenamingVariable(variableName)
    setRenameValue(variableName)
  }

  async function handleRenameVariable(variableName: string) {
    if (!dataset || isRenaming) return
    const newName = renameValue.trim()
    if (!newName) {
      setError('Enter a variable name.')
      return
    }
    setError(null)
    setIsRenaming(true)
    try {
      const updatedDataset = await renameVariable(dataset.id, variableName, newName)
      const renamedFilters = filters.map((filter) => filter.column === variableName ? { ...filter, column: newName } : filter)
      const renamedSortColumn = sortColumn === variableName ? newName : sortColumn
      const updatedPreview = renamedFilters.length
        ? await queryPreview(updatedDataset.id, renamedFilters, renamedSortColumn, sortDirection === 'descending', 0, PREVIEW_SCROLL_LIMIT)
        : await getPreview(updatedDataset.id, renamedSortColumn, sortDirection === 'descending', 0, PREVIEW_SCROLL_LIMIT)
      setDataset(updatedDataset)
      setDatasets((current) => current.map((item) => item.id === updatedDataset.id ? updatedDataset : item))
      setFilters(renamedFilters)
      saveFilters(updatedDataset.id, renamedFilters)
      setDraftColumn((current) => current === variableName ? newName : current)
      setSortColumn(renamedSortColumn)
      setPlotXAxis((current) => current === variableName ? newName : current)
      setPlotYAxes((current) => current.map((item) => item === variableName ? newName : item))
      setSelectedDateSuggestion((current) => current === variableName ? newName : current)
      setPreview(updatedPreview)
      setRenamingVariable(null)
      setRenameValue('')
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Garf could not rename this variable.')
    } finally {
      setIsRenaming(false)
    }
  }

  function requestDeletion(nextDeletion: PendingDeletion) {
    const shouldSkipConfirmation = nextDeletion.kind === 'dataset'
      ? skipDatasetDeleteConfirmation
      : skipVariableDeleteConfirmation
    if (shouldSkipConfirmation) {
      if (nextDeletion.kind === 'dataset') void handleDeleteDataset()
      else void handleDeleteVariable(nextDeletion.name)
      return
    }
    setPendingDeletion(nextDeletion)
  }

  function handleDeletionPreference(kind: PendingDeletion['kind'], enabled: boolean) {
    if (kind === 'dataset') {
      setSkipDatasetDeleteConfirmation(enabled)
      localStorage.setItem(SKIP_DATASET_DELETE_CONFIRMATION_KEY, String(enabled))
      return
    }
    setSkipVariableDeleteConfirmation(enabled)
    localStorage.setItem(SKIP_VARIABLE_DELETE_CONFIRMATION_KEY, String(enabled))
  }

  function confirmDeletion() {
    if (!pendingDeletion) return
    const deletion = pendingDeletion
    setPendingDeletion(null)
    if (deletion.kind === 'dataset') void handleDeleteDataset()
    else void handleDeleteVariable(deletion.name)
  }

  async function handlePreviewSort(nextSortColumn: string) {
    if (!dataset || isSorting) return
    const nextDirection = nextSortColumn !== sortColumn
      ? 'ascending'
      : sortDirection === 'ascending'
        ? 'descending'
        : null
    const requestedColumn = nextDirection ? nextSortColumn : null
    setError(null)
    setIsSorting(true)
    try {
      const nextPreview = filters.length
        ? await queryPreview(dataset.id, filters, requestedColumn, nextDirection === 'descending', 0, PREVIEW_SCROLL_LIMIT)
        : await getPreview(dataset.id, requestedColumn, nextDirection === 'descending', 0, PREVIEW_SCROLL_LIMIT)
      setSortColumn(requestedColumn)
      setSortDirection(nextDirection)
      setPreview(nextPreview)
      setSelectedDateSuggestion(null)
    } catch (sortError) {
      setError(sortError instanceof Error ? sortError.message : 'Garf could not sort this preview.')
    } finally {
      setIsSorting(false)
    }
  }

  async function updateFilters(nextFilters: PreviewFilter[]) {
    if (!dataset || isFiltering) return
    setError(null)
    setIsFiltering(true)
    try {
      const nextPreview = nextFilters.length
        ? await queryPreview(dataset.id, nextFilters, sortColumn, sortDirection === 'descending', 0, PREVIEW_SCROLL_LIMIT)
        : await getPreview(dataset.id, sortColumn, sortDirection === 'descending', 0, PREVIEW_SCROLL_LIMIT)
      setFilters(nextFilters)
      saveFilters(dataset.id, nextFilters)
      setPreview(nextPreview)
      setSelectedDateSuggestion(null)
    } catch (filterError) {
      setError(filterError instanceof Error ? filterError.message : 'Garf could not apply these filters.')
    } finally { setIsFiltering(false) }
  }

  function handleDraftColumnChange(column: string) {
    const variable = dataset?.variables.find((item) => item.name === column)
    if (!variable) return
    setDraftColumn(column)
    setDraftOperator(operatorsFor(variable)[0])
    setDraftValue('')
    setDraftSecondValue('')
  }

  function addFilter() {
    if (!dataset || !draftColumn) return
    const noValueRequired = draftOperator === 'is_missing' || draftOperator === 'is_not_missing'
    if (!noValueRequired && !draftValue.trim()) {
      setError('Enter a value for this filter.')
      return
    }
    if (draftOperator === 'between' && !draftSecondValue.trim()) {
      setError('Enter both values for this filter.')
      return
    }
    const rule: PreviewFilter = { column: draftColumn, operator: draftOperator, ...(noValueRequired ? {} : { value: draftValue.trim() }), ...(draftOperator === 'between' ? { second_value: draftSecondValue.trim() } : {}) }
    void updateFilters([...filters, rule])
  }

  function removeFilter(index: number) { void updateFilters(filters.filter((_, itemIndex) => itemIndex !== index)) }
  function clearFilters() { void updateFilters([]) }

  async function handleApplyDateDisplay() {
    if (!dataset || !selectedDateSuggestion || isApplyingDateDisplay) return
    setError(null)
    setIsApplyingDateDisplay(true)
    try {
      await setDateOnlyDisplay(dataset.id, selectedDateSuggestion)
      setPreview(await getPreview(dataset.id))
      setSelectedDateSuggestion(null)
    } catch (dateError) {
      setError(dateError instanceof Error ? dateError.message : 'Garf could not apply this date display.')
    } finally {
      setIsApplyingDateDisplay(false)
    }
  }

  function handleVariableDragStart(event: DragEvent<HTMLLIElement>, variableName: string) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', variableName)
    setDraggingVariable(variableName)
  }

  function handleVariableDrop(event: DragEvent<HTMLDivElement>, target: 'x' | 'y') {
    event.preventDefault()
    const variableName = event.dataTransfer.getData('text/plain') || draggingVariable
    if (!variableName) return
    if (target === 'x') setPlotXAxis(variableName)
    else setPlotYAxes((current) => chartType === 'histogram' ? [variableName] : current.includes(variableName) ? current : [...current, variableName])
    setDraggingVariable(null)
    setActiveDropZone(null)
  }

  function clearDroppedVariable(target: 'x' | 'y', variableName?: string) {
    if (target === 'x') setPlotXAxis(null)
    else if (variableName) setPlotYAxes((current) => current.filter((item) => item !== variableName))
  }

  const draftVariable = dataset?.variables.find((item) => item.name === draftColumn)
  const draftOperators = draftVariable ? operatorsFor(draftVariable) : ['equals'] as FilterOperator[]
  const chartRows = preview?.rows ?? []
  const chartPalette = ['#e65f2d', '#24766b', '#7467a4', '#b98422', '#4d7195']
  const datedChartRows = plotXAxis ? chartRows.map((row) => ({ row, date: new Date(String(row[plotXAxis])) })).filter((item) => !Number.isNaN(item.date.getTime())) : []
  const availableStartDate = datedChartRows[0]?.date.toISOString().slice(0, 10) ?? ''
  const availableEndDate = datedChartRows.at(-1)?.date.toISOString().slice(0, 10) ?? ''
  const selectedStart = chartStartDate ? new Date(`${chartStartDate}T00:00:00`) : null
  const selectedEnd = chartEndDate ? new Date(`${chartEndDate}T23:59:59.999`) : null
  const filteredChartRows = datedChartRows.filter(({ date }) => (!selectedStart || date >= selectedStart) && (!selectedEnd || date <= selectedEnd))
  const rawTimestampGaps = datedChartRows.slice(1).map((item, index) => (item.date.getTime() - datedChartRows[index].date.getTime()) / 86_400_000)
  const timestampGaps = rawTimestampGaps.filter((gap) => gap > 0).sort((left, right) => left - right)
  const medianGapDays = timestampGaps.length ? timestampGaps[Math.floor(timestampGaps.length / 2)] : null
  const timestampsAreOrdered = rawTimestampGaps.length > 0 && rawTimestampGaps.every((gap) => gap > 0)
  const nativeFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null = !timestampsAreOrdered || medianGapDays === null ? null : medianGapDays <= 1.5 ? 'daily' : medianGapDays <= 8.5 ? 'weekly' : medianGapDays <= 35 ? 'monthly' : medianGapDays <= 100 ? 'quarterly' : 'yearly'
  const frequencyOrder = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const
  const availableChartFrequencies = nativeFrequency ? frequencyOrder.slice(frequencyOrder.indexOf(nativeFrequency) + 1) : []
  useEffect(() => {
    if (chartFrequency !== 'original' && !availableChartFrequencies.includes(chartFrequency)) setChartFrequency('original')
  }, [chartFrequency, availableChartFrequencies.join('|')])
  const bucketKey = (date: Date) => {
    if (chartFrequency === 'original' || chartFrequency === 'daily') return date.toISOString()
    if (chartFrequency === 'weekly') { const monday = new Date(date); const day = (monday.getDay() + 6) % 7; monday.setDate(monday.getDate() - day); return monday.toISOString().slice(0, 10) }
    if (chartFrequency === 'monthly') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (chartFrequency === 'quarterly') return `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}`
    return String(date.getFullYear())
  }
  const chartBuckets = Array.from(filteredChartRows.reduce((buckets, item) => {
    // Original/daily ticks should match the user-facing preview format (e.g. YYYY-MM-DD),
    // rather than reconstructing a full ISO value from the JavaScript Date object.
    const key = (chartFrequency === 'original' || chartFrequency === 'daily') && plotXAxis
      ? valueForCell(item.row[plotXAxis])
      : bucketKey(item.date)
    const current = buckets.get(key) ?? []
    current.push(item)
    buckets.set(key, current)
    return buckets
  }, new Map<string, typeof filteredChartRows>()).entries())
  const visibleBucketCount = Math.max(2, Math.ceil(chartBuckets.length / chartZoom))
  const maximumZoomStart = Math.max(0, chartBuckets.length - visibleBucketCount)
  const safeZoomStart = Math.min(chartZoomStart, maximumZoomStart)
  const visibleChartBuckets = chartBuckets.slice(safeZoomStart, safeZoomStart + visibleBucketCount)
  const aggregate = (values: number[]) => chartAggregation === 'sum' ? values.reduce((total, value) => total + value, 0) : chartAggregation === 'last' ? values.at(-1)! : values.reduce((total, value) => total + value, 0) / values.length
  const chartSeries = plotYAxes.map((name, index) => {
    const baseValues = visibleChartBuckets.map(([label, bucket]) => ({ label, value: aggregate(bucket.map(({ row }) => Number(row[name])).filter(Number.isFinite)) })).filter((item) => Number.isFinite(item.value))
    const transformedValues = chartTransformation === 'original' ? baseValues : baseValues.slice(1).map((item, itemIndex) => {
      const previous = baseValues[itemIndex].value
      return { label: item.label, value: chartTransformation === 'log_diff' && previous > 0 && item.value > 0 ? Math.log(item.value) - Math.log(previous) : chartTransformation === 'simple_diff' ? item.value - previous : Number.NaN }
    }).filter((item) => Number.isFinite(item.value))
    const values = transformedValues.map((item) => item.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const points = transformedValues.map((item, itemIndex) => {
      const x = transformedValues.length <= 1 ? 50 : 7 + (itemIndex / (transformedValues.length - 1)) * 89
      const y = 91 - ((item.value - min) / span) * 78
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    return { name, color: chartPalette[index % chartPalette.length], min, max, points }
  }).filter((series) => series.points.length > 0)
  const displayedPeriodLabels = visibleChartBuckets.map(([label]) => label)
  const chartStartLabel = displayedPeriodLabels[0] ?? ''
  const chartEndLabel = displayedPeriodLabels.at(-1) ?? ''
  const chartTickCount = Math.min(6, displayedPeriodLabels.length)
  const chartDateTicks = Array.from({ length: chartTickCount }, (_, index) => {
    const labelIndex = chartTickCount <= 1 ? 0 : Math.round((index / (chartTickCount - 1)) * (displayedPeriodLabels.length - 1))
    return { label: displayedPeriodLabels[labelIndex], position: chartTickCount <= 1 ? 50 : index / (chartTickCount - 1) * 100 }
  })
  function changeChartZoom(direction: 'in' | 'out') {
    setChartZoom((current) => {
      const next = direction === 'in' ? Math.min(8, current * 2) : Math.max(1, current / 2)
      if (next === 1) setChartZoomStart(0)
      return next
    })
  }
  function panChart(direction: 'back' | 'forward') {
    const step = Math.max(1, Math.floor(visibleBucketCount * .45))
    setChartZoomStart((current) => Math.max(0, Math.min(maximumZoomStart, current + (direction === 'forward' ? step : -step))))
  }
  const scatterSeries = plotYAxes.map((name, index) => {
    const pairs = chartRows.map((row) => ({ x: Number(row[plotXAxis ?? '']), y: Number(row[name]) })).filter((pair) => Number.isFinite(pair.x) && Number.isFinite(pair.y))
    const xValues = pairs.map((pair) => pair.x); const yValues = pairs.map((pair) => pair.y)
    const xMin = Math.min(...xValues); const xSpan = Math.max(...xValues) - xMin || 1; const yMin = Math.min(...yValues); const ySpan = Math.max(...yValues) - yMin || 1
    return { name, color: chartPalette[index % chartPalette.length], points: pairs.map((pair) => `${(7 + ((pair.x - xMin) / xSpan) * 89).toFixed(2)},${(91 - ((pair.y - yMin) / ySpan) * 78).toFixed(2)}`) }
  }).filter((series) => series.points.length > 0)
  const barCategories = chartRows.map((row) => valueForCell(row[plotXAxis ?? '']))
  const barValues = plotYAxes.map((name, seriesIndex) => ({ name, color: chartPalette[seriesIndex % chartPalette.length], values: chartRows.map((row) => Number(row[name])) }))
  const barMaximum = Math.max(1, ...barValues.flatMap((series) => series.values).filter(Number.isFinite))
  const histogramValues = plotYAxes.length ? chartRows.map((row) => Number(row[plotYAxes[0]])).filter(Number.isFinite) : []
  const histogramMin = Math.min(...histogramValues); const histogramMax = Math.max(...histogramValues); const histogramWidth = (histogramMax - histogramMin || 1) / 10
  const histogramBins = Array.from({ length: 10 }, (_, index) => ({ start: histogramMin + index * histogramWidth, count: histogramValues.filter((value) => index === 9 ? value >= histogramMin + index * histogramWidth && value <= histogramMax : value >= histogramMin + index * histogramWidth && value < histogramMin + (index + 1) * histogramWidth).length }))
  const histogramMaxCount = Math.max(1, ...histogramBins.map((bin) => bin.count))
  const chartCanRender = chartType === 'line' ? chartSeries.length > 0 : chartType === 'scatter' ? scatterSeries.length > 0 : chartType === 'bar' ? barValues.some((series) => series.values.some(Number.isFinite)) : histogramValues.length > 0

  return (
    <main className="workspace-page">
      <header className="workspace-topbar">
        <Link className="workspace-brand" to="/" aria-label="Return to role selection">
          <img className="brand-logo brand-logo--topbar" src="/garf-logo.png" alt="Garf" />
        </Link>
        <div className="workspace-crumb"><span className="workspace-crumb__dot" aria-hidden="true" /><span>Student workspace</span></div>
        <div className="workspace-project"><span className="workspace-project__label">Project</span><strong>Untitled project</strong><span className="workspace-project__chevron" aria-hidden="true">⌄</span></div>
        <span className="workspace-status"><span aria-hidden="true" /> {isRestoring ? 'Restoring workspace' : dataset ? 'Dataset ready' : 'Ready to explore'}</span>
      </header>

      <section className={`workspace ${isDataCollapsed ? 'workspace--data-collapsed' : ''} ${isAnalysisCollapsed ? 'workspace--analysis-collapsed' : ''} ${isResultsCollapsed ? 'workspace--results-collapsed' : ''}`} aria-label="Student analysis workspace">
        <aside className={`workspace-panel workspace-data ${isDataCollapsed ? 'is-collapsed' : ''}`} aria-labelledby="data-title">
          <div className="panel-heading">
            <div><p className="panel-kicker">01 / Source</p><h1 id="data-title">Data</h1></div>
            <div className="panel-heading__actions"><UploadButton className="button--small" label="Add dataset" isImporting={isImporting} onFileSelected={handleFileSelected} /><button className="panel-toggle" type="button" onClick={() => setIsDataCollapsed((current) => !current)} aria-expanded={!isDataCollapsed} aria-label={isDataCollapsed ? 'Open Data panel' : 'Hide Data panel'} title={isDataCollapsed ? 'Open Data' : 'Hide Data'}><span aria-hidden="true">{isDataCollapsed ? '›' : '‹'}</span></button></div>
          </div>

          {dataset ? (
            <div className="dataset-details">
              <div
                className="dataset-summary dataset-summary--selectable"
                role="button"
                tabIndex={0}
                onClick={(event) => { if (!(event.target as HTMLElement).closest('button')) setCanvasMode('preview') }}
                onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !(event.target as HTMLElement).closest('button')) { event.preventDefault(); setCanvasMode('preview') } }}
                aria-label={`Open preview for ${dataset.original_filename}`}
              >
                <div className="dataset-summary__actions">
                  <span className="dataset-summary__format">{dataset.source_format.toUpperCase()}</span>
                  <button
                    className="delete-dataset"
                    type="button"
                    onClick={() => requestDeletion({ kind: 'dataset', label: dataset.original_filename })}
                    disabled={isDeleting}
                    aria-label={isDeleting ? 'Deleting dataset' : `Delete ${dataset.original_filename}`}
                    title={isDeleting ? 'Deleting dataset' : 'Delete dataset'}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M4 7h16M10 11v6m4-6v6M9 7l.7-2h4.6l.7 2M6.5 7l.6 12h9.8l.6-12" />
                    </svg>
                  </button>
                </div>
                <strong title={dataset.original_filename}>{dataset.original_filename}</strong>
                <p>{dataset.row_count.toLocaleString()} rows · {dataset.column_count} variables</p>
              </div>

              {datasets.length > 1 && (
                <div className="dataset-switcher">
                  <p className="dataset-switcher__label">Saved datasets</p>
                  <ul>
                    {datasets.map((item) => (
                      <li key={item.id}>
                        <button className={item.id === dataset.id ? 'is-active' : ''} type="button" onClick={() => void handleDatasetSelection(item)}>
                          <span>{item.original_filename}</span><small>{item.row_count.toLocaleString()} rows</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <ul className="variable-list" aria-label="Dataset variables">
                {dataset.variables.map((variable) => {
                  const isOnlyVariable = dataset.variables.length === 1
                  const isDeletingThisVariable = deletingVariable === variable.name
                  return (
                    <li
                      key={variable.name}
                      className={`variable-row variable-row--draggable ${draggingVariable === variable.name ? 'is-dragging' : ''}`}
                      draggable
                      onDragStart={(event) => handleVariableDragStart(event, variable.name)}
                      onDragEnd={() => { setDraggingVariable(null); setActiveDropZone(null) }}
                      title={`Drag ${variable.name} into the visualization builder`}
                    >
                      <span className={`variable-type variable-type--${variable.logical_type}`} aria-hidden="true" />
                      <button
                        className="delete-variable"
                        type="button"
                        onClick={() => requestDeletion({ kind: 'variable', name: variable.name })}
                        disabled={isOnlyVariable || Boolean(deletingVariable)}
                        aria-label={isOnlyVariable ? 'A dataset must retain one variable' : isDeletingThisVariable ? `Deleting ${variable.name}` : `Delete ${variable.name}`}
                        title={isOnlyVariable ? 'A dataset must retain one variable' : isDeletingThisVariable ? 'Deleting variable' : 'Delete variable'}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M4 7h16M10 11v6m4-6v6M9 7l.7-2h4.6l.7 2M6.5 7l.6 12h9.8l.6-12" />
                        </svg>
                      </button>
                      {renamingVariable === variable.name ? (
                        <form className="rename-variable-form" onSubmit={(event) => { event.preventDefault(); void handleRenameVariable(variable.name) }} onClick={(event) => event.stopPropagation()}>
                          <input aria-label={`New name for ${variable.name}`} autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setRenamingVariable(null); setRenameValue('') } }} disabled={isRenaming} />
                          <button type="submit" disabled={isRenaming}>{isRenaming ? '…' : 'Save'}</button>
                          <button type="button" onClick={() => { setRenamingVariable(null); setRenameValue('') }} disabled={isRenaming}>Cancel</button>
                        </form>
                      ) : <><span>{variable.name}</span><button className="rename-variable" type="button" onClick={(event) => { event.stopPropagation(); beginRename(variable.name) }} onMouseDown={(event) => event.stopPropagation()} aria-label={`Rename ${variable.name}`} title="Rename variable"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m4 16.5-.7 4.2 4.2-.7L18.7 8.8 15.2 5.3 4 16.5Zm9.8-11.2 3.5 3.5m-10 7.2 2.3.5.5 2.3" /></svg></button><small>{variable.logical_type}</small></>}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            <div className="data-empty">
              <div className="data-empty__glyph" aria-hidden="true">⌁</div><h2>No dataset loaded</h2>
              <p>Upload a CSV, XLSX, or Parquet file to begin.</p>
              <UploadButton className="button--small" isImporting={isImporting} onFileSelected={handleFileSelected} />
            </div>
          )}

          <div className="sidebar-footnote"><span className="sidebar-footnote__rule" /><p>{dataset ? 'Select variables to build your first visualization.' : 'Variables become building blocks for charts and analyses.'}</p></div>
        </aside>

        <section className="workspace-canvas" aria-labelledby="canvas-title">
          <div className="canvas-header"><div><p className="panel-kicker">02 / Canvas</p><h2 id="canvas-title">Visualization</h2></div><span className="canvas-header__state">{dataset ? 'Dataset preview' : 'No view selected'}</span></div>

          {dataset ? (
            canvasMode === 'model' ? (
              <div className="model-builder">
                <div className="model-builder__intro">
                  <div><p className="upload-stage__eyebrow">Model builder</p><h3>Build a model</h3><p>Choose an analysis family, then select the variables and specifications for your dataset.</p></div>
                  <button type="button" className="canvas-mode-button" onClick={() => setCanvasMode('preview')}>Back to preview <span aria-hidden="true">→</span></button>
                </div>
                <div className="model-builder__choices" aria-label="Model families">
                  <button type="button" className="model-builder__choice" disabled><span className="model-builder__number">01</span><span><strong>Descriptive statistics</strong><small>Summaries, distributions, and missing-value diagnostics.</small></span><i aria-hidden="true">Coming next</i></button>
                  <button type="button" className="model-builder__choice" disabled><span className="model-builder__number">02</span><span><strong>Regression</strong><small>Specify outcome, predictors, controls, and estimation settings.</small></span><i aria-hidden="true">Coming next</i></button>
                  <button type="button" className="model-builder__choice" disabled><span className="model-builder__number">03</span><span><strong>Time-series model</strong><small>Choose variables, transformations, lags, and time settings.</small></span><i aria-hidden="true">Coming next</i></button>
                </div>
                <div className="model-builder__hint"><span aria-hidden="true">✦</span><p>Model specifications and reproducible operation history will appear here next. Your data preview and visualizations remain unchanged.</p></div>
              </div>
            ) : canvasMode === 'chart' ? (
              <div className="chart-stage">
                <div className="chart-stage__toolbar">
                  <div><p className="upload-stage__eyebrow">{chartType === 'scatter' ? 'Scatter plot' : chartType === 'bar' ? 'Bar chart' : chartType === 'histogram' ? 'Histogram' : 'Line chart'}</p><h3>{plotYAxes.length === 1 ? plotYAxes[0] : `${plotYAxes.length} selected series`}</h3><p>{chartType === 'histogram' ? `${chartRows.length.toLocaleString()} observations shown` : `${plotXAxis} on the horizontal axis · ${chartRows.length.toLocaleString()} observations shown`}</p></div>
                  <button type="button" className="canvas-mode-button" onClick={() => setCanvasMode('builder')}>Edit variables <span aria-hidden="true">→</span></button>
                </div>
                {chartCanRender ? <>
                  <div className="chart-stage__legend" aria-label="Chart series legend">{(chartType === 'scatter' ? scatterSeries : chartType === 'histogram' ? [{ name: plotYAxes[0], color: chartPalette[0] }] : chartSeries).map((series) => <span key={series.name}><i style={{ backgroundColor: series.color }} />{series.name}</span>)}</div>
                  {chartType === 'line' && chartBuckets.length > 2 && <div className="chart-zoom-controls" aria-label="Chart zoom controls">
                    <span>{chartZoom > 1 ? `${chartZoom}× zoom` : 'Full period'}</span>
                    <button type="button" onClick={() => panChart('back')} disabled={safeZoomStart === 0} aria-label="Show earlier observations">←</button>
                    <button type="button" onClick={() => changeChartZoom('out')} disabled={chartZoom === 1} aria-label="Zoom out">−</button>
                    <button type="button" onClick={() => changeChartZoom('in')} disabled={visibleBucketCount <= 2} aria-label="Zoom in">+</button>
                    <button type="button" onClick={() => panChart('forward')} disabled={safeZoomStart >= maximumZoomStart} aria-label="Show later observations">→</button>
                    {chartZoom > 1 && <button type="button" className="chart-zoom-controls__reset" onClick={() => { setChartZoom(1); setChartZoomStart(0) }}>Reset view</button>}
                  </div>}
                  <div className="chart-stage__plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${chartType} chart of ${plotYAxes.join(', ')}${plotXAxis ? ` by ${plotXAxis}` : ''}`}><line className="chart-gridline" x1="7" y1="13" x2="96" y2="13" /><line className="chart-gridline" x1="7" y1="39" x2="96" y2="39" /><line className="chart-gridline" x1="7" y1="65" x2="96" y2="65" /><line className="chart-axis" x1="7" y1="91" x2="96" y2="91" />{chartType === 'line' && chartSeries.map((series) => <polyline key={series.name} points={series.points.join(' ')} fill="none" stroke={series.color} strokeWidth="0.62" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />)}{chartType === 'scatter' && scatterSeries.flatMap((series) => series.points.map((point, index) => { const [cx, cy] = point.split(','); return <circle key={`${series.name}-${index}`} cx={cx} cy={cy} r="1.15" fill={series.color} opacity=".78" vectorEffect="non-scaling-stroke" /> }))}{chartType === 'bar' && barValues.flatMap((series, seriesIndex) => series.values.map((value, index) => { if (!Number.isFinite(value)) return null; const categoryWidth = 89 / Math.max(1, barCategories.length); const width = categoryWidth / Math.max(1, barValues.length) * .72; const x = 7 + index * categoryWidth + seriesIndex * width + categoryWidth * .14; const height = value / barMaximum * 78; return <rect key={`${series.name}-${index}`} x={x} y={91 - height} width={width} height={height} rx=".3" fill={series.color} /> }))}{chartType === 'histogram' && histogramBins.map((bin, index) => { const width = 89 / histogramBins.length * .78; const x = 7 + index * (89 / histogramBins.length) + (89 / histogramBins.length) * .11; const height = bin.count / histogramMaxCount * 78; return <rect key={bin.start} x={x} y={91 - height} width={width} height={height} rx=".3" fill={chartPalette[0]} /> })}</svg></div>
                  <div className="chart-stage__x-axis" aria-label={`${plotXAxis} date points`}>
                    <div className="chart-stage__ticks">{chartDateTicks.map((tick, index) => <span key={`${tick.label}-${index}`} style={{ left: `${tick.position}%` }} title={tick.label}>{tick.label}</span>)}</div>
                    <span className="chart-stage__axis-name">{plotXAxis}</span>
                  </div>
                  <div className="chart-settings">
                    <button type="button" className="chart-settings__toggle" onClick={() => setIsChartSettingsOpen((current) => !current)} aria-expanded={isChartSettingsOpen}>Chart settings <span aria-hidden="true">{isChartSettingsOpen ? '⌃' : '⌄'}</span></button>
                    {isChartSettingsOpen && <div className="chart-settings__panel">
                      <label><span>Time interval{nativeFrequency ? ` · detected ${nativeFrequency}` : ''}</span><select value={chartFrequency} onChange={(event) => setChartFrequency(event.target.value as typeof chartFrequency)}><option value="original">Original timestamps{nativeFrequency ? ` (${nativeFrequency})` : ''}</option>{availableChartFrequencies.map((frequency) => <option key={frequency} value={frequency}>{frequency[0].toUpperCase() + frequency.slice(1)}</option>)}</select></label>
                      <label><span>Aggregate periods by</span><select value={chartAggregation} onChange={(event) => setChartAggregation(event.target.value as typeof chartAggregation)} disabled={chartFrequency === 'original' || chartFrequency === 'daily'}><option value="mean">Mean</option><option value="sum">Sum</option><option value="last">Last value</option></select></label>
                      <label><span>Data transformation</span><select value={chartTransformation} onChange={(event) => setChartTransformation(event.target.value as typeof chartTransformation)}><option value="original">Original data</option><option value="simple_diff">Simple difference</option><option value="log_diff">Log difference</option></select></label>
                      <label><span>From</span><input type="date" min={availableStartDate} max={chartEndDate || availableEndDate} value={chartStartDate} onChange={(event) => setChartStartDate(event.target.value)} /></label>
                      <label><span>To</span><input type="date" min={chartStartDate || availableStartDate} max={availableEndDate} value={chartEndDate} onChange={(event) => setChartEndDate(event.target.value)} /></label>
                      <button type="button" className="chart-settings__reset" onClick={() => { setChartFrequency('original'); setChartAggregation('mean'); setChartTransformation('original'); setChartStartDate(''); setChartEndDate('') }}>Reset</button>
                    </div>}
                  </div>
                  <p className="chart-stage__note">Each series uses its own vertical scale, shown in the legend, so variables with different units remain visible together.</p>
                </> : <div className="chart-stage__empty"><strong>No numeric observations to plot.</strong><span>Adjust the selected variables or filters, then create the chart again.</span></div>}
              </div>
            ) : canvasMode === 'preview' ? (
              <div className="dataset-preview-stage">
                <div className="dataset-preview-toolbar">
                  <div><p className="upload-stage__eyebrow">Data preview</p><h3>{dataset.original_filename}</h3></div>
                  <div className="canvas-mode-actions">
                    <button type="button" className="canvas-mode-button" onClick={() => setCanvasMode('model')}>Build model <span aria-hidden="true">→</span></button>
                    <button type="button" className="canvas-mode-button" onClick={() => setCanvasMode('builder')}>Build visualization <span aria-hidden="true">→</span></button>
                  </div>
                </div>
                <div className="preview-filter-bar" aria-label="Preview filters">
                  <select value={draftColumn} onChange={(event) => handleDraftColumnChange(event.target.value)} aria-label="Filter variable">
                    {dataset.variables.map((variable) => <option key={variable.name} value={variable.name}>{variable.name}</option>)}
                  </select>
                  <select value={draftOperator} onChange={(event) => setDraftOperator(event.target.value as FilterOperator)} aria-label="Filter condition">
                    {draftOperators.map((operator) => <option key={operator} value={operator}>{operator.replaceAll('_', ' ')}</option>)}
                  </select>
                  {draftOperator !== 'is_missing' && draftOperator !== 'is_not_missing' && <input value={draftValue} onChange={(event) => setDraftValue(event.target.value)} placeholder={draftOperator === 'between' ? 'Min' : 'Value'} aria-label={draftOperator === 'between' ? 'Minimum filter value' : 'Filter value'} />}
                  {draftOperator === 'between' && <input value={draftSecondValue} onChange={(event) => setDraftSecondValue(event.target.value)} placeholder="Max" aria-label="Maximum filter value" />}
                  <button type="button" onClick={addFilter} disabled={isFiltering}>Add filter</button>
                  {filters.length > 0 && <button type="button" className="preview-filter-bar__clear" onClick={clearFilters} disabled={isFiltering}>Clear</button>}
                </div>
                {filters.length > 0 && <div className="active-filters">{filters.map((filter, index) => <button key={`${filter.column}-${index}`} type="button" onClick={() => removeFilter(index)} title="Remove filter">{filter.column} · {filter.operator.replaceAll('_', ' ')}{filter.value ? `: ${filter.value}` : ''}<span aria-hidden="true">×</span></button>)}</div>}
                <div className="preview-table-scroll">
                  {preview ? <table className="preview-table"><thead><tr><th><button type="button" className="preview-sort" onClick={() => void handlePreviewSort('__row_number__')} aria-label="Sort observations"># {sortColumn === '__row_number__' ? (sortDirection === 'ascending' ? '↑' : '↓') : ''}</button></th>{preview.columns.map((column) => <th key={column}><span><button type="button" className="preview-sort" onClick={() => void handlePreviewSort(column)} disabled={isSorting}>{column} {sortColumn === column ? (sortDirection === 'ascending' ? '↑' : '↓') : ''}</button>{preview.date_format_suggestions.includes(column) && <button className="date-warning" type="button" onClick={() => setSelectedDateSuggestion(column)} aria-label={`Format suggestion for ${column}`} title="Date display suggestion">!</button>}</span></th>)}</tr></thead><tbody>{preview.rows.map((row, rowIndex) => <tr key={preview.source_row_numbers[rowIndex] ?? rowIndex}><td>{preview.source_row_numbers[rowIndex] ?? rowIndex + 1}</td>{preview.columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : String(row[column])}</td>)}</tr>)}</tbody></table> : <p className="preview-loading">Loading preview…</p>}</div>
                {selectedDateSuggestion && <div className="date-suggestion" role="dialog" aria-label="Date formatting suggestion"><span className="date-suggestion__icon" aria-hidden="true">!</span><div className="date-suggestion__copy"><strong>{selectedDateSuggestion}</strong><p>Every timestamp is exactly midnight. Show this column as dates only?</p></div><div className="date-suggestion__actions"><button className="date-suggestion__dismiss" type="button" onClick={() => setSelectedDateSuggestion(null)}>Keep timestamps</button><button className="date-suggestion__apply" type="button" onClick={() => void handleApplyDateDisplay()} disabled={isApplyingDateDisplay}>{isApplyingDateDisplay ? 'Applying…' : 'Apply YYYY-MM-DD'}</button></div></div>}
                <p className="preview-caption">Showing {preview?.rows.length ?? 0} of {preview?.total_rows ?? 0} observations. Click a header to sort; click again for descending order.</p>
              </div>
            ) : (
              <div className="visualization-builder">
                <div className="visualization-builder__intro">
                  <div><p className="upload-stage__eyebrow">Chart builder</p><h3>Build a visualization</h3></div><span>{dataset.column_count} available variables</span>
                </div>
                <p className="visualization-builder__help">Choose a visualization, then drag variables from <strong>Data</strong> into its inputs. {chartType === 'line' ? 'Use a date or ordered variable for X, then add one or more series to Y.' : chartType === 'scatter' ? 'Use numeric variables for both X and Y.' : chartType === 'bar' ? 'Use a category or ordered variable for X and one or more numeric series for Y.' : 'Choose one numeric variable to see its distribution.'}</p>
                <label className="visualization-type-selector"><span>Visualization type</span><select value={chartType} onChange={(event) => { const nextType = event.target.value as typeof chartType; setChartType(nextType); if (nextType === 'histogram') setPlotYAxes((current) => current.slice(0, 1)) }}><option value="line">Line chart</option><option value="scatter">Scatter plot</option><option value="bar">Bar chart</option><option value="histogram">Histogram</option></select></label>
                <div className="axis-builder" aria-label="Visualization axis assignments">
                  {chartType !== 'histogram' && <div className={`axis-dropzone axis-dropzone--x ${activeDropZone === 'x' ? 'is-active' : ''}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setActiveDropZone('x') }} onDragLeave={() => setActiveDropZone((current) => current === 'x' ? null : current)} onDrop={(event) => handleVariableDrop(event, 'x')}><span className="axis-dropzone__label">X axis</span>{plotXAxis ? <span className="axis-variable axis-variable--x"><span>{plotXAxis}</span><button type="button" onClick={() => clearDroppedVariable('x')} aria-label={`Remove ${plotXAxis} from X axis`}>×</button></span> : <span className="axis-dropzone__placeholder">{chartType === 'scatter' ? 'Drop a numeric variable here' : chartType === 'bar' ? 'Drop a category or ordered variable here' : 'Drop a date or ordered variable here'}</span>}</div>}
                  <div className={`axis-dropzone axis-dropzone--y ${activeDropZone === 'y' ? 'is-active' : ''}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setActiveDropZone('y') }} onDragLeave={() => setActiveDropZone((current) => current === 'y' ? null : current)} onDrop={(event) => handleVariableDrop(event, 'y')}><span className="axis-dropzone__label">{chartType === 'histogram' ? 'Numeric variable' : 'Y axis / series'}</span>{plotYAxes.length ? <span className="axis-variable-list">{plotYAxes.map((variableName) => <span className="axis-variable axis-variable--y" key={variableName}><span>{variableName}</span><button type="button" onClick={() => clearDroppedVariable('y', variableName)} aria-label={`Remove ${variableName} from Y axis`}>×</button></span>)}</span> : <span className="axis-dropzone__placeholder">{chartType === 'histogram' ? 'Drop one numeric variable here' : 'Drop one or more numeric variables here'}</span>}</div>
                </div>
                <div className="visualization-builder__footer"><span>{chartType === 'histogram' ? (plotYAxes.length ? `${plotYAxes[0]} selected` : 'Select one numeric variable to continue.') : plotXAxis && plotYAxes.length ? `${plotXAxis} × ${plotYAxes.length} series selected` : 'Select an X axis and at least one Y series to continue.'}</span><button type="button" onClick={() => setCanvasMode('chart')} disabled={chartType === 'histogram' ? !plotYAxes.length : !plotXAxis || !plotYAxes.length}>Create {chartType === 'scatter' ? 'scatter plot' : chartType === 'bar' ? 'bar chart' : chartType === 'histogram' ? 'histogram' : 'line chart'} <span aria-hidden="true">→</span></button></div>
              </div>
            )
          ) : (
            <div className="upload-stage">
              <div className="upload-stage__motif" aria-hidden="true"><span className="motif-dot motif-dot--one" /><span className="motif-dot motif-dot--two" /><span className="motif-dot motif-dot--three" /><span className="motif-line motif-line--one" /><span className="motif-line motif-line--two" /><span className="motif-axis" /></div>
              <div className="upload-stage__content"><p className="upload-stage__eyebrow">Your canvas is ready</p><h3>Start exploring.</h3><p>Choose a dataset to inspect its structure and variables.</p><UploadButton isImporting={isImporting} onFileSelected={handleFileSelected} /><span className="upload-stage__formats">CSV <i>·</i> XLSX <i>·</i> Parquet</span>{error && <p className="upload-error" role="alert">{error}</p>}</div>
            </div>
          )}
        </section>

        <aside className={`workspace-panel workspace-analysis ${isAnalysisCollapsed ? 'is-collapsed' : ''}`} aria-labelledby="analysis-title"><div className="panel-heading"><div><p className="panel-kicker">03 / Methods</p><h2 id="analysis-title">Analysis</h2></div><button className="panel-toggle" type="button" onClick={() => setIsAnalysisCollapsed((current) => !current)} aria-expanded={!isAnalysisCollapsed} aria-label={isAnalysisCollapsed ? 'Open Analysis panel' : 'Hide Analysis panel'} title={isAnalysisCollapsed ? 'Open Analysis' : 'Hide Analysis'}><span aria-hidden="true">{isAnalysisCollapsed ? '‹' : '›'}</span></button></div><div className="analysis-empty"><div className="analysis-empty__icon" aria-hidden="true">✦</div><p>{dataset ? 'Choose variables to start an analysis.' : 'Load a dataset to start an analysis.'}</p></div><div className="analysis-options" aria-label="Upcoming analysis options"><button type="button" disabled><span>Descriptive statistics</span><span>→</span></button><button type="button" disabled><span>Regression</span><span>→</span></button><button type="button" disabled><span>Time series</span><span>→</span></button></div></aside>
        <section className={`workspace-results ${isResultsCollapsed ? 'is-collapsed' : ''}`} aria-labelledby="results-title"><div className="results-title"><div><p className="panel-kicker">04 / Output</p><h2 id="results-title">Results &amp; interpretation</h2></div><button className="panel-toggle panel-toggle--results" type="button" onClick={() => setIsResultsCollapsed((current) => !current)} aria-expanded={!isResultsCollapsed} aria-label={isResultsCollapsed ? 'Open Results and interpretation panel' : 'Hide Results and interpretation panel'} title={isResultsCollapsed ? 'Open Results' : 'Hide Results'}><span aria-hidden="true">{isResultsCollapsed ? '⌃' : '⌄'}</span></button></div><div className="results-empty"><span className="results-empty__marker" aria-hidden="true">↳</span><p>{dataset ? 'Your dataset is imported. Run an analysis to see statistical output here.' : 'Your statistical results, diagnostics, and explanations will appear here.'}</p></div></section>
      </section>

      {pendingDeletion && (
        <div className="delete-modal-backdrop" role="presentation">
          <section className="delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title" aria-describedby="delete-modal-description">
            <h2 id="delete-modal-title">Delete {pendingDeletion.kind === 'dataset' ? 'dataset' : 'variable'}?</h2>
            <p id="delete-modal-description">{pendingDeletion.kind === 'dataset' ? <>“{pendingDeletion.label}” and its imported data will be permanently removed.</> : <>“{pendingDeletion.name}” will be removed from this imported dataset.</>}</p>
            <label className="delete-modal__preference"><input type="checkbox" checked={pendingDeletion.kind === 'dataset' ? skipDatasetDeleteConfirmation : skipVariableDeleteConfirmation} onChange={(event) => handleDeletionPreference(pendingDeletion.kind, event.target.checked)} /><span>Don’t ask me again for {pendingDeletion.kind} deletions</span></label>
            <div className="delete-modal__actions"><button className="delete-modal__cancel" type="button" onClick={() => setPendingDeletion(null)}>Cancel</button><button className="delete-modal__confirm" type="button" onClick={confirmDeletion}>Delete</button></div>
          </section>
        </div>
      )}
    </main>
  )
}
