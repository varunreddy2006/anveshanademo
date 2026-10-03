import { AlertTriangle, ArrowUpRight, Camera, ShieldCheck, TrendingUp } from 'lucide-react'

import { dashboardMetrics, recentAlerts, safetyInsights, zoneHistory } from '../data/mock-data'

export function DashboardOverviewPage() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboardMetrics.map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-sm text-slate-400">{item.label}</p>
            <p className="mt-3 text-3xl font-bold text-white">{item.value}</p>
            <p className="mt-2 text-xs text-emerald-300">{item.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Safety trend</p>
              <h2 className="text-lg font-semibold text-white">Incident counts over time</h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <TrendingUp className="h-3.5 w-3.5" />
              Monitor trend
            </div>
          </div>

          <div className="grid h-48 grid-cols-6 items-end gap-3">
            {[26, 22, 30, 28, 34, 42].map((height, index) => (
              <div key={height + index} className="flex h-full items-end justify-center">
                <div style={{ height: `${height}%` }} className="w-full rounded-t-xl bg-gradient-to-t from-blue-600 to-cyan-400" />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Current state</p>
              <h2 className="text-lg font-semibold text-white">Active alerts</h2>
            </div>
            <AlertTriangle className="h-4 w-4 text-orange-300" />
          </div>

          <div className="space-y-3">
            {recentAlerts.map((alert) => (
              <div key={alert.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{alert.id}</span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${alert.severity === 'Critical' ? 'bg-red-500/15 text-red-300' : alert.severity === 'High' ? 'bg-orange-500/15 text-orange-300' : 'bg-yellow-500/15 text-yellow-200'}`}>
                    {alert.severity}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-300">{alert.type}</p>
                <p className="mt-1 text-xs text-slate-500">{alert.zone} • {alert.time}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Zone risk</p>
              <h2 className="text-lg font-semibold text-white">Current risk overview</h2>
            </div>
            <ShieldCheck className="h-4 w-4 text-blue-300" />
          </div>

          <div className="space-y-4">
            {safetyInsights.map((zone) => (
              <div key={zone.title} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{zone.title}</span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${zone.color === 'red' ? 'bg-red-500/15 text-red-300' : zone.color === 'amber' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                    {zone.risk}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className={`h-full rounded-full ${zone.color === 'red' ? 'bg-red-500' : zone.color === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${zone.score}%` }} />
                </div>
                <div className="mt-2 text-right text-xs text-slate-400">Risk score {zone.score}/100</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Monitoring</p>
              <h2 className="text-lg font-semibold text-white">Recent activity</h2>
            </div>
            <Camera className="h-4 w-4 text-cyan-300" />
          </div>

          <div className="space-y-4">
            {zoneHistory.map((zone) => (
              <div key={zone.name}>
                <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
                  <span>{zone.name}</span>
                  <span className="text-xs text-slate-500">Last 6 periods</span>
                </div>
                <div className="flex h-20 items-end gap-2">
                  {zone.trend.map((value, idx) => (
                    <div key={`${zone.name}-${idx}`} className="flex-1 rounded-t-xl bg-gradient-to-t from-blue-600 to-cyan-400" style={{ height: `${Number(value) * 3}px` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-400">Summary</p>
            <h2 className="text-lg font-semibold text-white">Recent incidents</h2>
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800">
            View full history
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-800">
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
              {recentAlerts.map((alert) => (
                <tr key={alert.id} className="border-t border-slate-800">
                  <td className="px-4 py-3">{alert.time}</td>
                  <td className="px-4 py-3">{alert.zone}</td>
                  <td className="px-4 py-3">{alert.type}</td>
                  <td className="px-4 py-3">{alert.severity}</td>
                  <td className="px-4 py-3">{alert.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
