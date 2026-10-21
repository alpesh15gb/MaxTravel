"use client";
import Link from "next/link";
export default function OnlineBookingsError({ reset }: { reset: () => void }) {
  return <section className="panel m-4 space-y-3 p-6" role="alert">
    <h1 className="text-xl font-semibold">Online bookings could not be loaded</h1>
    <p className="text-sm text-slate-600">This is a loading problem, not an empty booking queue. Retry, or return to the first page.</p>
    <div className="flex flex-wrap gap-3"><button onClick={reset} className="min-h-11 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white">Try again</button><Link href="/online-bookings" className="inline-flex min-h-11 items-center px-3 text-sm text-teal-700 underline">First page</Link></div>
  </section>;
}
