import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'

import { DashboardLayout } from './components/layout/DashboardLayout'
import { LoginPage, RegisterPage } from './pages/AuthPage'
import { DashboardOverviewPage } from './pages/DashboardOverviewPage'
import { IncidentHistoryPage } from './pages/IncidentHistoryPage'
import { LandingPage } from './pages/LandingPage'
import { LiveMonitoringPage } from './pages/MonitoringPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SafetyAlertsPage } from './pages/SafetyAlertsPage'
import { CameraManagementPage } from './pages/CameraManagementPage'
import { SettingsPage } from './pages/SettingsPage'
import { ZoneRiskPage } from './pages/ZoneRiskPage'

const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))

function isAuthenticated() {
  return typeof window !== 'undefined' && Boolean(window.localStorage.getItem('safety_auth_token'))
}

function ProtectedRoute() {
  return isAuthenticated() ? <Outlet /> : <Navigate to="/login" replace />
}

function GuestRoute() {
  return isAuthenticated() ? <Navigate to="/dashboard" replace /> : <Outlet />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        <Route element={<GuestRoute />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<DashboardOverviewPage />} />
            <Route path="live-monitoring" element={<LiveMonitoringPage />} />
            <Route path="safety-alerts" element={<SafetyAlertsPage />} />
            <Route path="zone-risk" element={<ZoneRiskPage />} />
            <Route path="incidents" element={<IncidentHistoryPage />} />
            <Route path="reports" element={<Suspense fallback={<p className="p-6 text-sm text-slate-400">Loading reports…</p>}><ReportsPage /></Suspense>} />
            <Route path="cameras" element={<CameraManagementPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
