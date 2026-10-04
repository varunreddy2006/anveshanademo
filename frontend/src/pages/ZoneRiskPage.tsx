import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Camera as CameraIcon, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { type FormEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'

import { apiBlob, apiRequest, type Camera, type RiskHistoryPoint, type Zone, type ZoneInput, type ZoneRisk, type ZoneType } from '../lib/api'
import { useDashboardLiveData } from '../components/layout/DashboardLiveDataContext'

const riskBands = [
  { max: 33, label: 'Low', classes: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', stroke: '#34d399' },
  { max: 55, label: 'Guarded', classes: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200', stroke: '#facc15' },
  { max: 75, label: 'Elevated', classes: 'border-orange-500/40 bg-orange-500/10 text-orange-300', stroke: '#fb923c' },
  { max: 100, label: 'High', classes: 'border-red-500/40 bg-red-500/10 text-red-300', stroke: '#f87171' },
]

function riskBand(score: number) {
  return riskBands.find((band) => score <= band.max) ?? riskBands[riskBands.length - 1]
}

function canClearDetectionData() {
  try {
    const user: unknown = JSON.parse(window.localStorage.getItem('safety_user') ?? 'null')
    return (
      typeof user === 'object' &&
      user !== null &&
      'role' in user &&
      (user.role === 'administrator' || user.role === 'safety_officer')
    )
  } catch {
    return false
  }
}

function chartPath(points: RiskHistoryPoint[], current: ZoneRisk, simulated: boolean) {
  const chartValues = points.filter((point) => point.is_simulated === simulated)
  if (simulated && chartValues.length === 0) return ''
  if (!simulated) {
    chartValues.push({
      score: current.score,
      trend: current.trend,
      velocity: current.velocity,
      projected_score: current.projected_score,
      explanation: current.explanation,
      is_simulated: false,
      recorded_at: current.updated_at,
    })
  }
  const currentTime = new Date(current.updated_at).getTime()
  const chartX = (timestamp: string) => {
    const minutesFromWindowStart = (new Date(timestamp).getTime() - (currentTime - 60 * 60_000)) / 60_000
    return 10 + Math.max(0, Math.min(65, minutesFromWindowStart)) * (300 / 65)
  }
  return chartValues
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${chartX(point.recorded_at).toFixed(1)},${(90 - point.score * 0.8).toFixed(1)}`)
    .join(' ')
}

type ZoneFormState = {
  name: string
  camera_id: string
  zone_type: ZoneType
  shape_type: Zone['shape_type']
  x: string
  y: string
  width: string
  height: string
  points: string
  crowd_threshold: string
  confidence_threshold: string
}

const emptyForm: ZoneFormState = {
  name: '',
  camera_id: '',
  zone_type: 'normal',
  shape_type: 'rectangle',
  x: '0.05',
  y: '0.05',
  width: '0.4',
  height: '0.4',
  points: '0.1,0.1; 0.9,0.1; 0.9,0.9; 0.1,0.9',
  crowd_threshold: '10',
  confidence_threshold: '0.5',
}

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-500'

type RectangleValue = { x: number; y: number; width: number; height: number }

function RectangleDrawingCanvas({
  imageSource,
  rectangle,
  onDraw,
}: {
  imageSource: string
  rectangle: RectangleValue
  onDraw: (value: RectangleValue) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const draftRef = useRef<RectangleValue | null>(null)
  const { x, y, width, height } = rectangle

  const redraw = useCallback((draft: RectangleValue | null = draftRef.current) => {
    const canvas = canvasRef.current
    const image = imageRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !image || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0)
    const current = draft ?? { x, y, width, height }
    if (current.width <= 0 || current.height <= 0) return
    const left = current.x * canvas.width
    const top = current.y * canvas.height
    const rectWidth = current.width * canvas.width
    const rectHeight = current.height * canvas.height
    context.fillStyle = 'rgba(16, 185, 129, 0.16)'
    context.fillRect(left, top, rectWidth, rectHeight)
    context.strokeStyle = '#34d399'
    context.lineWidth = Math.max(2, canvas.width / 500)
    context.strokeRect(left, top, rectWidth, rectHeight)
  }, [height, width, x, y])

  useEffect(() => {
    const image = new Image()
    image.onload = () => {
      imageRef.current = image
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      redraw(null)
    }
    image.src = imageSource
  }, [imageSource, redraw])

  useEffect(() => {
    redraw()
  }, [redraw])

  function normalizedPoint(event: PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const point = normalizedPoint(event)
    dragStartRef.current = point
    draftRef.current = { x: point.x, y: point.y, width: 0, height: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
    redraw()
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const start = dragStartRef.current
    if (!start) return
    const point = normalizedPoint(event)
    draftRef.current = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    }
    redraw()
  }

  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const start = dragStartRef.current
    if (!start) return
    const point = normalizedPoint(event)
    const value = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    }
    dragStartRef.current = null
    draftRef.current = null
    if (value.width >= 0.01 && value.height >= 0.01) onDraw(value)
    else redraw(null)
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-label="Draw a rectangle zone on the selected preview frame"
      className="w-full cursor-crosshair rounded-xl border border-slate-700 bg-slate-900"
      style={{ touchAction: 'none' }}
    />
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to complete the zone request.'
}

function formFromZone(zone: Zone): ZoneFormState {
  if (zone.shape_type === 'rectangle') {
    return {
      ...emptyForm,
      name: zone.name,
      camera_id: zone.camera_id === null ? '' : String(zone.camera_id),
      zone_type: zone.zone_type ?? 'normal',
      shape_type: 'rectangle',
      x: String(zone.coordinates.x),
      y: String(zone.coordinates.y),
      width: String(zone.coordinates.width),
      height: String(zone.coordinates.height),
      crowd_threshold: String(zone.crowd_threshold),
      confidence_threshold: String(zone.confidence_threshold),
    }
  }

  return {
    ...emptyForm,
    name: zone.name,
    camera_id: zone.camera_id === null ? '' : String(zone.camera_id),
    zone_type: zone.zone_type ?? 'normal',
    shape_type: 'polygon',
    points: zone.coordinates.map(({ x, y }) => `${x},${y}`).join('; '),
    crowd_threshold: String(zone.crowd_threshold),
    confidence_threshold: String(zone.confidence_threshold),
  }
}

function ZoneRiskCard({ risk }: { risk: ZoneRisk }) {
  const band = riskBand(risk.score)
  const simulated = risk.simulated_demo
  const simulatedBand = simulated ? riskBand(simulated.score) : null
  const TrendIcon = risk.trend === 'increasing' ? ArrowUp : risk.trend === 'decreasing' ? ArrowDown : ArrowRight
  const realPath = chartPath(risk.history, risk, false)
  const simulatedPath = chartPath(risk.history, risk, true)
  const currentX = 10 + (60 * 300 / 65)
  const projectedX = 310
  const currentY = 90 - risk.score * 0.8
  const projectedY = 90 - risk.projected_score * 0.8
  const simulatedCurrentY = simulated ? 90 - simulated.score * 0.8 : 0
  const simulatedProjectedY = simulated ? 90 - simulated.projected_score * 0.8 : 0

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{risk.zone_type.replace('_', ' ')}</p>
          <h3 className="mt-1 text-lg font-semibold text-white">{risk.zone_name}</h3>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${band.classes}`}>{band.label}</span>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500">Calculated risk score</p>
          <p className="mt-1 text-4xl font-semibold text-white">{risk.score}<span className="text-lg text-slate-500">/100</span></p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-1 text-sm capitalize text-slate-200">
            <TrendIcon className={`h-4 w-4 ${risk.trend === 'increasing' ? 'text-orange-300' : risk.trend === 'decreasing' ? 'text-emerald-300' : 'text-slate-400'}`} />
            {risk.trend}
          </p>
          <p className="mt-1 text-xs text-slate-500">{risk.velocity > 0 ? '+' : ''}{risk.velocity.toFixed(1)} points/min</p>
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
        5-minute calculated projection: <strong className="text-white">{risk.projected_score}/100</strong>
      </p>

      {risk.score > 70 && risk.trend === 'increasing' ? (
        <p role="status" className="mt-3 flex items-center gap-2 rounded-xl border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm font-medium text-orange-200">
          <AlertTriangle className="h-4 w-4" /> Predictive warning
        </p>
      ) : null}
      {risk.rapid_escalation ? (
        <p role="status" className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200">
          <AlertTriangle className="h-4 w-4" /> Rapid risk escalation
        </p>
      ) : null}

      <p className="mt-4 min-h-10 text-sm leading-5 text-slate-400">{risk.explanation}</p>

      {simulated ? (
        <div className="mt-4 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-200">SIMULATED demo history</p>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${simulatedBand?.classes}`}>
              {simulatedBand?.label} · {simulated.trend}
            </span>
          </div>
          <p className="mt-2 text-sm text-fuchsia-100">
            Simulated score: <strong>{simulated.score}/100</strong>
            <span className="px-2 text-fuchsia-400">·</span>
            5-minute projection: <strong>{simulated.projected_score}/100</strong>
          </p>
          <p className="mt-1 text-xs text-fuchsia-100/70">{simulated.velocity > 0 ? '+' : ''}{simulated.velocity.toFixed(1)} points/min</p>
          {simulated.score > 70 && simulated.trend === 'increasing' ? (
            <p role="status" className="mt-2 flex items-center gap-2 text-sm font-medium text-orange-200">
              <AlertTriangle className="h-4 w-4" /> SIMULATED · Predictive warning
            </p>
          ) : null}
          {simulated.rapid_escalation ? (
            <p role="status" className="mt-2 flex items-center gap-2 text-sm font-medium text-red-200">
              <AlertTriangle className="h-4 w-4" /> SIMULATED · Rapid risk escalation
            </p>
          ) : null}
          <p className="mt-2 text-sm leading-5 text-fuchsia-100/80">{simulated.explanation}</p>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-300">Risk trend · last hour</p>
          {simulatedPath ? <span className="rounded bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-fuchsia-200">SIMULATED</span> : null}
        </div>
        <svg viewBox="0 0 320 100" role="img" aria-label={`Risk trend chart for ${risk.zone_name}`} className="h-28 w-full overflow-visible">
          {[10, 30, 50, 70, 90].map((y) => <line key={y} x1="10" x2="310" y1={y} y2={y} stroke="#334155" strokeWidth="0.6" />)}
          <path d={realPath} fill="none" stroke={band.stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {simulatedPath ? <path d={simulatedPath} fill="none" stroke="#e879f9" strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" /> : null}
          <path d={`M${currentX.toFixed(1)},${currentY.toFixed(1)} L${projectedX},${projectedY.toFixed(1)}`} fill="none" stroke={band.stroke} strokeWidth="2" strokeDasharray="5 4" />
          {simulated ? <path d={`M${currentX.toFixed(1)},${simulatedCurrentY.toFixed(1)} L${projectedX},${simulatedProjectedY.toFixed(1)}`} fill="none" stroke="#e879f9" strokeWidth="2" strokeDasharray="2 4" /> : null}
          <text x="10" y="99" fill="#64748b" fontSize="8">−60m</text>
          <text x="270" y="99" fill="#64748b" fontSize="8">now</text>
          <text x="294" y="99" fill="#64748b" fontSize="8">+5m</text>
        </svg>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-slate-300" /> Recorded</span>
          <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-slate-300" /> Projected</span>
          {simulatedPath ? <span className="flex items-center gap-1 text-fuchsia-200"><span className="w-3 border-t border-dashed border-fuchsia-300" /> SIMULATED</span> : null}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-slate-600">Updated {new Date(risk.updated_at).toLocaleString()}</p>
    </article>
  )
}

export function ZoneRiskPage() {
  const { riskScores, refreshRiskScores, refreshEvents } = useDashboardLiveData()
  const [zones, setZones] = useState<Zone[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [riskActionBusy, setRiskActionBusy] = useState(false)
  const [detectionResetBusy, setDetectionResetBusy] = useState(false)
  const [resetNotice, setResetNotice] = useState('')
  const [canClearDetection] = useState(canClearDetectionData)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingZone, setEditingZone] = useState<Zone | null>(null)
  const [form, setForm] = useState<ZoneFormState>(emptyForm)
  const [error, setError] = useState('')
  const [previewFrame, setPreviewFrame] = useState('')
  const [previewVideo, setPreviewVideo] = useState('')
  const [previewMessage, setPreviewMessage] = useState('')
  const [rectangleSet, setRectangleSet] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    return () => {
      if (previewFrame.startsWith('blob:')) URL.revokeObjectURL(previewFrame)
    }
  }, [previewFrame])

  useEffect(() => {
    return () => {
      if (previewVideo) URL.revokeObjectURL(previewVideo)
    }
  }, [previewVideo])

  useEffect(() => {
    Promise.all([
      apiRequest<Zone[]>('/api/zones'),
      apiRequest<Camera[]>('/api/cameras'),
    ])
      .then(([loadedZones, loadedCameras]) => {
        setZones(loadedZones)
        setCameras(loadedCameras)
      })
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
      .finally(() => setLoading(false))
  }, [])

  async function changeSimulatedHistory(action: 'seed' | 'clear') {
    setError('')
    setRiskActionBusy(true)
    try {
      await apiRequest(
        '/api/risk/simulated-history',
        { method: action === 'seed' ? 'POST' : 'DELETE' },
      )
      await refreshRiskScores()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setRiskActionBusy(false)
    }
  }

  async function clearAllDetectionData() {
    const confirmed = window.confirm(
      'Clear every real detection event, alert, evidence frame, and real risk-history point? Simulated history, cameras, zones, and users will remain.',
    )
    if (!confirmed) return

    setError('')
    setResetNotice('')
    setDetectionResetBusy(true)
    try {
      const result = await apiRequest<{
        events_deleted: number
        alerts_deleted: number
        evidence_deleted: number
        risk_history_deleted: number
      }>('/api/detection-data', { method: 'DELETE' })
      await Promise.all([refreshRiskScores(), refreshEvents()])
      setResetNotice(
        `Cleared ${result.events_deleted} events, ${result.alerts_deleted} alerts, ${result.evidence_deleted} evidence frames, and ${result.risk_history_deleted} real risk-history points.`,
      )
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setDetectionResetBusy(false)
    }
  }

  function openCreateForm() {
    setEditingZone(null)
    setForm(emptyForm)
    setRectangleSet(false)
    setPreviewFrame('')
    setPreviewVideo('')
    setPreviewMessage('')
    setError('')
    setFormOpen(true)
  }

  function openEditForm(zone: Zone) {
    setEditingZone(zone)
    setForm(formFromZone(zone))
    setRectangleSet(zone.shape_type === 'rectangle')
    setPreviewFrame('')
    setPreviewVideo('')
    setPreviewMessage('')
    setError('')
    setFormOpen(true)
  }

  async function loadCameraPreview() {
    if (!form.camera_id) {
      setError('Select a camera before loading its frame.')
      return
    }
    setError('')
    setPreviewMessage('')
    try {
      const frame = await apiBlob(`/api/cameras/${form.camera_id}/vision/frame`)
      setPreviewVideo('')
      setPreviewFrame(URL.createObjectURL(frame))
      setPreviewMessage('Camera frame loaded. Drag on the image to draw the zone rectangle.')
    } catch (loadError) {
      setError(`${getErrorMessage(loadError)} Start this camera in Live Monitoring first.`)
    }
  }

  function loadVideoPreview(file: File | undefined) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.mp4') || (file.type && file.type !== 'video/mp4')) {
      setError('Select an MP4 video file.')
      return
    }
    setError('')
    setPreviewMessage('Scrub the video to a useful frame, then choose “Use current video frame”.')
    setPreviewFrame('')
    setPreviewVideo(URL.createObjectURL(file))
  }

  function captureVideoFrame() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError('Wait for the uploaded video preview to load, then select a frame.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      setError('Unable to capture the selected video frame.')
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    setPreviewFrame(canvas.toDataURL('image/jpeg', 0.9))
    setPreviewMessage('Video frame captured. Drag on the image to draw the zone rectangle.')
    setError('')
  }

  function updateRectangle(rectangle: RectangleValue) {
    setForm((current) => ({
      ...current,
      x: String(rectangle.x),
      y: String(rectangle.y),
      width: String(rectangle.width),
      height: String(rectangle.height),
    }))
    setRectangleSet(true)
  }

  function buildPayload(): ZoneInput {
    let coordinates: ZoneInput['coordinates']
    if (form.shape_type === 'rectangle') {
      coordinates = {
        x: Number(form.x),
        y: Number(form.y),
        width: Number(form.width),
        height: Number(form.height),
      }
    } else {
      coordinates = form.points.split(';').map((pair) => {
        const [x, y] = pair.split(',').map((coordinate) => Number(coordinate.trim()))
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error('Enter polygon points as x,y pairs separated by semicolons.')
        }
        return { x, y }
      })
    }

    const payload = {
      name: form.name,
      camera_id: form.camera_id ? Number(form.camera_id) : null,
      zone_type: form.zone_type,
      shape_type: form.shape_type,
      coordinates,
      crowd_threshold: Number(form.crowd_threshold),
      confidence_threshold: Number(form.confidence_threshold),
    }
    if (Object.values(payload).some((value) => typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error('Thresholds and coordinates must be valid numbers.')
    }
    return payload
  }

  async function saveZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (form.shape_type === 'rectangle' && !rectangleSet) {
      setError('Draw the rectangle on a camera or video preview frame before saving.')
      return
    }
    setSaving(true)
    setError('')

    try {
      const zone = await apiRequest<Zone>(
        editingZone ? `/api/zones/${editingZone.id}` : '/api/zones',
        {
          method: editingZone ? 'PATCH' : 'POST',
          body: JSON.stringify(buildPayload()),
        },
      )
      setZones((existing) =>
        editingZone
          ? existing.map((item) => (item.id === zone.id ? zone : item))
          : [...existing, zone],
      )
      setFormOpen(false)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function removeZone(zone: Zone) {
    if (!window.confirm(`Delete zone "${zone.name}"?`)) {
      return
    }

    setError('')
    try {
      await apiRequest<void>(`/api/zones/${zone.id}`, { method: 'DELETE' })
      setZones((existing) => existing.filter((item) => item.id !== zone.id))
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-400">Zone Risk Intelligence</p>
            <h2 className="text-2xl font-semibold text-white">Calculated zone risk</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              An indicator calculated from deduplicated detection events with time decay. Projections are not validated predictions.
            </p>
          </div>
          {canClearDetection ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void changeSimulatedHistory('seed')}
                disabled={riskActionBusy || zones.length === 0}
                className="rounded-xl border border-fuchsia-500/40 px-3 py-2 text-sm text-fuchsia-200 hover:bg-fuchsia-500/10 disabled:opacity-50"
              >
                {riskActionBusy ? 'Working…' : 'Seed simulated history'}
              </button>
              <button
                type="button"
                onClick={() => void changeSimulatedHistory('clear')}
                disabled={riskActionBusy}
                className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Clear simulated history
              </button>
            </div>
          ) : null}
          {canClearDetection ? (
            <button
              type="button"
              onClick={() => void clearAllDetectionData()}
              disabled={detectionResetBusy}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/40 px-3 py-2 text-sm text-red-200 hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {detectionResetBusy ? 'Clearing…' : 'Clear detection events and risk history'}
            </button>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Weights, decay, and the rapid escalation threshold are configurable with RISK_WEIGHT_RESTRICTED_ENTRY, RISK_WEIGHT_HAZARD_PROXIMITY, RISK_WEIGHT_CROWDING, RISK_DECAY_HALF_LIFE_MINUTES, and RISK_RAPID_ESCALATION_VELOCITY.
        </p>
        {riskScores.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {riskScores.map((risk) => <ZoneRiskCard key={risk.zone_id} risk={risk} />)}
          </div>
        ) : !loading ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950 px-5 py-8 text-center text-sm text-slate-500">
            Configure a zone to calculate and chart its risk score.
          </div>
        ) : null}
      </section>

      {resetNotice ? <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{resetNotice}</div> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Zone configuration</p>
          <h2 className="text-2xl font-semibold text-white">Zones &amp; thresholds</h2>
          <p className="mt-1 text-sm text-slate-400">Coordinates are normalized to the camera frame (0 to 1).</p>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          Add zone
        </button>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {formOpen ? (
        <form onSubmit={saveZone} className="space-y-4 rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">{editingZone ? 'Edit zone' : 'Add zone'}</h3>
            <button type="button" onClick={() => setFormOpen(false)} aria-label="Close zone form" className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-300">
              Zone name
              <input className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={120} />
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              Camera
              <select className={inputClass} value={form.camera_id} onChange={(event) => setForm({ ...form, camera_id: event.target.value })}>
                <option value="">Not assigned</option>
                {cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name} — {camera.location}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              Zone type
              <select
                className={inputClass}
                value={form.zone_type}
                onChange={(event) => setForm({ ...form, zone_type: event.target.value as ZoneType })}
              >
                <option value="normal">Normal</option>
                <option value="restricted">Restricted</option>
                <option value="hazard_machinery">Hazard/Machinery</option>
              </select>
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              Shape
              <select className={inputClass} value={form.shape_type} onChange={(event) => setForm({ ...form, shape_type: event.target.value as Zone['shape_type'] })}>
                <option value="rectangle">Rectangle</option>
                <option value="polygon">Polygon</option>
              </select>
            </label>

            {form.shape_type === 'rectangle' ? (
              <div className="space-y-3 md:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">Draw rectangular zone</p>
                    <p className="text-xs text-slate-500">Select a live camera frame or capture a frame from an MP4.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadCameraPreview()}
                    disabled={!form.camera_id}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CameraIcon className="h-4 w-4" />
                    Load camera frame
                  </button>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800">
                  <Upload className="h-4 w-4" />
                  Preview an MP4
                  <input
                    type="file"
                    accept="video/mp4,.mp4"
                    className="sr-only"
                    onChange={(event) => {
                      loadVideoPreview(event.currentTarget.files?.[0])
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
                {previewVideo ? (
                  <div className="space-y-2">
                    <video ref={videoRef} src={previewVideo} controls className="max-h-80 w-full rounded-xl bg-black" />
                    <button
                      type="button"
                      onClick={captureVideoFrame}
                      className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500"
                    >
                      Use current video frame
                    </button>
                  </div>
                ) : null}
                {previewFrame ? (
                  <div className="space-y-2">
                    <RectangleDrawingCanvas
                      imageSource={previewFrame}
                      rectangle={{
                        x: Number(form.x),
                        y: Number(form.y),
                        width: Number(form.width),
                        height: Number(form.height),
                      }}
                      onDraw={updateRectangle}
                    />
                    <p className="text-xs text-slate-500">Click and drag on the preview to position and size the rectangle.</p>
                  </div>
                ) : null}
                {previewMessage ? <p role="status" className="text-xs text-emerald-300">{previewMessage}</p> : null}
                {rectangleSet ? (
                  <p className="text-xs text-slate-400">
                    Normalized bounds: x {Number(form.x).toFixed(3)}, y {Number(form.y).toFixed(3)}, width {Number(form.width).toFixed(3)}, height {Number(form.height).toFixed(3)}
                  </p>
                ) : (
                  <p className="text-xs text-amber-300">Draw a rectangle before creating this zone.</p>
                )}
              </div>
            ) : (
              <label className="space-y-1 text-sm text-slate-300 md:col-span-2">
                Polygon points
                <textarea className={inputClass} rows={3} value={form.points} onChange={(event) => setForm({ ...form, points: event.target.value })} required aria-describedby="polygon-help" />
                <span id="polygon-help" className="block text-xs text-slate-500">Use x,y pairs separated by semicolons, for example: 0.1,0.1; 0.9,0.1; 0.8,0.8</span>
              </label>
            )}

            <label className="space-y-1 text-sm text-slate-300">
              Crowd threshold (people)
              <input className={inputClass} type="number" min="1" max="100000" step="1" value={form.crowd_threshold} onChange={(event) => setForm({ ...form, crowd_threshold: event.target.value })} required />
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              Confidence threshold (0–1)
              <input className={inputClass} type="number" min="0" max="1" step="0.01" value={form.confidence_threshold} onChange={(event) => setForm({ ...form, confidence_threshold: event.target.value })} required />
            </label>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
            <button type="submit" disabled={saving || (form.shape_type === 'rectangle' && !rectangleSet)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60">
              {saving ? 'Saving...' : 'Save zone'}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? <p className="text-sm text-slate-400">Loading zones...</p> : null}
      {!loading && zones.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">No zones configured yet. Add one to define monitoring thresholds.</div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {zones.map((zone) => {
          const camera = cameras.find((item) => item.id === zone.camera_id)
          return (
            <article key={zone.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">{zone.name}</h3>
                  <p className="mt-1 text-sm text-slate-400">{camera ? `${camera.name} — ${camera.location}` : 'No camera assigned'}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full bg-blue-500/15 px-2 py-1 text-[10px] font-medium text-blue-300">
                    {zone.zone_type === 'hazard_machinery' ? 'Hazard/Machinery' : zone.zone_type === 'restricted' ? 'Restricted' : 'Normal'}
                  </span>
                  <span className="text-[10px] capitalize text-slate-500">{zone.shape_type}</span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-900 p-3">
                  <p className="text-xs text-slate-500">Crowd threshold</p>
                  <p className="mt-1 font-medium text-white">{zone.crowd_threshold} people</p>
                </div>
                <div className="rounded-xl bg-slate-900 p-3">
                  <p className="text-xs text-slate-500">Confidence floor</p>
                  <p className="mt-1 font-medium text-white">{Math.round(zone.confidence_threshold * 100)}%</p>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" aria-label={`Edit ${zone.name}`} onClick={() => openEditForm(zone)} className="rounded-lg border border-slate-700 p-2 text-slate-200 hover:bg-slate-800">
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" aria-label={`Delete ${zone.name}`} onClick={() => void removeZone(zone)} className="rounded-lg border border-slate-700 p-2 text-red-300 hover:bg-slate-800">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
