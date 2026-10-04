import { useEffect, useState } from 'react'

import { apiBlob, apiRequest, formatLocalTimestamp, type Camera, type Incident, type IncidentPage, type Zone } from '../lib/api'

const inputClass = 'rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white'
const eventTypes = ['Restricted-zone entry', 'Hazard-zone proximity', 'Crowding threshold']

function localDateBoundary(value: string, addDay = false): string | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const boundary = new Date(year, month - 1, day + (addDay ? 1 : 0))
  return boundary.toISOString()
}

export function IncidentHistoryPage() {
  const [result, setResult] = useState<IncidentPage>({ items: [], page: 1, page_size: 20, total: 0, pages: 0 })
  const [cameras, setCameras] = useState<Camera[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [cameraId, setCameraId] = useState('')
  const [eventType, setEventType] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Incident | null>(null)
  const [evidenceUrl, setEvidenceUrl] = useState('')

  useEffect(() => {
    Promise.all([apiRequest<Camera[]>('/api/cameras'), apiRequest<Zone[]>('/api/zones')])
      .then(([loadedCameras, loadedZones]) => {
        setCameras(loadedCameras)
        setZones(loadedZones)
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Unable to load filter options.'))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), page_size: '20' })
    const start = localDateBoundary(startDate)
    const end = localDateBoundary(endDate, true)
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    if (zoneId) params.set('zone_id', zoneId)
    if (cameraId) params.set('camera_id', cameraId)
    if (eventType) params.set('event_type', eventType)
    if (search.trim()) params.set('search', search.trim())

    let cancelled = false
    apiRequest<IncidentPage>(`/api/incidents?${params.toString()}`)
      .then((data) => {
        if (!cancelled) {
          setResult(data)
          setError('')
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load incident history.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [cameraId, endDate, eventType, page, search, startDate, zoneId])

  useEffect(() => {
    if (!selected) {
      return
    }
    let cancelled = false
    let objectUrl = ''
    apiBlob(selected.evidence_url)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (!cancelled) setEvidenceUrl(objectUrl)
        else URL.revokeObjectURL(objectUrl)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load the evidence frame.')
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [selected])

  function resetFilters() {
    setLoading(true)
    setStartDate('')
    setEndDate('')
    setZoneId('')
    setCameraId('')
    setEventType('')
    setSearch('')
    setPage(1)
  }

  async function exportCsv() {
    setExporting(true)
    setError('')
    try {
      const params = new URLSearchParams()
      const start = localDateBoundary(startDate)
      const end = localDateBoundary(endDate, true)
      if (start) params.set('start', start)
      if (end) params.set('end', end)
      if (zoneId) params.set('zone_id', zoneId)
      if (cameraId) params.set('camera_id', cameraId)
      if (eventType) params.set('event_type', eventType)
      if (search.trim()) params.set('search', search.trim())
      const blob = await apiBlob(`/api/incidents/export.csv?${params.toString()}`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'incident-history.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Unable to export the filtered incidents.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-slate-400">Incident history</p>
          <h2 className="text-2xl font-semibold text-white">Searchable incident log</h2>
          <p className="mt-1 text-sm text-slate-500">{result.total} matching incident{result.total === 1 ? '' : 's'}</p>
        </div>
        <button type="button" onClick={() => void exportCsv()} disabled={exporting} className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">
          {exporting ? 'Exporting…' : 'Export filtered CSV'}
        </button>
      </div>

      <section aria-label="Incident filters" className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <input aria-label="Search incidents" className={`${inputClass} placeholder:text-slate-500`} placeholder="Search details, event, camera…" value={search} onChange={(event) => { setLoading(true); setSearch(event.target.value); setPage(1) }} />
        <label className="flex items-center gap-2 text-xs text-slate-400">From <input aria-label="Start date" type="date" className={inputClass} value={startDate} onChange={(event) => { setLoading(true); setStartDate(event.target.value); setPage(1) }} /></label>
        <label className="flex items-center gap-2 text-xs text-slate-400">To <input aria-label="End date" type="date" className={inputClass} value={endDate} onChange={(event) => { setLoading(true); setEndDate(event.target.value); setPage(1) }} /></label>
        <select aria-label="Filter by zone" className={inputClass} value={zoneId} onChange={(event) => { setLoading(true); setZoneId(event.target.value); setPage(1) }}>
          <option value="">All zones</option>
          {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
        </select>
        <select aria-label="Filter by camera" className={inputClass} value={cameraId} onChange={(event) => { setLoading(true); setCameraId(event.target.value); setPage(1) }}>
          <option value="">All cameras</option>
          {cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
        </select>
        <select aria-label="Filter by event type" className={inputClass} value={eventType} onChange={(event) => { setLoading(true); setEventType(event.target.value); setPage(1) }}>
          <option value="">All event types</option>
          {eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <button type="button" onClick={resetFilters} className="justify-self-start rounded-xl px-3 py-2 text-sm text-blue-300 hover:bg-slate-800">Clear filters</button>
      </section>

      {error ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
        <table className="min-w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Time</th><th className="px-4 py-3">Camera</th><th className="px-4 py-3">Zone</th>
              <th className="px-4 py-3">Event</th><th className="px-4 py-3">Alert</th><th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((incident) => (
              <tr key={incident.id} className="cursor-pointer border-t border-slate-800 hover:bg-slate-900/60" onClick={() => { setEvidenceUrl(''); setSelected(incident) }}>
                <td className="whitespace-nowrap px-4 py-3"><time dateTime={incident.created_at}>{formatLocalTimestamp(incident.created_at)}</time></td>
                <td className="px-4 py-3">{incident.camera_name}</td><td className="px-4 py-3">{incident.zone_name}</td>
                <td className="px-4 py-3">{incident.event_type}</td><td className="px-4 py-3">{incident.alert_status ?? 'No alert'}</td>
                <td className="max-w-xs truncate px-4 py-3">{incident.detail}</td>
              </tr>
            ))}
            {!loading && !error && result.items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No incidents for the selected period</td></tr>
            ) : null}
            {loading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading incidents…</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>Page {result.pages === 0 ? 0 : result.page} of {result.pages}</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setLoading(true); setPage((current) => Math.max(1, current - 1)) }} disabled={page <= 1 || loading} className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-40">Previous</button>
          <button type="button" onClick={() => { setLoading(true); setPage((current) => Math.min(result.pages, current + 1)) }} disabled={page >= result.pages || loading} className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={() => setSelected(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="incident-detail-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs text-slate-500">Incident detail</p><h3 id="incident-detail-title" className="mt-1 text-xl font-semibold text-white">{selected.event_type}</h3></div>
              <button type="button" onClick={() => { setEvidenceUrl(''); setSelected(null) }} className="rounded-lg px-3 py-1 text-sm text-slate-300 hover:bg-slate-800">Close</button>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Timestamp</dt><dd className="text-slate-200"><time dateTime={selected.created_at}>{formatLocalTimestamp(selected.created_at)}</time></dd></div>
              <div><dt className="text-slate-500">Camera</dt><dd className="text-slate-200">{selected.camera_name}</dd></div>
              <div><dt className="text-slate-500">Zone</dt><dd className="text-slate-200">{selected.zone_name}</dd></div>
              <div><dt className="text-slate-500">Alert</dt><dd className="text-slate-200">{selected.alert_status ?? 'No alert'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-slate-500">Details</dt><dd className="text-slate-200">{selected.detail}</dd></div>
            </dl>
            <div className="mt-5 rounded-xl border border-slate-800 bg-black p-2">
              {evidenceUrl ? <img src={evidenceUrl} alt={`Evidence frame for ${selected.event_type}`} className="mx-auto max-h-[55vh] max-w-full object-contain" /> : <p className="p-8 text-center text-sm text-slate-400">Loading evidence frame…</p>}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
