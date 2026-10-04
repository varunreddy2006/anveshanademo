export interface Camera {
  id: number
  name: string
  location: string
  stream_url: string | null
  status: 'connected' | 'processing' | 'disconnected'
}

export interface CameraInput {
  name: string
  location: string
  stream_url?: string | null
  status?: Camera['status']
  username?: string
  password?: string
}

interface ZoneBase {
  id: number
  name: string
  camera_id: number | null
  crowd_threshold: number
  confidence_threshold: number
}

export type Zone = ZoneBase &
  (
    | { shape_type: 'rectangle'; coordinates: RectangleCoordinates }
    | { shape_type: 'polygon'; coordinates: PolygonCoordinates }
  )

export interface RectangleCoordinates {
  x: number
  y: number
  width: number
  height: number
}

export interface PolygonPoint {
  x: number
  y: number
}

export type PolygonCoordinates = PolygonPoint[]

export interface ZoneInput {
  name: string
  camera_id: number | null
  shape_type: Zone['shape_type']
  coordinates: Zone['coordinates']
  crowd_threshold: number
  confidence_threshold: number
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = window.localStorage.getItem('safety_auth_token')
  const headers = new Headers(init.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(path, { ...init, headers })
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    const detail =
      typeof data === 'object' && data !== null && 'detail' in data
        ? data.detail
        : null
    const message = typeof detail === 'string' ? detail : 'The request failed. Please review the submitted values and try again.'
    throw new Error(message)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return response.json() as Promise<T>
}
