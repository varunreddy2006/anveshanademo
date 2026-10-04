import { useEffect, useState } from 'react'

import { apiRequest, formatLocalTimestamp, type DetectionEvent } from '../lib/api'

export function IncidentHistoryPage() {
  const [events, setEvents] = useState<DetectionEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    apiRequest<DetectionEvent[]>('/api/events')
      .then(setEvents)
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load incident history.')
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-slate-400">Incident history</p>
          <h2 className="text-2xl font-semibold text-white">Searchable incident log</h2>
        </div>
        <div className="flex gap-3">
          <input className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500" placeholder="Search incidents" />
          <button className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Export CSV</button>
        </div>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <table className="min-w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Camera / zone</th>
              <th className="px-4 py-3">Incident</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3">Frame</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-t border-slate-800">
                <td className="whitespace-nowrap px-4 py-3">
                  <time dateTime={event.created_at}>{formatLocalTimestamp(event.created_at)}</time>
                </td>
                <td className="px-4 py-3">
                  <span className="text-white">{event.camera_name}</span>
                  <span className="mt-1 block text-xs text-slate-500">{event.zone_name}</span>
                </td>
                <td className="px-4 py-3">{event.event_type}</td>
                <td className="px-4 py-3">{event.detail}</td>
                <td className="px-4 py-3">{event.frame_index}</td>
              </tr>
            ))}
            {!loading && !error && events.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No detection events recorded yet.</td></tr>
            ) : null}
            {loading ? <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading incident history...</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
