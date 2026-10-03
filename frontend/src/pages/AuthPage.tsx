import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

export function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-soft">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/20 text-blue-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Secure access</p>
            <p className="text-xl font-semibold text-white">Sign in</p>
          </div>
        </div>

        <form className="space-y-5">
          <div>
            <label className="mb-2 block text-sm text-slate-300">Work email</label>
            <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none ring-0 placeholder:text-slate-500 focus:border-blue-500" placeholder="officer@factory.com" />
          </div>

          <div>
            <label className="mb-2 block text-sm text-slate-300">Password</label>
            <input type="password" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-blue-500" placeholder="••••••••" />
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Demo mode available. This is a frontend-only authentication shell for Phase 1.
          </div>

          <Link to="/dashboard" className="block rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-medium text-white hover:bg-blue-500">
            Sign in
          </Link>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Need an account?{' '}
          <Link to="/register" className="font-medium text-blue-300 hover:text-blue-200">Register</Link>
        </p>
      </div>
    </div>
  )
}

export function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-soft">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/20 text-blue-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Create account</p>
            <p className="text-xl font-semibold text-white">Register</p>
          </div>
        </div>

        <form className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-300">Full name</label>
              <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-blue-500" placeholder="A. Sharma" />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-300">Role</label>
              <select className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-blue-500">
                <option>Safety Officer</option>
                <option>Administrator</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-slate-300">Work email</label>
            <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-blue-500" placeholder="name@company.com" />
          </div>

          <div>
            <label className="mb-2 block text-sm text-slate-300">Organization</label>
            <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-blue-500" placeholder="North Plant Operations" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-300">Password</label>
              <input type="password" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-blue-500" placeholder="••••••••" />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-300">Confirm password</label>
              <input type="password" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-blue-500" placeholder="••••••••" />
            </div>
          </div>

          <Link to="/dashboard" className="block rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-medium text-white hover:bg-blue-500">
            Create account
          </Link>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-blue-300 hover:text-blue-200">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
