export function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-400">Reports</p>
        <h2 className="text-2xl font-semibold text-white">Daily, weekly, and monthly summaries</h2>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {['Daily summary', 'Weekly report', 'Monthly overview'].map((label) => (
          <div key={label} className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
            <p className="text-sm text-slate-400">{label}</p>
            <p className="mt-3 text-3xl font-bold text-white">0</p>
            <p className="mt-2 text-xs text-slate-500">No incidents available for the selected period.</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <p className="text-sm text-slate-400">Current state</p>
        <p className="mt-3 text-lg text-white">No records match the configured filters. Generate a report after new incident data is recorded.</p>
      </div>
    </div>
  )
}
