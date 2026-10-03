import { Camera, PauseCircle, PlayCircle, ScanSearch } from 'lucide-react'

import { cameraCards } from '../data/mock-data'

export function LiveMonitoringPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-slate-400">Live monitoring</p>
          <h2 className="text-2xl font-semibold text-white">Camera coverage</h2>
        </div>
        <div className="flex gap-3">
          <button className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
            <PlayCircle className="h-4 w-4 text-emerald-300" />
            Start processing
          </button>
          <button className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
            <PauseCircle className="h-4 w-4 text-amber-300" />
            Pause all
          </button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {cameraCards.map((camera) => (
          <div key={camera.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-white">{camera.name}</p>
                <p className="text-xs text-slate-500">{camera.id}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${camera.status === 'Connected' ? 'bg-emerald-500/15 text-emerald-300' : camera.status === 'Processing' ? 'bg-blue-500/15 text-blue-300' : 'bg-red-500/15 text-red-300'}`}>
                {camera.status}
              </span>
            </div>

            <div className="flex h-36 items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 text-slate-400">
                <Camera className="h-8 w-8" />
              </div>
            </div>

            <div className="space-y-3 p-4 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Zone</span>
                <span className="text-white">{camera.zone}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Last processed</span>
                <span>{camera.lastProcessed}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Status</span>
                <span>{camera.detection}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Input</span>
                <span>{camera.stream}</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-800 p-4">
              <button className="inline-flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200">
                <ScanSearch className="h-4 w-4" />
                Full screen
              </button>
              <button className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">
                {camera.status === 'Disconnected' ? 'Reconnect' : 'Stop'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
