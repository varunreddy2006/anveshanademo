import { Camera as CameraIcon, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { type FormEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'

import { apiBlob, apiRequest, type Camera, type Zone, type ZoneInput, type ZoneType } from '../lib/api'

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

export function ZoneRiskPage() {
  const [zones, setZones] = useState<Zone[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
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
    Promise.all([apiRequest<Zone[]>('/api/zones'), apiRequest<Camera[]>('/api/cameras')])
      .then(([loadedZones, loadedCameras]) => {
        setZones(loadedZones)
        setCameras(loadedCameras)
      })
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
      .finally(() => setLoading(false))
  }, [])

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
