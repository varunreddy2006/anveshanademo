import { Camera, CircleStop, PlayCircle, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  apiBlob,
  apiRequest,
  formatLocalTimestamp,
  uploadVideo,
  type Camera as CameraRecord,
  type CameraVisionStatus,
  type DetectionEvent,
  type UploadJob,
  type VisionModels,
  type Zone,
} from '../lib/api'

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500'
const MAX_VIDEO_BYTES = 100 * 1024 * 1024

type CameraSource = 'webcam' | 'stream'
type UploadProgress = { jobId: string; progress: number; completed: boolean; error?: string }

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
  const [cameras, setCameras] = useState<CameraRecord[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [cameraStatuses, setCameraStatuses] = useState<Record<number, CameraVisionStatus>>({})
  const [activeCameras, setActiveCameras] = useState<Record<number, boolean>>({})
  const [sources, setSources] = useState<Record<number, CameraSource>>({})
  const [frames, setFrames] = useState<Record<number, string>>({})
  const [uploadJobs, setUploadJobs] = useState<Record<number, UploadProgress>>({})
  const [transferProgress, setTransferProgress] = useState<Record<number, number>>({})
  const [events, setEvents] = useState<DetectionEvent[]>([])
  const [models, setModels] = useState<VisionModels | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isAdministrator] = useState(hasAdministratorRole)
  const [clearingCameraId, setClearingCameraId] = useState<number | null>(null)
  const uploadJobsRef = useRef(uploadJobs)
  const frameUrlsRef = useRef<Record<number, string>>({})

  function updateUploadJob(cameraId: number, job: UploadProgress) {
    setUploadJobs((current) => {
      const updated = { ...current, [cameraId]: job }
      uploadJobsRef.current = updated
      return updated
    })
  }

  useEffect(() => {
    Promise.all([
      apiRequest<CameraRecord[]>('/api/cameras'),
      apiRequest<Zone[]>('/api/zones'),
      apiRequest<VisionModels>('/api/vision/models'),
      apiRequest<DetectionEvent[]>('/api/events'),
    ])
      .then(([cameraData, zoneData, modelData, eventData]) => {
        setCameras(cameraData)
        setZones(zoneData)
        setModels(modelData)
        setEvents(eventData)
        setSources(Object.fromEntries(cameraData.map((camera) => [camera.id, 'webcam'])))
        setCameraStatuses(
          Object.fromEntries(cameraData.map((camera) => [camera.id, { camera_id: camera.id, status: 'Not connected' }])),
        )
      })
      .catch((loadError: unknown) => setError(errorMessage(loadError)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      for (const camera of cameras) {
        const cameraId = camera.id
        apiRequest<CameraVisionStatus>(`/api/cameras/${cameraId}/vision/status`)
          .then((status) => {
            setCameraStatuses((current) => ({ ...current, [cameraId]: status }))
            if (status.status === 'Connected') {
              apiBlob(`/api/cameras/${cameraId}/vision/frame`)
                .then((blob) => {
                  const url = URL.createObjectURL(blob)
                  const previous = frameUrlsRef.current[cameraId]
                  if (previous) URL.revokeObjectURL(previous)
                  frameUrlsRef.current[cameraId] = url
                  setFrames((current) => ({ ...current, [cameraId]: url }))
                })
                .catch(() => undefined)
            } else if (status.status === 'Error') {
              setActiveCameras((current) => ({ ...current, [cameraId]: false }))
            }
          })
          .catch((statusError: unknown) => {
            setCameraStatuses((current) => ({
              ...current,
              [cameraId]: { camera_id: cameraId, status: 'Error', error: errorMessage(statusError) },
            }))
          })
      }
    }, 1500)
    return () => window.clearInterval(interval)
  }, [cameras])

  useEffect(() => {
    const interval = window.setInterval(() => {
      for (const [cameraIdText, job] of Object.entries(uploadJobsRef.current)) {
        if (!job.jobId || job.completed || job.error) continue
        const cameraId = Number(cameraIdText)
        apiRequest<UploadJob>(`/api/uploads/${job.jobId}`)
          .then((status) => {
            updateUploadJob(cameraId, {
              ...job,
              progress: status.progress ?? job.progress,
              completed: Boolean(status.completed),
              ...(status.error ? { error: status.error } : {}),
            })
            apiBlob(`/api/uploads/${job.jobId}/frame`)
              .then((blob) => {
                const url = URL.createObjectURL(blob)
                const previous = frameUrlsRef.current[cameraId]
                if (previous) URL.revokeObjectURL(previous)
                frameUrlsRef.current[cameraId] = url
                setFrames((current) => ({ ...current, [cameraId]: url }))
              })
              .catch(() => undefined)
          })
          .catch((statusError: unknown) => {
            updateUploadJob(cameraId, { ...job, error: errorMessage(statusError) })
          })
      }
    }, 1200)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      apiRequest<DetectionEvent[]>('/api/events').then(setEvents).catch((refreshError: unknown) => setError(errorMessage(refreshError)))
    }, 5000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(
    () => () => {
      Object.values(frameUrlsRef.current).forEach(URL.revokeObjectURL)
    },
    [],
  )

  async function startCamera(camera: CameraRecord) {
    setError('')
    setFrames((current) => ({ ...current, [camera.id]: '' }))
    try {
      const source = sources[camera.id] ?? 'webcam'
      await apiRequest<CameraVisionStatus>(`/api/cameras/${camera.id}/vision/start`, {
        method: 'POST',
        body: JSON.stringify({ source }),
      })
      setActiveCameras((current) => ({ ...current, [camera.id]: true }))
    } catch (startError) {
      setCameraStatuses((current) => ({
        ...current,
        [camera.id]: { camera_id: camera.id, status: 'Error', error: errorMessage(startError) },
      }))
      setError(errorMessage(startError))
    }
  }

  async function stopCamera(cameraId: number) {
    setError('')
    try {
      const status = await apiRequest<CameraVisionStatus>(`/api/cameras/${cameraId}/vision/stop`, { method: 'POST' })
      setCameraStatuses((current) => ({ ...current, [cameraId]: status }))
      setActiveCameras((current) => ({ ...current, [cameraId]: false }))
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
      setEvents((current) => current.filter((event) => event.camera_id !== camera.id))
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
    updateUploadJob(cameraId, { jobId: '', progress: 0, completed: false })
    setTransferProgress((current) => ({ ...current, [cameraId]: 0 }))
    try {
      const result = await uploadVideo(cameraId, file, (progress) => {
        setTransferProgress((current) => ({ ...current, [cameraId]: progress }))
      })
      updateUploadJob(cameraId, { jobId: result.job_id ?? '', progress: 0, completed: false })
      setTransferProgress((current) => ({ ...current, [cameraId]: 100 }))
    } catch (uploadError) {
      updateUploadJob(cameraId, { jobId: '', progress: 0, completed: false, error: errorMessage(uploadError) })
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

      {error ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
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
          const job = uploadJobs[camera.id]
          const liveActive = activeCameras[camera.id] ?? status.status === 'Connected'
          const uploadPercent = transferProgress[camera.id]
          const uploadActive = !job?.error && (
            (!job?.jobId && uploadPercent !== undefined && uploadPercent < 100) ||
            (Boolean(job?.jobId) && !job?.completed)
          )
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
                {job?.jobId && !liveActive ? <span className="absolute left-2 top-2 rounded bg-slate-950/80 px-2 py-1 text-[10px] text-slate-200">Uploaded MP4 · not live</span> : null}
              </div>

              <div className="space-y-4 p-4">
                <label className="block space-y-1 text-xs text-slate-400">
                  Live input
                  <select
                    className={inputClass}
                    value={sources[camera.id] ?? 'webcam'}
                    onChange={(event) => setSources((current) => ({ ...current, [camera.id]: event.target.value as CameraSource }))}
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
                {transferProgress[camera.id] !== undefined && transferProgress[camera.id] < 100 ? (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-slate-400"><span>Uploading MP4</span><span>{transferProgress[camera.id]}%</span></div>
                    <progress className="h-2 w-full accent-blue-500" max="100" value={transferProgress[camera.id]} />
                  </div>
                ) : null}
                {job?.jobId ? (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-slate-400">
                      <span>{job.error ? 'Processing error' : job.completed ? 'Video analysis complete' : 'Analyzing uploaded video'}</span>
                      <span>{Math.round(job.progress)}%</span>
                    </div>
                    <progress className="h-2 w-full accent-emerald-500" max="100" value={job.progress} />
                    {job.error ? <p role="alert" className="mt-1 text-xs text-red-300">{job.error}</p> : null}
                  </div>
                ) : job?.error ? <p role="alert" className="text-xs text-red-300">{job.error}</p> : null}
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
