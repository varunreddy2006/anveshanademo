import { AlertTriangle, Image } from 'lucide-react'
import { useEffect, useState } from 'react'

import { apiBlob, apiRequest, formatLocalTimestamp, type SafetyAlert } from '../lib/api'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load safety alerts.'
}

export function SafetyAlertsPage() {
  const [alerts, setAlerts] = useState<SafetyAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [selectedAlert, setSelectedAlert] = useState<number | null>(null)
  const [evidenceLoading, setEvidenceLoading] = useState(false)

  useEffect(() => {
    apiRequest<SafetyAlert[]>('/api/alerts')
      .then(setAlerts)
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
      .finally(() => setLoading(false))
  }, [])

  async function showEvidence(alert: SafetyAlert) {
    if (selectedAlert === alert.alert_id) {
      setSelectedAlert(null)
      setEvidenceUrl('')
      return
    }
    setSelectedAlert(alert.alert_id)
    setEvidenceUrl('')
    setEvidenceLoading(true)
    try {
      const blob = await apiBlob(alert.evidence_url)
      setEvidenceUrl(URL.createObjectURL(blob))
    } catch (evidenceError) {
      setError(getErrorMessage(evidenceError))
      setSelectedAlert(null)
    } finally {
      setEvidenceLoading(false)
    }
  }

  useEffect(() => () => {
    if (evidenceUrl) URL.revokeObjectURL(evidenceUrl)
  }, [evidenceUrl])

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-400">Safety alerts</p>
        <h2 className="text-2xl font-semibold text-white">Detection alert queue</h2>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
        <table className="min-w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Alert</th>
              <th className="px-4 py-3">Camera / zone</th>
              <th className="px-4 py-3">Detection</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.alert_id} className="border-t border-slate-800">
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="font-medium text-white">AL-{alert.alert_id}</span>
                  <time dateTime={alert.created_at} className="mt-1 block text-xs text-slate-500">{formatLocalTimestamp(alert.created_at)}</time>
                </td>
                <td className="px-4 py-3">
                  <span className="text-white">{alert.camera_name}</span>
                  <span className="mt-1 block text-xs text-slate-500">{alert.zone_name}</span>
                </td>
                <td className="px-4 py-3">{alert.event_type}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${alert.severity === 'High' ? 'bg-orange-500/15 text-orange-300' : 'bg-yellow-500/15 text-yellow-200'}`}>{alert.severity}</span>
                </td>
                <td className="px-4 py-3"><span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] text-slate-200">{alert.status}</span></td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => void showEvidence(alert)} className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
                    <Image className="h-3.5 w-3.5" />
                    {selectedAlert === alert.alert_id ? 'Hide' : 'View'}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && alerts.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No detection alerts yet. Events raised by monitoring will be listed here.</td></tr>
            ) : null}
            {loading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading alerts...</td></tr> : null}
          </tbody>
        </table>
      </div>

      {selectedAlert !== null ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <p className="mb-3 text-sm font-medium text-white">Evidence frame · AL-{selectedAlert}</p>
          {evidenceLoading ? <p className="text-sm text-slate-400">Loading evidence...</p> : null}
          {evidenceUrl ? <img src={evidenceUrl} alt={`Evidence for alert ${selectedAlert}`} className="max-h-[32rem] max-w-full rounded-xl object-contain" /> : null}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/15 text-red-300">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm text-slate-400">Human review required</p>
            <p className="text-lg font-medium text-white">AI detections may be incorrect and require safety officer review.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
