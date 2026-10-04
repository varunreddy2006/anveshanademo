import { Camera, CircleStop, PlayCircle, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  apiRequest,
  formatLocalTimestamp,
  uploadVideo,
  type Camera as CameraRecord,
  type CameraVisionStatus,
  type VisionModels,
  type Zone,
} from '../lib/api'
import { useDashboardLiveData } from '../components/layout/DashboardLiveDataContext'

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500'
const MAX_VIDEO_BYTES = 100 * 1024 * 1024

type CameraSource = 'webcam' | 'stream'

function savedCameraSource(cameraId: number): CameraSource {
  return window.localStorage.getItem(`safety_live_input_${cameraId}`) === 'stream' ? 'stream' : 'webcam'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to complete the monitoring request.'
}

function statusClass(status: CameraVisionStatus['status']) {
  if (status === 'Connected') return 'bg-emerald-500/15 text-emerald-300'
  if (status === 'Error') return 'bg-red-500/15 text-red-300'
  return 'bg-slate-700 text-slate-300'
}

function hasAdministratorRole() {
  try {
    const user: unknown = JSON.parse(window.localStorage.getItem('safety_user') ?? 'null')
    return typeof user === 'object' && user !== null && 'role' in user && user.role === 'administrator'
  } catch {
    return false
  }
}

export function LiveMonitoringPage() {
  const {
    cameras,
    cameraStatuses,
    frames,
    events,
    transferProgress,
    error: sharedError,
    refreshCameraStatuses,
    refreshEvents,
    updateCameraStatus,
    updateTransferProgress,
  } = useDashboardLiveData()
  const [zones, setZones] = useState<Zone[]>([])
  const [sources, setSources] = useState<Record<number, CameraSource>>({})
  const [models, setModels] = useState<VisionModels | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isAdministrator] = useState(hasAdministratorRole)
  const [clearingCameraId, setClearingCameraId] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([
      apiRequest<Zone[]>('/api/zones'),
      apiRequest<VisionModels>('/api/vision/models'),
    ])
      .then(([zoneData, modelData]) => {
        setZones(zoneData)
        setModels(modelData)
      })
      .catch((loadError: unknown) => setError(errorMessage(loadError)))
      .finally(() => setLoading(false))
  }, [])

  async function startCamera(camera: CameraRecord) {
    setError('')
    try {
      const source = sources[camera.id] ?? savedCameraSource(camera.id)
      const status = await apiRequest<CameraVisionStatus>(`/api/cameras/${camera.id}/vision/start`, {
        method: 'POST',
        body: JSON.stringify({ source }),
      })
      updateCameraStatus(camera.id, status)
      void refreshCameraStatuses()
    } catch (startError) {
      updateCameraStatus(camera.id, { camera_id: camera.id, status: 'Error', error: errorMessage(startError), running: false })
      setError(errorMessage(startError))
    }
  }

  async function stopCamera(cameraId: number) {
    setError('')
    try {
      const status = await apiRequest<CameraVisionStatus>(`/api/cameras/${cameraId}/vision/stop`, { method: 'POST' })
      updateCameraStatus(cameraId, status)
      void refreshCameraStatuses()
    } catch (stopError) {
      setError(errorMessage(stopError))
    }
  }

  async function clearCameraDetections(camera: CameraRecord) {
    const confirmed = window.confirm(
      `Clear all detection events, alerts, and evidence frames for "${camera.name}"? Cameras, zones, and users will not be deleted.`,
    )
    if (!confirmed) return

    setError('')
    setClearingCameraId(camera.id)
    try {
      await apiRequest<{ camera_id: number; events_deleted: number; alerts_deleted: number; evidence_deleted: number }>(
        `/api/cameras/${camera.id}/events`,
        { method: 'DELETE' },
      )
      await refreshEvents()
    } catch (clearError) {
      setError(errorMessage(clearError))
    } finally {
      setClearingCameraId(null)
    }
  }

  async function handleVideo(cameraId: number, file: File | undefined) {
    if (!file) return
    setError('')
    if (file.type !== 'video/mp4' || !file.name.toLowerCase().endsWith('.mp4')) {
      setError('Select an MP4 video file.')
      return
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError('The MP4 must be 100 MB or smaller.')
      return
    }
    updateTransferProgress(cameraId, 0)
    try {
      const result = await uploadVideo(cameraId, file, (progress) => {
        updateTransferProgress(cameraId, progress)
      })
      updateCameraStatus(cameraId, result)
      updateTransferProgress(cameraId, null)
      void refreshCameraStatuses()
    } catch (uploadError) {
      updateCameraStatus(cameraId, {
        camera_id: cameraId,
        source_type: 'upload',
        status: 'Error',
        error: errorMessage(uploadError),
        running: false,
      })
      updateTransferProgress(cameraId, null)
      setError(errorMessage(uploadError))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-slate-400">Live monitoring</p>
          <h2 className="text-2xl font-semibold text-white">Camera detection</h2>
          <p className="mt-1 text-sm text-slate-400">YOLOv8n person tracking · sampled every third frame on CPU</p>
        </div>
      </div>

      {error || sharedError ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error || sharedError}</div> : null}
      {models ? (
        <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-xs">
          <span className="text-slate-400">Person detection: YOLOv8n</span>
          <span className={models.ppe === 'AI model unavailable' ? 'text-amber-300' : 'text-emerald-300'}>PPE: {models.ppe}</span>
          <span className={models.fire_smoke === 'AI model unavailable' ? 'text-amber-300' : 'text-emerald-300'}>Fire/smoke: {models.fire_smoke}</span>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-slate-400">Loading cameras...</p> : null}
      {!loading && cameras.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
          No cameras configured. Add a camera in Camera Management to begin.
        </div>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {cameras.map((camera) => {
          const status = cameraStatuses[camera.id] ?? { camera_id: camera.id, status: 'Not connected' as const }
          const liveActive = status.source_type !== 'upload' && (status.running ?? status.status === 'Connected')
          const uploadActive = status.source_type === 'upload' && Boolean(status.running) && !status.completed
          const uploadPercent = transferProgress[camera.id]
          return (
            <article key={camera.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-white">{camera.name}</p>
                  <p className="text-xs text-slate-500">{camera.location}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${statusClass(status.status)}`}>{status.status}</span>
              </div>

              <div className="relative flex aspect-video items-center justify-center bg-slate-900">
                {frames[camera.id] ? (
                  <img src={frames[camera.id]} alt={`Annotated detection frame from ${camera.name}`} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    <Camera className="h-8 w-8" />
                    <span className="text-xs">{status.status === 'Error' ? status.error : 'No processed frame'}</span>
                  </div>
                )}
                {status.source_type === 'upload' ? <span className="absolute left-2 top-2 rounded bg-slate-950/80 px-2 py-1 text-[10px] text-slate-200">Uploaded MP4 · not live</span> : null}
              </div>

              <div className="space-y-4 p-4">
                <label className="block space-y-1 text-xs text-slate-400">
                  Live input
                  <select
                    className={inputClass}
                    value={sources[camera.id] ?? savedCameraSource(camera.id)}
                    onChange={(event) => {
                      const source = event.target.value as CameraSource
                      window.localStorage.setItem(`safety_live_input_${camera.id}`, source)
                      setSources((current) => ({ ...current, [camera.id]: source }))
                    }}
                    disabled={liveActive || uploadActive}
                  >
                    <option value="webcam">Laptop webcam (device 0)</option>
                    <option value="stream" disabled={!camera.stream_url}>Configured RTSP/HTTP stream</option>
                  </select>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => (liveActive ? stopCamera(camera.id) : startCamera(camera))}
                    disabled={!liveActive && uploadActive}
                    className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${liveActive ? 'border border-slate-700 text-slate-200 hover:bg-slate-800' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
                  >
                    {liveActive ? <CircleStop className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                    {liveActive ? 'Stop live camera' : 'Start live camera'}
                  </button>
                  <label className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 ${liveActive || uploadActive ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-800'}`}>
                    <Upload className="h-4 w-4" />
                    Test MP4
                    <input
                      type="file"
                      accept="video/mp4,.mp4"
                      className="sr-only"
                      disabled={liveActive || uploadActive}
                      onChange={(event) => {
                        void handleVideo(camera.id, event.currentTarget.files?.[0])
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>
                </div>
                {uploadPercent !== undefined && uploadPercent < 100 ? (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-slate-400"><span>Uploading MP4</span><span>{uploadPercent}%</span></div>
                    <progress className="h-2 w-full accent-blue-500" max="100" value={uploadPercent} />
                  </div>
                ) : null}
                {status.source_type === 'upload' ? (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-slate-400">
                      <span>{status.error ? 'Processing error' : status.completed ? 'Video analysis complete' : 'Analyzing uploaded video'}</span>
                      <span>{Math.round(status.progress ?? 0)}%</span>
                    </div>
                    <progress className="h-2 w-full accent-emerald-500" max="100" value={status.progress ?? 0} />
                    {status.error ? <p role="alert" className="mt-1 text-xs text-red-300">{status.error}</p> : null}
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
                  <span>{zones.filter((zone) => zone.camera_id === null || zone.camera_id === camera.id).length} monitored zones</span>
                  {status.status === 'Error' ? <span className="max-w-[60%] text-right text-red-300">{status.error}</span> : null}
                </div>
                {isAdministrator ? (
                  <button
                    type="button"
                    onClick={() => void clearCameraDetections(camera)}
                    disabled={clearingCameraId !== null}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {clearingCameraId === camera.id ? 'Clearing detection data...' : 'Clear detection events and alerts'}
                  </button>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-400">Detection events</p>
            <h3 className="text-lg font-medium text-white">Latest safety activity</h3>
          </div>
          <span className="text-xs text-slate-500">Saved with evidence frames</span>
        </div>
        {events.length ? (
          <div className="space-y-2">
            {events.slice(0, 5).map((event) => (
              <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 px-3 py-2 text-sm">
                <div><span className="font-medium text-white">{event.event_type}</span><span className="ml-2 text-slate-400">{event.zone_name} · {event.camera_name}</span></div>
                <time dateTime={event.created_at} className="text-xs text-slate-500">{formatLocalTimestamp(event.created_at)}</time>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">Events detected by active cameras will appear here.</p>}
      </section>
    </div>
  )
}
