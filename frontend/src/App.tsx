import { useEffect, useState } from 'react'
import { AlertTriangle, Gauge, Network, ShieldCheck, Video } from 'lucide-react'

import { Button } from './components/ui/button'

type HealthStatus = {
  status: string
  service: string
}

const featureCards = [
  { icon: ShieldCheck, title: 'PPE Monitoring', description: 'Detect missing helmets, gloves, and vest compliance.' },
  { icon: Gauge, title: 'Restricted Zones', description: 'Flag unauthorised access to hazardous areas.' },
  { icon: AlertTriangle, title: 'Fire & Smoke', description: 'Monitor high-risk environmental cues and alert teams.' },
  { icon: Video, title: 'Camera Coverage', description: 'Track live camera health and processing pipeline status.' },
]

function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => setHealth(payload))
      .catch(() => setHealth({ status: 'unreachable', service: 'backend' }))
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-blue-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-200">AI Safety</p>
              <p className="text-lg font-bold text-white">Industrial Safety Copilot</p>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#workflow" className="hover:text-white">Workflow</a>
            <a href="#status" className="hover:text-white">System status</a>
          </nav>

          <Button variant="default" size="sm">Open Safety Dashboard</Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <section className="grid gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-200">
              <Network className="h-3.5 w-3.5" />
              AI-powered monitoring overview
            </div>

            <h1 className="max-w-xl text-4xl font-black tracking-tight text-white md:text-6xl">
              Smarter Industrial Safety. Faster Risk Detection.
            </h1>

            <p className="mt-6 max-w-xl text-lg text-slate-300">
              Monitor live camera feeds, detect unsafe conditions, and route alerts to safety officers with a decision-support platform built for modern industrial environments.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Button size="lg">Open Safety Dashboard</Button>
              <Button variant="secondary" size="lg">Explore Features</Button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-soft">
            <div className="mb-6 rounded-2xl border border-slate-700 bg-slate-950 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">API connection</p>
                  <p className="text-xl font-semibold text-white">Backend health</p>
                </div>
                <div className={`rounded-full px-2.5 py-1 text-xs font-semibold ${health?.status === 'ok' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                  {loading ? 'Checking...' : health?.status ?? 'Unavailable'}
                </div>
              </div>

              <div className="space-y-3 text-sm text-slate-300">
                <div className="flex items-center justify-between rounded-xl bg-slate-900 p-3">
                  <span>Service</span>
                  <span>{health?.service ?? 'pending'}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-900 p-3">
                  <span>Mode</span>
                  <span>Demo-ready</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-900 p-3">
                  <span>Detection model</span>
                  <span>Not configured</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-slate-400">Online cameras</p>
                <p className="mt-2 text-3xl font-bold text-white">12</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-slate-400">Active alerts</p>
                <p className="mt-2 text-3xl font-bold text-white">03</p>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="mt-20">
          <div className="mb-8 flex items-end justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-300">Features</p>
              <h2 className="mt-2 text-3xl font-bold text-white">Safety intelligence for every zone</h2>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {featureCards.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-soft">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="workflow" className="mt-20 rounded-3xl border border-slate-800 bg-slate-900 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-300">Workflow</p>
          <h2 className="mt-2 text-3xl font-bold text-white">Camera input → AI analysis → response</h2>

          <div className="mt-8 grid gap-5 md:grid-cols-4">
            {['Camera input', 'AI analysis', 'Alert generation', 'Safety response'].map((item, index) => (
              <div key={item} className="rounded-2xl border border-slate-700 bg-slate-950 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Step {index + 1}</p>
                <p className="mt-3 text-lg font-semibold text-white">{item}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
