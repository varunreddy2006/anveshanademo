export function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-400">Settings</p>
        <h2 className="text-2xl font-semibold text-white">System configuration</h2>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <p className="text-lg font-semibold text-white">User profile</p>
          <div className="mt-4 space-y-4 text-sm text-slate-300">
            <div><label className="mb-2 block">Full name</label><input className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white" defaultValue="Safety Officer" /></div>
            <div><label className="mb-2 block">Organization</label><input className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white" defaultValue="North Plant Operations" /></div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <p className="text-lg font-semibold text-white">Alert preferences</p>
          <div className="mt-4 space-y-4 text-sm text-slate-300">
            <label className="flex items-center justify-between"><span>Email alerts</span><input type="checkbox" defaultChecked /></label>
            <label className="flex items-center justify-between"><span>SMS escalation</span><input type="checkbox" /></label>
            <label className="flex items-center justify-between"><span>Daily summary</span><input type="checkbox" defaultChecked /></label>
          </div>
        </div>
      </div>
    </div>
  )
}
