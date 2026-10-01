function App() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900 sm:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl flex-col">
        <header className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-indigo-600 text-lg font-bold text-white shadow-sm">
            S
          </div>
          <span className="text-xl font-semibold tracking-tight">SchedMe</span>
        </header>

        <section className="grid flex-1 content-center gap-10 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="max-w-2xl">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">
              Make room for what matters
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
              A calmer way to plan your week.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
              SchedMe is getting ready to help you bring tasks, deadlines, and commitments into one realistic schedule.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Your planning space</p>
                <h2 className="mt-1 text-xl font-semibold">Coming together</h2>
              </div>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">Phase 1</span>
            </div>
            <div className="mt-8 space-y-3" aria-hidden="true">
              <div className="h-12 rounded-xl bg-slate-100" />
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: 7 }, (_, index) => (
                  <div key={index} className={`h-20 rounded-xl ${index === 2 ? 'bg-indigo-100' : 'bg-slate-50'}`} />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="h-24 rounded-xl bg-slate-50" />
                <div className="h-24 rounded-xl bg-slate-50" />
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t border-slate-200 py-5 text-sm text-slate-500">
          Your schedule stays yours. Start by making a little room.
        </footer>
      </div>
    </main>
  )
}

export default App
