import { Camera, Pencil, Trash2 } from 'lucide-react'

const cameras = [
  { name: 'Assembly East', zone: 'Assembly line', status: 'Connected', id: 'CAM-101' },
  { name: 'Boiler Room', zone: 'Machine operation area', status: 'Processing', id: 'CAM-102' },
  { name: 'Warehouse Gate', zone: 'Loading and unloading', status: 'Disconnected', id: 'CAM-103' },
]

export function CameraManagementPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400">Camera management</p>
          <h2 className="text-2xl font-semibold text-white">Connected devices</h2>
        </div>
        <button className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">Add camera</button>
      </div>

      <div className="space-y-4">
        {cameras.map((camera) => (
          <div key={camera.id} className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300">
                <Camera className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-white">{camera.name}</p>
                <p className="text-sm text-slate-400">{camera.zone}</p>
                <p className="text-xs text-slate-500">{camera.id}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${camera.status === 'Connected' ? 'bg-emerald-500/15 text-emerald-300' : camera.status === 'Processing' ? 'bg-blue-500/15 text-blue-300' : 'bg-red-500/15 text-red-300'}`}>
                {camera.status}
              </span>
              <button className="rounded-lg border border-slate-700 p-2 text-slate-200 hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>
              <button className="rounded-lg border border-slate-700 p-2 text-red-300 hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
