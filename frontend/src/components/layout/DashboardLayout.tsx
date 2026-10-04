import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { DashboardLiveDataProvider } from './DashboardLiveData'
import { useDashboardLiveData } from './DashboardLiveDataContext'
import {
  AlertTriangle,
  Camera,
  FileText,
  Gauge,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  TrendingUp,
  Video,
} from 'lucide-react'

const navItems = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/dashboard/live-monitoring', label: 'Live Monitoring', icon: Video },
  { to: '/dashboard/safety-alerts', label: 'Safety Alerts', icon: AlertTriangle },
  { to: '/dashboard/zone-risk', label: 'Zone Risk & Thresholds', icon: Gauge },
  { to: '/dashboard/incidents', label: 'Incident History', icon: TrendingUp },
  { to: '/dashboard/reports', label: 'Reports', icon: FileText },
  { to: '/dashboard/cameras', label: 'Camera Management', icon: Camera },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
]

function getUserSession() {
  const raw = window.localStorage.getItem('safety_user')
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function DashboardContent() {
  const navigate = useNavigate()
  const user = getUserSession()
  const { newAlertCount } = useDashboardLiveData()

  async function handleLogout() {
    const token = window.localStorage.getItem('safety_auth_token')

    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => undefined)
    }

    window.localStorage.removeItem('safety_auth_token')
    window.localStorage.removeItem('safety_user')
    navigate('/login', { replace: true })
  }

  const roleLabel = user?.role === 'administrator' ? 'Administrator' : 'Safety Officer'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 lg:px-6">
        <aside className="hidden w-72 shrink-0 rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-soft lg:block">
          <div className="mb-8 flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-blue-300">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Safety</p>
              <p className="text-lg font-semibold text-white">Copilot</p>
            </div>
          </div>

          <nav className="space-y-2">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/dashboard'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
                {to === '/dashboard/safety-alerts' && newAlertCount > 0 ? (
                  <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {newAlertCount > 99 ? '99+' : newAlertCount}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>

          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Session</p>
            <p className="font-medium text-white">{roleLabel}</p>
            <p className="text-sm text-slate-400">{user?.email || 'No session'}</p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-6 flex w-full items-center gap-3 rounded-xl border border-slate-800 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </aside>

        <div className="flex-1 rounded-3xl border border-slate-800 bg-slate-900 shadow-soft">
          <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4 lg:px-6">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Operations</p>
              <h1 className="mt-1 text-xl font-semibold text-white">Industrial safety command center</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                System online
              </div>
            </div>
          </header>

          <div className="p-4 lg:p-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

export function DashboardLayout() {
  return (
    <DashboardLiveDataProvider>
      <DashboardContent />
    </DashboardLiveDataProvider>
  )
}
