export type LogicalType = 'numeric' | 'datetime' | 'boolean' | 'categorical' | 'text'

export interface VariableMetadata {
  name: string
  ordinal_position: number
  logical_type: LogicalType
  physical_type: string
  nullable: boolean
  missing_count: number
  distinct_count: number
  sample_values: unknown[]
  min_value: unknown | null
  max_value: unknown | null
  is_time_candidate: boolean
  is_numeric_candidate: boolean
}

export interface DatasetSummary {
  id: string
  original_filename: string
  source_format: 'csv' | 'xlsx' | 'parquet'
  row_count: number
  column_count: number
  variables: VariableMetadata[]
  created_at: string
}

export type FilterOperator = 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'between' | 'before' | 'after' | 'is_missing' | 'is_not_missing'

export interface PreviewFilter {
  column: string
  operator: FilterOperator
  value?: string
  second_value?: string
}

export interface DatasetPreview {
  dataset_id: string
  columns: string[]
  rows: Record<string, unknown>[]
  source_row_numbers: number[]
  offset: number
  limit: number
  total_rows: number
  date_format_suggestions: string[]
}

export interface DescriptiveStatistic {
  variable: string
  type: LogicalType
  observations: number
  missing: number
  distinct: number
  mean?: number | null
  std_dev?: number | null
  min?: number | null
  p25?: number | null
  median?: number | null
  p75?: number | null
  max?: number | null
  mode?: string | number | boolean | null
}

const API_URL = import.meta.env.VITE_GARF_API_URL ?? 'http://127.0.0.1:8000'

export async function uploadDataset(file: File): Promise<DatasetSummary> {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch(`${API_URL}/api/datasets`, { method: 'POST', body })
  if (!response.ok) {
    const message = await response.json().catch(() => null)
    throw new Error(message?.detail ?? 'Garf could not import this dataset.')
  }
  return response.json() as Promise<DatasetSummary>
}

export async function getDatasets(): Promise<DatasetSummary[]> {
  const response = await fetch(`${API_URL}/api/datasets`)
  if (!response.ok) throw new Error('Garf could not restore saved datasets.')
  return response.json() as Promise<DatasetSummary[]>
}

export async function deleteDataset(datasetId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/datasets/${datasetId}`, { method: 'DELETE' })
  if (!response.ok) {
    const message = await response.json().catch(() => null)
    throw new Error(message?.detail ?? 'Garf could not delete this dataset.')
  }
}

export async function deleteVariable(datasetId: string, variableName: string): Promise<DatasetSummary> {
  const query = new URLSearchParams({ name: variableName })
  const response = await fetch(`${API_URL}/api/datasets/${datasetId}/variables?${query}`, { method: 'DELETE' })
  if (!response.ok) {
    const message = await response.json().catch(() => null)
    throw new Error(message?.detail ?? 'Garf could not delete this variable.')
  }
  return response.json() as Promise<DatasetSummary>
}

export async function getDescriptiveStatistics(datasetId: string, filters: PreviewFilter[]): Promise<DescriptiveStatistic[]> {
  const response = await fetch(`${API_URL}/api/datasets/${datasetId}/descriptive-statistics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters }),
  })
  if (!response.ok) {
    const message = await response.json().catch(() => null)
    throw new Error(message?.detail ?? 'Garf could not calculate descriptive statistics.')
  }
  return response.json() as Promise<DescriptiveStatistic[]>
}

export async function renameVariable(datasetId: string, name: string, newName: string): Promise<DatasetSummary> {
  const response = await fetch(`${API_URL}/api/datasets/${datasetId}/variables`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, new_name: newName }),
  })
  if (!response.ok) {
    const message = await response.json().catch(() => null)
    throw new Error(message?.detail ?? 'Garf could not rename this variable.')
  }
  return response.json() as Promise<DatasetSummary>
}

export async function setDateOnlyDisplay(datasetId: string, column: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/datasets/${datasetId}/date-display`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column }),
  })
  if (!response.ok) {
    const message = await response.json().catch(() => null)
    throw new Error(message?.detail ?? 'Garf could not apply this date display.')
  }
}

export async function queryPreview(datasetId: string, filters: PreviewFilter[], sortColumn: string | null = null, sortDescending = false, offset = 0, limit = 1000): Promise<DatasetPreview> {
  const response = await fetch(`${API_URL}/api/datasets/${datasetId}/preview/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters, sort_column: sortColumn, sort_descending: sortDescending, offset, limit }),
  })
  if (!response.ok) {
    const message = await response.json().catch(() => null)
    throw new Error(message?.detail ?? 'Garf could not apply these filters.')
  }
  return response.json() as Promise<DatasetPreview>
}

export async function getPreview(datasetId: string, sortColumn: string | null = null, sortDescending = false, offset = 0, limit = 1000): Promise<DatasetPreview> {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (sortColumn) query.set('sort_column', sortColumn)
  if (sortDescending) query.set('sort_descending', 'true')
  const response = await fetch(`${API_URL}/api/datasets/${datasetId}/preview?${query}`)
  if (!response.ok) throw new Error('Garf could not load the dataset preview.')
  return response.json() as Promise<DatasetPreview>
}
