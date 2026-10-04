import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { apiBlob, apiRequest, type ReportSummary } from '../lib/api'

type ReportPeriod = 'day' | 'week' | 'month'

const inputClass = 'rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white'

function toDateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function periodRange(period: ReportPeriod, dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number)
  const start = new Date(year, month - 1, day)
  if (period === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  } else if (period === 'month') {
    start.setDate(1)
  }
  const end = new Date(start)
  if (period === 'day') end.setDate(end.getDate() + 1)
  if (period === 'week') end.setDate(end.getDate() + 7)
  if (period === 'month') end.setMonth(end.getMonth() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

export function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>('day')
  const [reportDate, setReportDate] = useState(() => toDateInputValue(new Date()))
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const range = periodRange(period, reportDate)
    let cancelled = false
    apiRequest<ReportSummary>(`/api/reports/summary?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`)
      .then((data) => {
        if (!cancelled) {
          setSummary(data)
          setError('')
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load this report.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [period, reportDate])

  async function downloadReport() {
    setDownloading(true)
    setError('')
    try {
      const range = periodRange(period, reportDate)
      const params = new URLSearchParams({ period, report_date: reportDate, start: range.start, end: range.end })
      const pdf = await apiBlob(`/api/reports/pdf?${params.toString()}`)
      const url = URL.createObjectURL(pdf)
      const link = document.createElement('a')
      link.href = url
      link.download = `safety-report-${period}-${reportDate}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Unable to generate the PDF report.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">Reports</p>
          <h2 className="text-2xl font-semibold text-white">Incident summaries</h2>
          <p className="mt-1 text-sm text-slate-500">Incident charts for the selected period and current zone risk.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs text-slate-400">
            Period
            <select className={inputClass} value={period} onChange={(event) => { setLoading(true); setPeriod(event.target.value as ReportPeriod) }}>
              <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-slate-400">
            Date
            <input type="date" className={inputClass} value={reportDate} onChange={(event) => { setLoading(true); setReportDate(event.target.value) }} />
          </label>
          <button type="button" onClick={() => void downloadReport()} disabled={downloading || loading} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {downloading ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      {summary?.includes_simulated ? <p className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 px-4 py-3 text-sm font-medium text-fuchsia-200">Includes SIMULATED data in risk history. Simulated values are separate from real incidents.</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <p className="text-sm text-slate-400">Incidents in selected period</p>
          <p className="mt-2 text-3xl font-semibold text-white">{loading ? '—' : summary?.total_incidents ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <p className="text-sm text-slate-400">Zones with current risk</p>
          <p className="mt-2 text-3xl font-semibold text-white">{loading ? '—' : summary?.zone_risks.length ?? 0}</p>
        </div>
      </div>

      {!loading && summary?.total_incidents === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-950 px-5 py-8 text-center text-slate-400">No incidents for the selected period</div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <h3 className="font-semibold text-white">Incidents by type</h3>
          <div className="mt-4 h-72">
            {!loading && summary?.by_type.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.by_type} margin={{ top: 8, right: 12, bottom: 28, left: 0 }}>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-16} textAnchor="end" interval={0} />
                  <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, color: '#e2e8f0' }} />
                  <Bar dataKey="count" name="Incidents" fill="#60a5fa" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="pt-8 text-sm text-slate-500">No incidents for the selected period</p>}
          </div>
        </section>
        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <h3 className="font-semibold text-white">Incidents by zone</h3>
          <div className="mt-4 h-72">
            {!loading && summary?.by_zone.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.by_zone} margin={{ top: 8, right: 12, bottom: 28, left: 0 }}>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-16} textAnchor="end" interval={0} />
                  <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, color: '#e2e8f0' }} />
                  <Bar dataKey="count" name="Incidents" fill="#34d399" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="pt-8 text-sm text-slate-500">No incidents for the selected period</p>}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <h3 className="font-semibold text-white">Current zone risk scores</h3>
        <p className="mt-1 text-xs text-slate-500">Calculated indicators, not validated predictions. AI detections require human review.</p>
        {summary?.zone_risks.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm text-slate-300">
              <thead className="text-xs text-slate-500"><tr><th className="py-2 pr-4">Zone</th><th className="py-2 pr-4">Score</th><th className="py-2 pr-4">Trend</th><th className="py-2">5-min projection</th></tr></thead>
              <tbody>{summary.zone_risks.map((risk) => (
                <tr key={risk.zone_id} className="border-t border-slate-800">
                  <td className="py-3 pr-4 text-white">{risk.zone_name}</td><td className="py-3 pr-4">{risk.score}/100</td><td className="py-3 pr-4 capitalize">{risk.trend}</td><td className="py-3">{risk.projected_score}/100</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="mt-4 text-sm text-slate-500">No configured zones.</p>}
      </section>
      <p className="text-xs leading-5 text-slate-600">AI detections can be incorrect and require human review. Risk values are calculated indicators, not validated predictions.</p>
    </div>
  )
}
