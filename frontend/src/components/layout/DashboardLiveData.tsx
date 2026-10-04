import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import {
  apiBlob,
  apiRequest,
  type Camera,
  type CameraVisionStatus,
  type DetectionEvent,
  type RiskPeriod,
  type SafetyAlert,
} from '../../lib/api'
import { DashboardLiveDataContext } from './DashboardLiveDataContext'
import type { ZoneRisk } from '../../lib/api'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to refresh dashboard monitoring data.'
}

export function DashboardLiveDataProvider({ children }: { children: ReactNode }) {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [cameraStatuses, setCameraStatuses] = useState<Record<number, CameraVisionStatus>>({})
  const [frames, setFrames] = useState<Record<number, string>>({})
  const [events, setEvents] = useState<DetectionEvent[]>([])
  const [alerts, setAlerts] = useState<SafetyAlert[]>([])
  const [riskScores, setRiskScores] = useState<ZoneRisk[]>([])
  const [riskPeriod, setRiskPeriod] = useState<RiskPeriod>('hour')
  const [transferProgress, setTransferProgress] = useState<Record<number, number>>({})
  const [error, setError] = useState('')
  const frameUrls = useRef<Record<number, string>>({})
  const frameSignatures = useRef<Record<number, string>>({})

  const refreshCameraStatuses = useCallback(async (cameraList: Camera[] = cameras) => {
    const results = await Promise.all(
      cameraList.map(async (camera) => {
        try {
          return await apiRequest<CameraVisionStatus>(`/api/cameras/${camera.id}/vision/status`)
        } catch (statusError) {
          return {
            camera_id: camera.id,
            status: 'Error' as const,
            error: errorMessage(statusError),
            running: false,
            has_frame: false,
          }
        }
      }),
    )
    setCameraStatuses((current) => ({
      ...current,
      ...Object.fromEntries(results.map((status) => [status.camera_id, status])),
    }))

    await Promise.all(
      results.map(async (status) => {
        if (!status.has_frame) return
        const signature = `${status.key ?? ''}:${status.source_type ?? ''}:${status.processed_frames ?? 0}`
        if (frameSignatures.current[status.camera_id] === signature) return
        try {
          const blob = await apiBlob(`/api/cameras/${status.camera_id}/vision/frame`)
          const url = URL.createObjectURL(blob)
          const previous = frameUrls.current[status.camera_id]
          if (previous) URL.revokeObjectURL(previous)
          frameUrls.current[status.camera_id] = url
          frameSignatures.current[status.camera_id] = signature
          setFrames((current) => ({ ...current, [status.camera_id]: url }))
        } catch (frameError) {
          setError(errorMessage(frameError))
        }
      }),
    )
  }, [cameras])

  const refreshEvents = useCallback(async () => {
    try {
      setEvents(await apiRequest<DetectionEvent[]>('/api/events'))
    } catch (refreshError) {
      setError(errorMessage(refreshError))
    }
  }, [])

  const refreshAlerts = useCallback(async () => {
    try {
      setAlerts(await apiRequest<SafetyAlert[]>('/api/alerts'))
    } catch (refreshError) {
      setError(errorMessage(refreshError))
    }
  }, [])

  const refreshRiskScores = useCallback(async () => {
    try {
      setRiskScores(await apiRequest<ZoneRisk[]>(`/api/risk/zones?period=${riskPeriod}`))
    } catch (refreshError) {
      setError(errorMessage(refreshError))
    }
  }, [riskPeriod])

  const updateCameraStatus = useCallback((cameraId: number, status: CameraVisionStatus) => {
    setCameraStatuses((current) => ({ ...current, [cameraId]: status }))
  }, [])

  const updateTransferProgress = useCallback((cameraId: number, progress: number | null) => {
    setTransferProgress((current) => {
      if (progress === null) {
        const updated = { ...current }
        delete updated[cameraId]
        return updated
      }
      return { ...current, [cameraId]: progress }
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    async function refreshSharedData() {
      try {
        const [cameraData, eventData, riskData, alertData] = await Promise.all([
          apiRequest<Camera[]>('/api/cameras'),
          apiRequest<DetectionEvent[]>('/api/events'),
          apiRequest<ZoneRisk[]>(`/api/risk/zones?period=${riskPeriod}`),
          apiRequest<SafetyAlert[]>('/api/alerts'),
        ])
        if (cancelled) return
        setCameras((current) => {
          const unchanged =
            current.length === cameraData.length &&
            current.every((camera, index) => {
              const refreshed = cameraData[index]
              return (
                camera.id === refreshed.id &&
                camera.name === refreshed.name &&
                camera.location === refreshed.location &&
                camera.stream_url === refreshed.stream_url
              )
            })
          return unchanged ? current : cameraData
        })
        setEvents(eventData)
        setAlerts(alertData)
        setRiskScores(riskData)
        void refreshCameraStatuses(cameraData)
      } catch (refreshError) {
        if (!cancelled) setError(errorMessage(refreshError))
      }
    }
    void refreshSharedData()
    const sharedInterval = window.setInterval(() => {
      void refreshSharedData()
    }, 5000)
    const statusInterval = window.setInterval(() => {
      void refreshCameraStatuses()
    }, 1500)
    return () => {
      cancelled = true
      window.clearInterval(sharedInterval)
      window.clearInterval(statusInterval)
    }
  }, [refreshCameraStatuses, riskPeriod])

  useEffect(
    () => () => {
      Object.values(frameUrls.current).forEach(URL.revokeObjectURL)
    },
    [],
  )

  return (
    <DashboardLiveDataContext.Provider
      value={{
        cameras,
        cameraStatuses,
        frames,
        events,
        alerts,
        newAlertCount: alerts.filter((alert) => alert.status === 'New').length,
        riskScores,
        riskPeriod,
        transferProgress,
        error,
        refreshCameraStatuses: () => refreshCameraStatuses(),
        refreshEvents,
        refreshAlerts,
        refreshRiskScores,
        setRiskPeriod,
        updateCameraStatus,
        updateTransferProgress,
      }}
    >
      {children}
    </DashboardLiveDataContext.Provider>
  )
}
