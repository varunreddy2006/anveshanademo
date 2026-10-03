const incidents = [
  { time: '08:12', zone: 'Assembly line', type: 'PPE non-compliance', severity: 'High', status: 'Reviewed' },
  { time: '09:04', zone: 'Chemical storage', type: 'Restricted-zone entry', severity: 'Critical', status: 'Open' },
  { time: '10:22', zone: 'Loading bay', type: 'Crowding threshold', severity: 'Medium', status: 'Monitor' },
]

export function IncidentHistoryPage() {
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

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <table className="min-w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Zone</th>
              <th className="px-4 py-3">Incident</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((incident) => (
              <tr key={`${incident.time}-${incident.zone}`} className="border-t border-slate-800">
                <td className="px-4 py-3">{incident.time}</td>
                <td className="px-4 py-3">{incident.zone}</td>
                <td className="px-4 py-3">{incident.type}</td>
                <td className="px-4 py-3">{incident.severity}</td>
                <td className="px-4 py-3">{incident.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
