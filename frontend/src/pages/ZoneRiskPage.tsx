import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'

import { apiRequest, type Camera, type Zone, type ZoneInput } from '../lib/api'

type ZoneFormState = {
  name: string
  camera_id: string
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to complete the zone request.'
}

function formFromZone(zone: Zone): ZoneFormState {
  if (zone.shape_type === 'rectangle') {
    return {
      ...emptyForm,
      name: zone.name,
      camera_id: zone.camera_id === null ? '' : String(zone.camera_id),
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
    setError('')
    setFormOpen(true)
  }

  function openEditForm(zone: Zone) {
    setEditingZone(zone)
    setForm(formFromZone(zone))
    setError('')
    setFormOpen(true)
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
              Shape
              <select className={inputClass} value={form.shape_type} onChange={(event) => setForm({ ...form, shape_type: event.target.value as Zone['shape_type'] })}>
                <option value="rectangle">Rectangle</option>
                <option value="polygon">Polygon</option>
              </select>
            </label>

            {form.shape_type === 'rectangle' ? (
              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                {([
                  ['x', 'Left (x)'],
                  ['y', 'Top (y)'],
                  ['width', 'Width'],
                  ['height', 'Height'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="space-y-1 text-sm text-slate-300">
                    {label}
                    <input
                      className={inputClass}
                      type="number"
                      min={key === 'width' || key === 'height' ? 0.01 : 0}
                      max={1}
                      step="0.01"
                      value={form[key]}
                      onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                      required
                    />
                  </label>
                ))}
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
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60">
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
                <span className="rounded-full bg-blue-500/15 px-2 py-1 text-[10px] font-medium capitalize text-blue-300">{zone.shape_type}</span>
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
