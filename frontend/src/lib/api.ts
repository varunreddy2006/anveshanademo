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
  zone_type: ZoneType
  crowd_threshold: number
  confidence_threshold: number
}

export type ZoneType = 'normal' | 'restricted' | 'hazard_machinery'

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
  zone_type: ZoneType
  shape_type: Zone['shape_type']
  coordinates: Zone['coordinates']
  crowd_threshold: number
  confidence_threshold: number
}

export interface RiskHistoryPoint {
  score: number
  trend: 'increasing' | 'stable' | 'decreasing'
  velocity: number
  projected_score: number
  explanation: string
  is_simulated: boolean
  recorded_at: string
}

export interface ZoneRisk {
  zone_id: number
  zone_name: string
  zone_type: ZoneType
  score: number
  trend: 'increasing' | 'stable' | 'decreasing'
  velocity: number
  rapid_escalation: boolean
  projected_score: number
  explanation: string
  updated_at: string
  history: RiskHistoryPoint[]
}

export interface CameraVisionStatus {
  key?: string
  camera_id: number
  source_type?: string
  status: 'Connected' | 'Not connected' | 'Error'
  error?: string | null
  progress?: number
  processed_frames?: number
  total_frames?: number | null
  completed?: boolean
}

export interface DetectionEvent {
  id: number
  camera_id: number | null
  camera_name: string
  event_type: string
  zone_name: string
  detail: string
  frame_index: number
  evidence_url: string
  created_at: string
}

export interface SafetyAlert extends DetectionEvent {
  alert_id: number
  status: string
  severity: 'High' | 'Medium'
}

export interface Incident extends DetectionEvent {
  alert_id: number | null
  alert_status: string | null
  alert_created_at: string | null
}

export interface IncidentPage {
  items: Incident[]
  page: number
  page_size: number
  total: number
  pages: number
}

export interface ReportCount {
  name: string
  count: number
}

export interface ReportSummary {
  start: string
  end: string
  total_incidents: number
  by_type: ReportCount[]
  by_zone: ReportCount[]
  zone_risks: Array<{
    zone_id: number
    zone_name: string
    score: number
    trend: 'increasing' | 'stable' | 'decreasing'
    velocity: number
    projected_score: number
    updated_at: string
  }>
  includes_simulated: boolean
}

export function formatLocalTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString()
}

export interface VisionModels {
  ppe: string
  fire_smoke: string
}

export interface UploadJob extends CameraVisionStatus {
  job_id?: string
}

export async function apiBlob(path: string): Promise<Blob> {
  const token = window.localStorage.getItem('safety_auth_token')
  const headers = new Headers()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(path, { headers, cache: 'no-store' })
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'No processed frame is available yet.' : 'Unable to load the processed frame.')
  }
  return response.blob()
}

export function uploadVideo(
  cameraId: number,
  file: File,
  onProgress: (progress: number) => void,
): Promise<UploadJob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `/api/cameras/${cameraId}/uploads`)
    const token = window.localStorage.getItem('safety_auth_token')
    if (token) {
      request.setRequestHeader('Authorization', `Bearer ${token}`)
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    request.onerror = () => reject(new Error('Unable to upload the MP4. Check the server connection and try again.'))
    request.onload = () => {
      let data: unknown
      try {
        data = JSON.parse(request.responseText)
      } catch {
        reject(new Error('The server returned an invalid upload response.'))
        return
      }
      if (request.status < 200 || request.status >= 300) {
        const detail =
          typeof data === 'object' && data !== null && 'detail' in data && typeof data.detail === 'string'
            ? data.detail
            : 'The MP4 upload failed.'
        reject(new Error(detail))
        return
      }
      resolve(data as UploadJob)
    }
    const body = new FormData()
    body.append('file', file)
    request.send(body)
  })
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
