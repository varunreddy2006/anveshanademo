export function ZoneRiskPage() {
  const zones = [
    { name: 'Assembly line', score: 72, band: 'High', note: 'Repeat PPE incidents in the last 7 days.' },
    { name: 'Chemical storage', score: 88, band: 'Critical', note: 'Intermittent restricted-zone entries and hazard review required.' },
    { name: 'Machine operation area', score: 68, band: 'High', note: 'Proximity alerts near hazard boundary increased.' },
    { name: 'Loading bay', score: 41, band: 'Moderate', note: 'Crowding risk remains manageable with monitoring.' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-400">Zone risk analysis</p>
        <h2 className="text-2xl font-semibold text-white">Calculated historical indicator</h2>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {zones.map((zone) => (
          <div key={zone.name} className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-lg font-semibold text-white">{zone.name}</p>
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${zone.band === 'Critical' ? 'bg-red-500/15 text-red-300' : zone.band === 'High' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                {zone.band}
              </span>
            </div>
            <p className="text-4xl font-bold text-white">{zone.score}</p>
            <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">Risk score / 100</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
              <div className={`h-full rounded-full ${zone.band === 'Critical' ? 'bg-red-500' : zone.band === 'High' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${zone.score}%` }} />
            </div>
            <p className="mt-4 text-sm text-slate-300">{zone.note}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
