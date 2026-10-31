"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Field, EmptyState } from "./ui";
import { dateTimeLabel } from "@/lib/dates";
type Message = {
  id: string;
  body: string;
  direction: string;
  at: string;
  status: string;
};
export default function CaseConversation({
  caseId,
  customerId,
  customerAccess,
}: {
  caseId: string;
  customerId: string;
  customerAccess: boolean;
}) {
  const [data, setData] = useState<{
      links: Message[];
      available: Message[];
      canLink: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [q, setQ] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal, search = "") => {
      const r = await fetch(
          `/api/work/conversation?case=${caseId}&q=${encodeURIComponent(search)}`,
          { signal },
        ),
        d = await r.json();
      if (!r.ok) throw Error(d.error ?? "Could not load conversation.");
      setData(d);
    },
    [caseId],
  );
  useEffect(() => {
    const c = new AbortController();
    load(c.signal).catch((e) => {
      if (!c.signal.aborted) setError(e.message);
    });
    return () => c.abort();
  }, [load]);
  async function link(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/work/conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId, messageId: f.get("messageId") }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      await load(undefined, q);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link message.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel p-5">
      <h2 className="text-lg font-semibold">Case conversation</h2>
      <p className="work-report-note">
        Only messages explicitly linked to this case appear here. Internal task
        notes remain in Work and History.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading messages…</p>}
      {data?.canLink && (
        <>
          <form
            className="work-filter-inputs my-4"
            onSubmit={(e) => {
              e.preventDefault();
              load(undefined, q).catch((e) => setError(e.message));
            }}
          >
            <Field label="Search customer messages">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={120}
              />
            </Field>
            <button className="btn-secondary">Find messages</button>
          </form>
          <form onSubmit={link} className="work-filter-inputs my-4">
            <Field label="Link a customer message to this case">
              <select name="messageId" required>
                <option value="">
                  Choose a message after checking its context
                </option>
                {data.available
                  .filter((m) => !data.links.some((l) => l.id === m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {dateTimeLabel(m.at)} · {m.body.slice(0, 100)}
                    </option>
                  ))}
              </select>
            </Field>
            <button className="btn-secondary" disabled={busy}>
              Link message
            </button>
          </form>
          <p className="work-note">
            Search shows up to 30 recent matching messages. The customer inbox
            contains the full conversation.
          </p>
        </>
      )}
      {data && !data.links.length && (
        <EmptyState
          title="No messages linked yet"
          description="A permitted colleague can link the relevant customer messages without sharing unrelated conversations."
        />
      )}
      {data?.links.map((m) => (
        <article className="work-home-row" key={m.id}>
          <div>
            <strong>
              {m.direction === "IN" ? "Customer" : "Agency"} ·{" "}
              {dateTimeLabel(m.at)}
            </strong>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <span>{m.status}</span>
          </div>
        </article>
      ))}
      {customerAccess && (
        <Link
          className="btn-secondary mt-5"
          href={`/whatsapp?customer=${customerId}`}
        >
          Open permitted customer inbox
        </Link>
      )}
    </section>
  );
}
