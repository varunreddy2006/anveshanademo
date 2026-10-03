import { ArrowRight, AlertTriangle, Gauge, Network, ShieldCheck, Video } from 'lucide-react'
import { Link } from 'react-router-dom'

const features = [
  { icon: ShieldCheck, title: 'PPE detection', description: 'Helmet, vest, and compliance detection for active work zones.' },
  { icon: Gauge, title: 'Restricted zones', description: 'Identify unauthorised entry into high-risk or monitored areas.' },
  { icon: AlertTriangle, title: 'Fire and smoke', description: 'Monitor environmental risk indicators and escalate urgent alerts.' },
  { icon: Video, title: 'Camera health', description: 'Track surveillance uptime and detection processing across the plant.' },
]

export function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-blue-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-blue-200">AI Safety</p>
              <p className="text-lg font-bold text-white">Industrial Safety Copilot</p>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#workflow" className="hover:text-white">Workflow</a>
            <a href="#contact" className="hover:text-white">Contact</a>
          </nav>

          <div className="flex gap-3">
            <Link to="/login" className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800">Log in</Link>
            <Link to="/dashboard" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">Open dashboard</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <section className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-200">
              <Network className="h-3.5 w-3.5" />
              AI-powered monitoring overview
            </div>

            <h1 className="max-w-xl text-4xl font-black tracking-tight text-white md:text-6xl">
              Smarter Industrial Safety. Faster Risk Detection.
            </h1>

            <p className="mt-6 max-w-xl text-lg text-slate-300">
              Monitor factory zones, flag unsafe conditions, and support safety officers with actionable evidence from CCTV and uploaded video analysis.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-500">
                Open Safety Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#features" className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800">Explore Features</a>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-soft">
            <div className="rounded-2xl border border-slate-700 bg-slate-950 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">System status</p>
                  <p className="text-xl font-semibold text-white">Demo environment</p>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">Online</span>
              </div>

              <div className="space-y-3 text-sm text-slate-300">
                <div className="flex items-center justify-between rounded-xl bg-slate-900 p-3">
                  <span>Cameras</span>
                  <span>12 live</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-900 p-3">
                  <span>Alerts</span>
                  <span>3 active</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-900 p-3">
                  <span>Model</span>
                  <span>Demo mode</span>
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-slate-400">Online cameras</p>
                <p className="mt-2 text-3xl font-bold text-white">12</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-slate-400">PPE compliance</p>
                <p className="mt-2 text-3xl font-bold text-white">91%</p>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="mt-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-300">Features</p>
          <h2 className="mt-2 text-3xl font-bold text-white">Safety intelligence for every zone</h2>

          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {features.map(({ icon: Icon, title, description }) => (
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

      <footer id="contact" className="border-t border-slate-800 bg-slate-950">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
          <div>© 2026 AI Industrial Safety Copilot</div>
          <div className="flex gap-6">
            <span>About</span>
            <span>Features</span>
            <span>Privacy</span>
            <span>Contact</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
