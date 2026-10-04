import { Camera as CameraIcon, Pencil, Plus, Trash2, X } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'

import { apiRequest, type Camera, type CameraInput } from '../lib/api'

type CameraFormState = {
  name: string
  location: string
  stream_url: string
  status: Camera['status']
  username: string
  password: string
}

const emptyForm: CameraFormState = {
  name: '',
  location: '',
  stream_url: '',
  status: 'disconnected',
  username: '',
  password: '',
}

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-500'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to complete the camera request.'
}

export function CameraManagementPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingCamera, setEditingCamera] = useState<Camera | null>(null)
  const [form, setForm] = useState<CameraFormState>(emptyForm)
  const [error, setError] = useState('')

  useEffect(() => {
    apiRequest<Camera[]>('/api/cameras')
      .then(setCameras)
      .catch((loadError: unknown) => setError(getErrorMessage(loadError)))
      .finally(() => setLoading(false))
  }, [])

  function openCreateForm() {
    setEditingCamera(null)
    setForm(emptyForm)
    setError('')
    setFormOpen(true)
  }

  function openEditForm(camera: Camera) {
    setEditingCamera(camera)
    setForm({
      name: camera.name,
      location: camera.location,
      stream_url: camera.stream_url ?? '',
      status: camera.status,
      username: '',
      password: '',
    })
    setError('')
    setFormOpen(true)
  }

  async function saveCamera(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')

    const payload: CameraInput = {
      name: form.name,
      location: form.location,
      stream_url: form.stream_url || null,
      status: form.status,
      ...(form.username ? { username: form.username } : {}),
      ...(form.password ? { password: form.password } : {}),
    }

    try {
      const camera = await apiRequest<Camera>(
        editingCamera ? `/api/cameras/${editingCamera.id}` : '/api/cameras',
        {
          method: editingCamera ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      )
      setCameras((existing) =>
        editingCamera
          ? existing.map((item) => (item.id === camera.id ? camera : item))
          : [...existing, camera],
      )
      setFormOpen(false)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function removeCamera(camera: Camera) {
    if (!window.confirm(`Delete camera "${camera.name}"? Zones assigned to it will become unassigned.`)) {
      return
    }

    setError('')
    try {
      await apiRequest<void>(`/api/cameras/${camera.id}`, { method: 'DELETE' })
      setCameras((existing) => existing.filter((item) => item.id !== camera.id))
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Camera management</p>
          <h2 className="text-2xl font-semibold text-white">Connected devices</h2>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          Add camera
        </button>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {formOpen ? (
        <form onSubmit={saveCamera} className="space-y-4 rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">{editingCamera ? 'Edit camera' : 'Add camera'}</h3>
            <button type="button" onClick={() => setFormOpen(false)} aria-label="Close camera form" className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-300">
              Camera name
              <input className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={120} />
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              Location
              <input className={inputClass} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} required maxLength={160} />
            </label>
            <label className="space-y-1 text-sm text-slate-300 md:col-span-2">
              Stream URL
              <input className={inputClass} value={form.stream_url} onChange={(event) => setForm({ ...form, stream_url: event.target.value })} placeholder="rtsp://camera-address/stream" />
              <span className="block text-xs text-slate-500">Do not include a username or password in the URL.</span>
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              Status
              <select className={inputClass} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Camera['status'] })}>
                <option value="connected">Connected</option>
                <option value="processing">Processing</option>
                <option value="disconnected">Disconnected</option>
              </select>
            </label>
            <div className="space-y-3 md:col-span-2">
              <p className="text-sm text-slate-300">Camera credentials <span className="text-xs text-slate-500">(optional, never returned by the API)</span></p>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm text-slate-300">
                  Username
                  <input className={inputClass} autoComplete="off" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder={editingCamera ? 'Leave blank to keep existing' : 'Optional'} />
                </label>
                <label className="space-y-1 text-sm text-slate-300">
                  Password
                  <input className={inputClass} type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editingCamera ? 'Leave blank to keep existing' : 'Optional'} />
                </label>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60">
              {saving ? 'Saving...' : 'Save camera'}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? <p className="text-sm text-slate-400">Loading cameras...</p> : null}
      {!loading && cameras.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">No cameras yet. Add a camera to get started.</div>
      ) : null}
      <div className="space-y-4">
        {cameras.map((camera) => (
          <div key={camera.id} className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300">
                <CameraIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-white">{camera.name}</p>
                <p className="text-sm text-slate-400">{camera.location}</p>
                <p className="max-w-lg truncate text-xs text-slate-500">{camera.stream_url || 'Stream URL not configured'}</p>
                <p className="text-xs text-slate-500">CAM-{String(camera.id).padStart(3, '0')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${camera.status === 'connected' ? 'bg-emerald-500/15 text-emerald-300' : camera.status === 'processing' ? 'bg-blue-500/15 text-blue-300' : 'bg-red-500/15 text-red-300'}`}>
                {camera.status}
              </span>
              <button type="button" aria-label={`Edit ${camera.name}`} onClick={() => openEditForm(camera)} className="rounded-lg border border-slate-700 p-2 text-slate-200 hover:bg-slate-800">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" aria-label={`Delete ${camera.name}`} onClick={() => void removeCamera(camera)} className="rounded-lg border border-slate-700 p-2 text-red-300 hover:bg-slate-800">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
