import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-soft">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">404</p>
        <h1 className="mt-3 text-4xl font-bold text-white">Page not found</h1>
        <p className="mt-3 text-slate-400">The route you requested does not exist in this demo.</p>
        <Link to="/" className="mt-6 inline-block rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500">Return home</Link>
      </div>
    </div>
  )
}
