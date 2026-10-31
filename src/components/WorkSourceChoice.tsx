"use client";
import { useEffect, useState } from "react";
import { Field } from "./ui";

export default function WorkSourceChoice({
  caseId,
  service,
}: {
  caseId: string;
  service: string;
}) {
  const [records, setRecords] = useState<{ id: string; label: string }[]>([]),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const url =
        "/api/work/context?mode=sources&case=" +
        encodeURIComponent(caseId) +
        "&service=" +
        service +
        "&q=" +
        encodeURIComponent(q);
      fetch(url, { signal: c.signal, cache: "no-store" })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw Error(d.error ?? "Could not load service records.");
          if (!c.signal.aborted) setRecords(d.records);
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [caseId, service, q]);
  return (
    <section className="work-source-choice">
      <Field label="Find a service record">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={120}
          placeholder="Booking or application reference"
        />
      </Field>
      <Field
        label="Linked service record"
        hint="Choose the record this colleague will work on. Assignment grants access to this record within their role; other customer records stay private."
      >
        <select name={service === "VISA" ? "visaCaseId" : "bookingId"}>
          <option value="">No record linked — work at case level</option>
          {records.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      {loading && <p role="status">Loading permitted records…</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <p className="work-note">
        Up to 100 matching records. A colleague can create a new record from the
        case if it does not exist yet.
      </p>
    </section>
  );
}
