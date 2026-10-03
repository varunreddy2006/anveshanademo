import { AlertTriangle } from 'lucide-react'

const alerts = [
  { id: 'AL-204', zone: 'Chemical storage', type: 'Restricted-zone entry', severity: 'Critical', status: 'Open', owner: 'Shift lead', time: '2 min ago' },
  { id: 'AL-205', zone: 'Assembly line', type: 'Unsafe proximity', severity: 'High', status: 'Acknowledged', owner: 'Safety officer', time: '11 min ago' },
  { id: 'AL-206', zone: 'Loading bay', type: 'Crowding threshold', severity: 'Medium', status: 'Monitoring', owner: 'Operations', time: '34 min ago' },
]

export function SafetyAlertsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400">Safety alerts</p>
          <h2 className="text-2xl font-semibold text-white">Alert queue</h2>
        </div>
        <button className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Filter alerts</button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <table className="min-w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Alert ID</th>
              <th className="px-4 py-3">Zone</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id} className="border-t border-slate-800">
                <td className="px-4 py-3">{alert.id}</td>
                <td className="px-4 py-3">{alert.zone}</td>
                <td className="px-4 py-3">{alert.type}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${alert.severity === 'Critical' ? 'bg-red-500/15 text-red-300' : alert.severity === 'High' ? 'bg-orange-500/15 text-orange-300' : 'bg-yellow-500/15 text-yellow-200'}`}>
                    {alert.severity}
                  </span>
                </td>
                <td className="px-4 py-3">{alert.owner}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] text-slate-200">{alert.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
