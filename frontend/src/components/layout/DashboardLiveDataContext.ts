import { createContext, useContext } from 'react'

import type { Camera, CameraVisionStatus, DetectionEvent, RiskPeriod, SafetyAlert, ZoneRisk } from '../../lib/api'

export interface DashboardLiveDataValue {
  cameras: Camera[]
  cameraStatuses: Record<number, CameraVisionStatus>
  frames: Record<number, string>
  events: DetectionEvent[]
  alerts: SafetyAlert[]
  newAlertCount: number
  riskScores: ZoneRisk[]
  riskPeriod: RiskPeriod
  transferProgress: Record<number, number>
  error: string
  refreshCameraStatuses: () => Promise<void>
  refreshEvents: () => Promise<void>
  refreshAlerts: () => Promise<void>
  refreshRiskScores: () => Promise<void>
  setRiskPeriod: (period: RiskPeriod) => void
  updateCameraStatus: (cameraId: number, status: CameraVisionStatus) => void
  updateTransferProgress: (cameraId: number, progress: number | null) => void
}

export const DashboardLiveDataContext = createContext<DashboardLiveDataValue | null>(null)

export function useDashboardLiveData() {
  const context = useContext(DashboardLiveDataContext)
  if (context === null) {
    throw new Error('useDashboardLiveData must be used within DashboardLiveDataProvider.')
  }
  return context
}
