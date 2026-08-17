import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { deleteDataset, deleteVariable, getDatasets, getDescriptiveStatistics, getPreview, queryPreview, renameVariable, setDateOnlyDisplay, uploadDataset } from '../api'
import type { DatasetPreview, DatasetSummary, DescriptiveStatistic, FilterOperator, PreviewFilter, VariableMetadata } from '../api'
import { DatasetChart } from '../visualizations/DatasetChart'

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

type CustomVariable = { name: string; formula: string }

type CustomVariableDraft = { name: string; mode: 'guided' | 'formula'; kind: 'arithmetic' | 'transform' | 'time' | 'condition'; source: string; operator: string; operand: string; formula: string }

const emptyCustomVariableDraft: CustomVariableDraft = { name: '', mode: 'guided', kind: 'arithmetic', source: '', operator: '+', operand: '0', formula: '' }

function numericValue(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : Number.NaN }

// A deliberately small, explicit formula language; it never evaluates arbitrary JavaScript.
function calculateCustomValue(formula: string, row: Record<string, unknown>, rows: Record<string, unknown>[], index: number) {
  const source = (name: string) => numericValue(row[name])
  const text = formula.trim()
  const unary = text.match(/^(log|sqrt|abs)\(([A-Za-z_][\w]*)\)$/i)
  if (unary) { const value = source(unary[2]); return unary[1].toLowerCase() === 'log' ? value > 0 ? Math.log(value) : Number.NaN : unary[1].toLowerCase() === 'sqrt' ? value >= 0 ? Math.sqrt(value) : Number.NaN : Math.abs(value) }
  const time = text.match(/^(lag|diff|pct_change)\(([A-Za-z_][\w]*)(?:,\s*(\d+))?\)$/i)
  if (time) { const periods = Number(time[3] ?? 1); const current = source(time[2]); const previous = numericValue(rows[index - periods]?.[time[2]]); return index < periods ? Number.NaN : time[1].toLowerCase() === 'lag' ? previous : time[1].toLowerCase() === 'diff' ? current - previous : previous === 0 ? Number.NaN : (current - previous) / previous * 100 }
  const condition = text.match(/^if\(([A-Za-z_][\w]*)\s*(<=|>=|==|!=|<|>)\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\)$/i)
  if (condition) { const value = source(condition[1]); const threshold = Number(condition[3]); const passed = ({ '<': value < threshold, '<=': value <= threshold, '>': value > threshold, '>=': value >= threshold, '==': value === threshold, '!=': value !== threshold })[condition[2]]; return passed ? Number(condition[4]) : Number(condition[5]) }
  const arithmetic = text.match(/^([A-Za-z_][\w]*|-?[\d.]+)\s*([+\-*/])\s*([A-Za-z_][\w]*|-?[\d.]+)$/)
  if (arithmetic) { const left = /^[A-Za-z_]/.test(arithmetic[1]) ? source(arithmetic[1]) : Number(arithmetic[1]); const right = /^[A-Za-z_]/.test(arithmetic[3]) ? source(arithmetic[3]) : Number(arithmetic[3]); return arithmetic[2] === '+' ? left + right : arithmetic[2] === '-' ? left - right : arithmetic[2] === '*' ? left * right : right === 0 ? Number.NaN : left / right }
  return Number.NaN
}

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
  const [variableOrder, setVariableOrder] = useState<string[]>([])
  const [activeDropZone, setActiveDropZone] = useState<'x' | 'y' | null>(null)
  const [canvasMode, setCanvasMode] = useState<'builder' | 'preview' | 'chart' | 'model'>('builder')
  const [isChartSettingsOpen, setIsChartSettingsOpen] = useState(false)
  const [chartFrequency, setChartFrequency] = useState<'original' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'>('original')
  const [chartAggregation, setChartAggregation] = useState<'mean' | 'sum' | 'last'>('mean')
  const [chartTransformation, setChartTransformation] = useState<'original' | 'simple_diff' | 'log_diff'>('original')
  const [chartStartDate, setChartStartDate] = useState('')
  const [chartEndDate, setChartEndDate] = useState('')
  const [isRestoring, setIsRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>([])
  const [isCustomVariableModalOpen, setIsCustomVariableModalOpen] = useState(false)
  const [customVariableDraft, setCustomVariableDraft] = useState<CustomVariableDraft>(emptyCustomVariableDraft)
  const [customVariableError, setCustomVariableError] = useState<string | null>(null)
  const [selectedPreviewRows, setSelectedPreviewRows] = useState<number[]>([])
  const [previewSelectionAnchor, setPreviewSelectionAnchor] = useState<number | null>(null)
  const [isPreviewRangeSelecting, setIsPreviewRangeSelecting] = useState(false)

  async function activateDataset(nextDataset: DatasetSummary) {
    const savedFilters = readSavedFilters(nextDataset.id)
    const nextPreview = savedFilters.length
      ? await queryPreview(nextDataset.id, savedFilters, null, false, 0, PREVIEW_SCROLL_LIMIT)
      : await getPreview(nextDataset.id, null, false, 0, PREVIEW_SCROLL_LIMIT)
    const firstVariable = nextDataset.variables[0]
    setDataset(nextDataset)
    setPlotXAxis(null)
    setPlotYAxes([])
    setVariableOrder(nextDataset.variables.map((variable) => variable.name))
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
    setCustomVariables([])
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

  function reorderVariableList(event: DragEvent<HTMLLIElement>, targetName: string) {
    event.preventDefault()
    const sourceName = event.dataTransfer.getData('text/plain') || draggingVariable
    if (!sourceName || sourceName === targetName) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const insertAfter = event.clientY > bounds.top + bounds.height / 2
    setVariableOrder((current) => {
      const order = current.length ? current : dataset?.variables.map((variable) => variable.name) ?? []
      const withoutSource = order.filter((name) => name !== sourceName)
      const targetIndex = withoutSource.indexOf(targetName)
      const insertionIndex = targetIndex + (insertAfter ? 1 : 0)
      return targetIndex < 0 ? order : [...withoutSource.slice(0, insertionIndex), sourceName, ...withoutSource.slice(insertionIndex)]
    })
    setDraggingVariable(null)
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

  const previewRows = preview?.rows ?? []
  const augmentedPreviewRows = useMemo(() => {
    const calculatedRows: Record<string, unknown>[] = []
    previewRows.forEach((originalRow, index) => {
      const row = { ...originalRow }
      customVariables.forEach((variable) => { row[variable.name] = calculateCustomValue(variable.formula, row, calculatedRows, index) })
      calculatedRows.push(row)
    })
    return calculatedRows
  }, [previewRows, customVariables])
  const previewColumns = [...(preview?.columns ?? []), ...customVariables.map((variable) => variable.name)]
  const numericVariableNames = dataset?.variables.filter((variable) => variable.logical_type === 'numeric').map((variable) => variable.name) ?? []
  function openCustomVariableModal() { setCustomVariableDraft({ ...emptyCustomVariableDraft, source: numericVariableNames[0] ?? '' }); setCustomVariableError(null); setIsCustomVariableModalOpen(true) }
  function addCustomVariable() {
    const name = customVariableDraft.name.trim()
    const formula = customVariableDraft.mode === 'formula' ? customVariableDraft.formula.trim() : customVariableDraft.kind === 'arithmetic' ? `${customVariableDraft.source} ${customVariableDraft.operator} ${customVariableDraft.operand}` : customVariableDraft.kind === 'transform' ? `${customVariableDraft.operator}(${customVariableDraft.source})` : customVariableDraft.kind === 'time' ? `${customVariableDraft.operator}(${customVariableDraft.source}${customVariableDraft.operand ? `, ${customVariableDraft.operand}` : ''})` : customVariableDraft.formula.trim()
    if (!name || !/^[A-Za-z_]\w*$/.test(name)) { setCustomVariableError('Use a unique variable name beginning with a letter or underscore.'); return }
    if (dataset?.variables.some((variable) => variable.name === name) || customVariables.some((variable) => variable.name === name)) { setCustomVariableError('That variable name is already in use.'); return }
    if (!formula) { setCustomVariableError('Define a formula before adding the variable.'); return }
    setCustomVariables((current) => [...current, { name, formula }])
    setIsCustomVariableModalOpen(false)
  }
  function selectPreviewRow(rowIndex: number, extend = false) {
    const anchor = extend ? previewSelectionAnchor ?? rowIndex : rowIndex
    const start = Math.min(anchor, rowIndex)
    const end = Math.max(anchor, rowIndex)
    setSelectedPreviewRows(Array.from({ length: end - start + 1 }, (_, index) => start + index))
    if (!extend) setPreviewSelectionAnchor(rowIndex)
  }
  function startPreviewRangeSelection(rowIndex: number) {
    setPreviewSelectionAnchor((current) => current ?? rowIndex)
    setIsPreviewRangeSelecting(true)
    selectPreviewRow(rowIndex, true)
  }
  useEffect(() => { setSelectedPreviewRows([]); setPreviewSelectionAnchor(null); setIsPreviewRangeSelecting(false) }, [preview?.dataset_id, preview?.offset, preview?.total_rows])

  const orderedDatasetVariables = dataset ? [...dataset.variables].sort((left, right) => {
    const leftIndex = variableOrder.indexOf(left.name)
    const rightIndex = variableOrder.indexOf(right.name)
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
  }) : []
  const draftVariable = dataset?.variables.find((item) => item.name === draftColumn)
  const draftOperators = draftVariable ? operatorsFor(draftVariable) : ['equals'] as FilterOperator[]
  const chartRows = augmentedPreviewRows
  const chartPalette = ['#e65f2d', '#24766b', '#7467a4', '#b98422', '#4d7195']
  const datedChartRows = plotXAxis ? chartRows.map((row) => ({ row, date: new Date(String(row[plotXAxis])) })).filter((item) => !Number.isNaN(item.date.getTime())) : []
  const availableStartDate = datedChartRows[0]?.date.toISOString().slice(0, 10) ?? ''
  const availableEndDate = datedChartRows.at(-1)?.date.toISOString().slice(0, 10) ?? ''
  // compare canonical calendar-day keys rather than local Date objects so date-input
  // changes cannot be shifted by the browser timezone and empty the active chart.
  const rangeFilteredChartRows = datedChartRows.filter(({ date }) => {
    const day = date.toISOString().slice(0, 10)
    return (!chartStartDate || day >= chartStartDate) && (!chartEndDate || day <= chartEndDate)
  })
  // Keep the active chart mounted if a temporary/incomplete date range matches nothing.
  // This protects the ECharts instance while the user adjusts either boundary.
  const filteredChartRows = rangeFilteredChartRows.length ? rangeFilteredChartRows : datedChartRows
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
  const aggregate = (values: number[]) => chartAggregation === 'sum' ? values.reduce((total, value) => total + value, 0) : chartAggregation === 'last' ? values.at(-1)! : values.reduce((total, value) => total + value, 0) / values.length
  const lineLabels = chartBuckets.map(([label]) => label)
  const lineSeries = plotYAxes.map((name, index) => {
    const baseValues = chartBuckets.map(([label, bucket]) => ({ label, value: aggregate(bucket.map(({ row }) => Number(row[name])).filter(Number.isFinite)) })).filter((item) => Number.isFinite(item.value))
    const transformedValues = chartTransformation === 'original' ? baseValues : baseValues.slice(1).map((item, itemIndex) => {
      const previous = baseValues[itemIndex].value
      return { label: item.label, value: chartTransformation === 'log_diff' && previous > 0 && item.value > 0 ? Math.log(item.value) - Math.log(previous) : chartTransformation === 'simple_diff' ? item.value - previous : Number.NaN }
    }).filter((item) => Number.isFinite(item.value))
    return { name, color: chartPalette[index % chartPalette.length], data: transformedValues }
  }).filter((series) => series.data.length > 0)
  const scatterSeries = plotYAxes.map((name, index) => ({
    name,
    color: chartPalette[index % chartPalette.length],
    data: chartRows.map((row) => [Number(row[plotXAxis ?? '']), Number(row[name])] as [number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
  })).filter((series) => series.data.length > 0)
  const barCategories = chartRows.map((row) => valueForCell(row[plotXAxis ?? '']))
  const barSeries = plotYAxes.map((name, index) => ({ name, color: chartPalette[index % chartPalette.length], data: chartRows.map((row) => Number(row[name])).map((value) => Number.isFinite(value) ? value : null) }))
  const histogramValues = plotYAxes.length ? chartRows.map((row) => Number(row[plotYAxes[0]])).filter(Number.isFinite) : []
  const histogramMin = Math.min(...histogramValues); const histogramMax = Math.max(...histogramValues); const histogramWidth = (histogramMax - histogramMin || 1) / 10
  const histogramBins = Array.from({ length: 10 }, (_, index) => {
    const start = histogramMin + index * histogramWidth
    const end = start + histogramWidth
    return { label: `${start.toFixed(2)}–${end.toFixed(2)}`, count: histogramValues.filter((value) => index === 9 ? value >= start && value <= histogramMax : value >= start && value < end).length }
  })
  const chartCanRender = chartType === 'line' ? lineSeries.length > 0 : chartType === 'scatter' ? scatterSeries.length > 0 : chartType === 'bar' ? barSeries.some((series) => series.data.some((value) => value !== null)) : histogramValues.length > 0

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
                {orderedDatasetVariables.map((variable) => {
                  const isOnlyVariable = dataset.variables.length === 1
                  const isDeletingThisVariable = deletingVariable === variable.name
                  return (
                    <li
                      key={variable.name}
                      className={`variable-row variable-row--draggable ${draggingVariable === variable.name ? 'is-dragging' : ''}`}
                      draggable
                      onDragStart={(event) => handleVariableDragStart(event, variable.name)}
                      onDragEnd={() => { setDraggingVariable(null); setActiveDropZone(null) }}
                      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
                      onDrop={(event) => reorderVariableList(event, variable.name)}
                      title={`Drag ${variable.name} into the visualization builder, or drop it on another variable to reorder the Data list`}
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
                      ) : <><span>{variable.name}</span><span className="variable-row__actions"><button className="rename-variable" type="button" onClick={(event) => { event.stopPropagation(); beginRename(variable.name) }} onMouseDown={(event) => event.stopPropagation()} aria-label={`Rename ${variable.name}`} title="Rename variable"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m4 16.5-.7 4.2 4.2-.7L18.7 8.8 15.2 5.3 4 16.5Zm9.8-11.2 3.5 3.5m-10 7.2 2.3.5.5 2.3" /></svg></button></span><small>{variable.logical_type}</small></>}
                    </li>
                  )
                })}
                {customVariables.map((variable) => <li key={variable.name} className="variable-row variable-row--draggable variable-row--custom" draggable onDragStart={(event) => handleVariableDragStart(event, variable.name)} onDragEnd={() => { setDraggingVariable(null); setActiveDropZone(null) }} title={`Session-only custom variable: ${variable.formula}`}><span className="variable-type variable-type--numeric" aria-hidden="true" /><button className="delete-variable" type="button" onClick={() => setCustomVariables((current) => current.filter((item) => item.name !== variable.name))} aria-label={`Remove custom variable ${variable.name}`}>×</button><span>{variable.name}</span><small>custom</small></li>)}
              </ul>
              <button className="custom-variable-button custom-variable-button--below" type="button" onClick={openCustomVariableModal}><span aria-hidden="true">+</span> Custom variable</button>
            </div>
          ) : (
            <div className="data-empty">
              <div className="data-empty__glyph" aria-hidden="true">⌁</div><h2>No dataset loaded</h2>
              <p>Upload a CSV, XLSX, or Parquet file to begin.</p>
              <UploadButton className="button--small" isImporting={isImporting} onFileSelected={handleFileSelected} />
            </div>
          )}

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
                  <div><p className="upload-stage__eyebrow">{chartType === 'scatter' ? 'Scatter plot' : chartType === 'bar' ? 'Bar chart' : chartType === 'histogram' ? 'Histogram' : 'Line chart'}</p><h3>{plotYAxes.length === 1 ? plotYAxes[0] : `${plotYAxes.length} selected series`}</h3><p>{chartRows.length.toLocaleString()} observations shown</p></div>
                  <button type="button" className="canvas-mode-button" onClick={() => setCanvasMode('builder')}>Edit variables <span aria-hidden="true">→</span></button>
                </div>
                {chartCanRender ? <>
                  <div className="chart-stage__legend" aria-label="Chart series legend">{(chartType === 'scatter' ? scatterSeries : chartType === 'histogram' ? [{ name: plotYAxes[0], color: chartPalette[0] }] : chartType === 'bar' ? barSeries : lineSeries).map((series) => <span key={series.name}><i style={{ backgroundColor: series.color }} />{series.name}</span>)}</div>
                  <DatasetChart type={chartType} xAxisName={plotXAxis} lineLabels={lineLabels} lineSeries={lineSeries} scatterSeries={scatterSeries} barCategories={barCategories} barSeries={barSeries} histogramBins={histogramBins} />
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
                  <p className="chart-stage__note">Transformations and aggregation are calculated in the browser before values are passed to ECharts.</p>
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
                  {preview ? <table className="preview-table"><thead><tr><th><button type="button" className="preview-sort" onClick={() => void handlePreviewSort('__row_number__')} aria-label="Sort observations"># {sortColumn === '__row_number__' ? (sortDirection === 'ascending' ? '↑' : '↓') : ''}</button></th>{previewColumns.map((column) => <th key={column}><span><button type="button" className="preview-sort" onClick={() => void handlePreviewSort(column)} disabled={isSorting}>{column} {sortColumn === column ? (sortDirection === 'ascending' ? '↑' : '↓') : ''}</button>{preview.date_format_suggestions.includes(column) && <button className="date-warning" type="button" onClick={() => setSelectedDateSuggestion(column)} aria-label={`Format suggestion for ${column}`} title="Date display suggestion">!</button>}</span></th>)}</tr></thead><tbody>{augmentedPreviewRows.map((row, rowIndex) => <tr key={preview.source_row_numbers[rowIndex] ?? rowIndex} className={selectedPreviewRows.includes(rowIndex) ? 'is-selected' : ''} tabIndex={0} aria-selected={selectedPreviewRows.includes(rowIndex)} onClick={() => selectPreviewRow(rowIndex)} onKeyDown={(event) => { if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const nextRow = Math.max(0, Math.min(augmentedPreviewRows.length - 1, rowIndex + (event.key === 'ArrowDown' ? 1 : -1))); selectPreviewRow(nextRow, event.metaKey || event.ctrlKey); (event.currentTarget.parentElement?.children[nextRow] as HTMLElement | undefined)?.focus() }} onPointerDown={(event) => { if (event.button === 2) { event.preventDefault(); startPreviewRangeSelection(rowIndex) } }} onPointerEnter={() => { if (isPreviewRangeSelecting) selectPreviewRow(rowIndex, true) }} onPointerUp={() => setIsPreviewRangeSelecting(false)} onContextMenu={(event) => event.preventDefault()}><td>{preview.source_row_numbers[rowIndex] ?? rowIndex + 1}</td>{previewColumns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : String(row[column])}</td>)}</tr>)}</tbody></table> : <p className="preview-loading">Loading preview…</p>}</div>
                {selectedDateSuggestion && <div className="date-suggestion" role="dialog" aria-label="Date formatting suggestion"><span className="date-suggestion__icon" aria-hidden="true">!</span><div className="date-suggestion__copy"><strong>{selectedDateSuggestion}</strong><p>Every timestamp is exactly midnight. Show this column as dates only?</p></div><div className="date-suggestion__actions"><button className="date-suggestion__dismiss" type="button" onClick={() => setSelectedDateSuggestion(null)}>Keep timestamps</button><button className="date-suggestion__apply" type="button" onClick={() => void handleApplyDateDisplay()} disabled={isApplyingDateDisplay}>{isApplyingDateDisplay ? 'Applying…' : 'Apply YYYY-MM-DD'}</button></div></div>}
                <p className="preview-caption">Showing {preview?.rows.length ?? 0} of {dataset.row_count.toLocaleString()} observations{filters.length ? ` · ${preview?.total_rows ?? 0} match the active filters` : ''}{selectedPreviewRows.length ? ` · ${selectedPreviewRows.length} selected` : ''}. Click a row to select it; right-click drag across rows to extend the selection.</p>
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

      {isCustomVariableModalOpen && <div className="delete-modal-backdrop" role="presentation"><section className="delete-modal custom-variable-modal" role="dialog" aria-modal="true" aria-labelledby="custom-variable-title"><p className="panel-kicker">Session-only variable</p><h2 id="custom-variable-title">Create custom variable</h2><p>Available in this browser session, charts, and the data preview. It will not change the uploaded dataset.</p><label>Name<input value={customVariableDraft.name} onChange={(event) => setCustomVariableDraft((current) => ({ ...current, name: event.target.value }))} placeholder="real_cpi" autoFocus /></label><div className="custom-variable-tabs"><button type="button" className={customVariableDraft.mode === 'guided' ? 'is-active' : ''} onClick={() => setCustomVariableDraft((current) => ({ ...current, mode: 'guided' }))}>Guided</button><button type="button" className={customVariableDraft.mode === 'formula' ? 'is-active' : ''} onClick={() => setCustomVariableDraft((current) => ({ ...current, mode: 'formula' }))}>Formula</button></div>{customVariableDraft.mode === 'guided' ? <><label>Operation<select value={customVariableDraft.kind} onChange={(event) => setCustomVariableDraft((current) => ({ ...current, kind: event.target.value as CustomVariableDraft['kind'], operator: event.target.value === 'arithmetic' ? '+' : event.target.value === 'transform' ? 'log' : event.target.value === 'time' ? 'lag' : current.operator }))}><option value="arithmetic">Arithmetic</option><option value="transform">Transform</option><option value="time">Time-series</option><option value="condition">If / then rule</option></select></label><label>Source variable<select value={customVariableDraft.source} onChange={(event) => setCustomVariableDraft((current) => ({ ...current, source: event.target.value }))}>{numericVariableNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>{customVariableDraft.kind === 'arithmetic' && <><label>Operator<select value={customVariableDraft.operator} onChange={(event) => setCustomVariableDraft((current) => ({ ...current, operator: event.target.value }))}><option>+</option><option>-</option><option>*</option><option>/</option></select></label><label>Other variable or constant<input value={customVariableDraft.operand} onChange={(event) => setCustomVariableDraft((current) => ({ ...current, operand: event.target.value }))} placeholder="100 or CPI" /></label></>}{customVariableDraft.kind === 'transform' && <label>Transformation<select value={customVariableDraft.operator} onChange={(event) => setCustomVariableDraft((current) => ({ ...current, operator: event.target.value }))}><option value="log">Log</option><option value="sqrt">Square root</option><option value="abs">Absolute value</option></select></label>}{customVariableDraft.kind === 'time' && <><label>Transformation<select value={customVariableDraft.operator} onChange={(event) => setCustomVariableDraft((current) => ({ ...current, operator: event.target.value }))}><option value="lag">Lag</option><option value="diff">Difference</option><option value="pct_change">Percent change</option></select></label><label>Periods<input type="number" min="1" value={customVariableDraft.operand} onChange={(event) => setCustomVariableDraft((current) => ({ ...current, operand: event.target.value }))} /></label></>}{customVariableDraft.kind === 'condition' && <label>Formula<textarea value={customVariableDraft.formula} onChange={(event) => setCustomVariableDraft((current) => ({ ...current, formula: event.target.value }))} placeholder="if(CPI > 100, 1, 0)" /></label>}</> : <label>Formula<textarea value={customVariableDraft.formula} onChange={(event) => setCustomVariableDraft((current) => ({ ...current, formula: event.target.value }))} placeholder="Examples: CPI / 100, log(CPI), lag(CPI, 1), if(CPI > 100, 1, 0)" /></label>}{customVariableError && <p className="custom-variable-error">{customVariableError}</p>}<div className="delete-modal__actions"><button className="delete-modal__cancel" type="button" onClick={() => setIsCustomVariableModalOpen(false)}>Cancel</button><button className="delete-modal__confirm" type="button" onClick={addCustomVariable}>Add variable</button></div></section></div>}

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
