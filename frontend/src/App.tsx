import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { DashboardLayout } from './components/layout/DashboardLayout'
import { LoginPage, RegisterPage } from './pages/AuthPage'
import { DashboardOverviewPage } from './pages/DashboardOverviewPage'
import { IncidentHistoryPage } from './pages/IncidentHistoryPage'
import { LandingPage } from './pages/LandingPage'
import { LiveMonitoringPage } from './pages/MonitoringPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ReportsPage } from './pages/ReportsPage'
import { SafetyAlertsPage } from './pages/SafetyAlertsPage'
import { CameraManagementPage } from './pages/CameraManagementPage'
import { SettingsPage } from './pages/SettingsPage'
import { ZoneRiskPage } from './pages/ZoneRiskPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardOverviewPage />} />
          <Route path="live-monitoring" element={<LiveMonitoringPage />} />
          <Route path="safety-alerts" element={<SafetyAlertsPage />} />
          <Route path="zone-risk" element={<ZoneRiskPage />} />
          <Route path="incidents" element={<IncidentHistoryPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="cameras" element={<CameraManagementPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
