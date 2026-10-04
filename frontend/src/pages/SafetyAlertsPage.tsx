import { AlertTriangle, Image, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { apiBlob, apiRequest, formatLocalTimestamp, type AlertNote, type AssignableUser, type Camera, type SafetyAlert, type Zone } from '../lib/api'
import { useDashboardLiveData } from '../components/layout/DashboardLiveDataContext'

const alertStatuses: SafetyAlert['status'][] = [
  'New',
  'Acknowledged',
  'Under Investigation',
  'Resolved',
  'False Positive',
]
const detectionEventTypes = [
  'Restricted-zone entry',
  'Hazard-zone proximity',
  'Crowding threshold',
  'Missing helmet',
  'Missing vest',
  'Smoke detected',
  'Fire detected',
]

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to complete the alert request.'
}

function localDate(timestamp: string) {
  const value = new Date(timestamp)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function canManageAlerts() {
  try {
    const user: unknown = JSON.parse(window.localStorage.getItem('safety_user') ?? 'null')
    return typeof user === 'object' && user !== null && 'role' in user &&
      (user.role === 'administrator' || user.role === 'safety_officer')
  } catch {
    return false
  }
}

export function SafetyAlertsPage() {
  const { alerts, refreshAlerts, error: sharedError } = useDashboardLiveData()
  const [cameras, setCameras] = useState<Camera[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(null)
  const [selectedAlert, setSelectedAlert] = useState<SafetyAlert | null>(null)
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [canManage] = useState(canManageAlerts)
  const [severityFilter, setSeverityFilter] = useState('')
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [zoneFilter, setZoneFilter] = useState('')
  const [cameraFilter, setCameraFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    Promise.all([
      apiRequest<Camera[]>('/api/cameras'),
      apiRequest<Zone[]>('/api/zones'),
      canManage ? apiRequest<AssignableUser[]>('/api/users/assignable') : Promise.resolve([]),
      refreshAlerts(),
    ])
      .then(([cameraList, zoneList, userList]) => {
        setCameras(cameraList)
        setZones(zoneList)
        setUsers(userList)
      })
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
      .finally(() => setLoading(false))
  }, [canManage, refreshAlerts])

  useEffect(() => {
    if (selectedAlertId === null) {
      return
    }
    let cancelled = false
    let objectUrl = ''
    apiRequest<SafetyAlert>(`/api/alerts/${selectedAlertId}`)
      .then((detail) => {
        if (cancelled) return
        setSelectedAlert(detail)
        return apiBlob(`/api/events/${detail.id}/evidence`)
          .then((frame) => {
            if (cancelled) return
            objectUrl = URL.createObjectURL(frame)
            setEvidenceUrl(objectUrl)
          })
          .catch((frameError: unknown) => {
            if (!cancelled) setError(getErrorMessage(frameError))
          })
      })
      .catch((detailError: unknown) => {
        if (!cancelled) setError(getErrorMessage(detailError))
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [selectedAlertId])

  function selectAlert(alertId: number | null) {
    setSelectedAlert(null)
    setEvidenceUrl('')
    setSelectedAlertId(alertId)
  }

  const filteredAlerts = useMemo(() => alerts.filter((alert) => (
    (!severityFilter || alert.severity === severityFilter) &&
    (!eventTypeFilter || alert.event_type === eventTypeFilter) &&
    (!statusFilter || alert.status === statusFilter) &&
    (!zoneFilter || String(alert.zone_id ?? '') === zoneFilter) &&
    (!cameraFilter || String(alert.camera_id ?? '') === cameraFilter) &&
    (!dateFrom || localDate(alert.created_at) >= dateFrom) &&
    (!dateTo || localDate(alert.created_at) <= dateTo)
  )), [alerts, cameraFilter, dateFrom, dateTo, eventTypeFilter, severityFilter, statusFilter, zoneFilter])

  async function changeAlert(alert: SafetyAlert, changes: { status?: SafetyAlert['status']; assigned_user_id?: number | null }) {
    setSaving(true)
    setError('')
    try {
      await apiRequest<SafetyAlert>(`/api/alerts/${alert.alert_id}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      await refreshAlerts()
      if (selectedAlertId === alert.alert_id) {
        setSelectedAlert(await apiRequest<SafetyAlert>(`/api/alerts/${alert.alert_id}`))
      }
    } catch (updateError) {
      setError(getErrorMessage(updateError))
    } finally {
      setSaving(false)
    }
  }

  async function addNote() {
    if (!selectedAlert || !notesDraft.trim()) return
    setSaving(true)
    setError('')
    try {
      const note = await apiRequest<AlertNote>(`/api/alerts/${selectedAlert.alert_id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note: notesDraft }),
      })
      setSelectedAlert((current) => current ? { ...current, notes: [...(current.notes ?? []), note] } : current)
      setNotesDraft('')
    } catch (noteError) {
      setError(getErrorMessage(noteError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-400">Safety alerts</p>
        <h2 className="text-2xl font-semibold text-white">Detection alert queue</h2>
        <p className="mt-1 text-sm text-slate-400">Alerts refresh automatically every 5 seconds.</p>
      </div>

      {error || sharedError ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error || sharedError}</div> : null}

      <section aria-label="Alert filters" className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs text-slate-400">Severity
          <select className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
            <option value="">All severities</option><option>Critical</option><option>High</option><option>Medium</option>
          </select>
        </label>
        <label className="text-xs text-slate-400">Status
          <select className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>{alertStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">Event type
          <select className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)}>
            <option value="">All event types</option>{detectionEventTypes.map((eventType) => <option key={eventType}>{eventType}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">Zone
          <select className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}>
            <option value="">All zones</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">Camera
          <select className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" value={cameraFilter} onChange={(event) => setCameraFilter(event.target.value)}>
            <option value="">All cameras</option>{cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">From
          <input type="date" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label className="text-xs text-slate-400">To
          <input type="date" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
      </section>

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
        <table className="min-w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-900 text-slate-400">
            <tr><th className="px-4 py-3">Alert</th><th className="px-4 py-3">Camera / zone</th><th className="px-4 py-3">Detection</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Assigned to</th></tr>
          </thead>
          <tbody>
            {filteredAlerts.map((alert) => (
              <tr key={alert.alert_id} className={`border-t border-slate-800 ${selectedAlertId === alert.alert_id ? 'bg-slate-900/70' : ''}`}>
                <td className="whitespace-nowrap px-4 py-3">
                  <button type="button" className="text-left font-medium text-white hover:text-blue-200" onClick={() => selectAlert(alert.alert_id === selectedAlertId ? null : alert.alert_id)}>AL-{alert.alert_id}</button>
                  <time dateTime={alert.created_at} className="mt-1 block text-xs text-slate-500">{formatLocalTimestamp(alert.created_at)}</time>
                </td>
                <td className="px-4 py-3"><span className="text-white">{alert.camera_name}</span><span className="mt-1 block text-xs text-slate-500">{alert.zone_name}</span></td>
                <td className="px-4 py-3">{alert.event_type}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${alert.severity === 'Critical' ? 'bg-red-500/15 text-red-300' : alert.severity === 'High' ? 'bg-orange-500/15 text-orange-300' : 'bg-yellow-500/15 text-yellow-200'}`}>{alert.severity}</span></td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <select aria-label={`Status for alert ${alert.alert_id}`} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" value={alert.status} disabled={saving} onChange={(event) => void changeAlert(alert, { status: event.target.value as SafetyAlert['status'] })}>
                      {alertStatuses.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  ) : <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] text-slate-200">{alert.status}</span>}
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <select aria-label={`Assignee for alert ${alert.alert_id}`} className="max-w-40 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white" value={alert.assigned_user_id ?? ''} disabled={saving} onChange={(event) => void changeAlert(alert, { assigned_user_id: event.target.value ? Number(event.target.value) : null })}>
                      <option value="">Unassigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}
                    </select>
                  ) : <span>{alert.assigned_user_name ?? 'Unassigned'}</span>}
                </td>
              </tr>
            ))}
            {!loading && filteredAlerts.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No alerts match these filters.</td></tr> : null}
            {loading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading alerts...</td></tr> : null}
          </tbody>
        </table>
      </div>

      {selectedAlertId !== null ? (
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <h3 className="text-lg font-semibold text-white">Alert details · AL-{selectedAlertId}</h3>
          {!selectedAlert ? <p className="text-sm text-slate-400">Loading alert details...</p> : (
            <>
              <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                <p>Timestamp: <time dateTime={selectedAlert.created_at}>{formatLocalTimestamp(selectedAlert.created_at)}</time></p>
                <p>Zone: {selectedAlert.zone_name}</p>
                <p>Camera: {selectedAlert.camera_name}</p>
                <p>Detection: {selectedAlert.event_type}</p>
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-2" aria-label="Change alert status">
                  {alertStatuses.map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={saving || selectedAlert.status === status}
                      onClick={() => void changeAlert(selectedAlert, { status })}
                      className={`rounded-lg border px-3 py-2 text-xs ${selectedAlert.status === status ? 'border-blue-500 bg-blue-500/15 text-blue-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'} disabled:cursor-default disabled:opacity-60`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              ) : null}
              {evidenceUrl ? <img src={evidenceUrl} alt={`Evidence for alert ${selectedAlertId}`} className="max-h-[32rem] max-w-full rounded-xl object-contain" /> : <p className="text-sm text-slate-500"><Image className="mr-1 inline h-4 w-4" />Evidence frame unavailable.</p>}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-white">Investigation notes</h4>
                {selectedAlert.notes?.length ? selectedAlert.notes.map((note) => (
                  <article key={note.id} className="rounded-xl border border-slate-800 p-3">
                    <p className="whitespace-pre-wrap text-sm text-slate-200">{note.note}</p>
                    <p className="mt-2 text-xs text-slate-500">{note.user_name} · {formatLocalTimestamp(note.created_at)}</p>
                  </article>
                )) : <p className="text-sm text-slate-500">No investigation notes yet.</p>}
                {canManage ? (
                  <div className="space-y-2">
                    <textarea aria-label="Investigation note" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" rows={3} maxLength={2000} value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} placeholder="Add an investigation note..." />
                    <button type="button" disabled={saving || !notesDraft.trim()} onClick={() => void addNote()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"><Save className="h-4 w-4" />Add note</button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      ) : null}

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/15 text-red-300"><AlertTriangle className="h-5 w-5" /></div>
          <div><p className="text-sm text-slate-400">Human review required</p><p className="text-lg font-medium text-white">AI detections may be incorrect and require safety officer review.</p></div>
        </div>
      </div>
    </div>
  )
}
