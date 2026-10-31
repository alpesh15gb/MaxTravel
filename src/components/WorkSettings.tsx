"use client";
import { useState } from "react";
import Link from "next/link";
import { PageHeader, Field } from "./ui";
import { resultsForService, type WorkConfig } from "@/lib/work-config";
import { enumLabel } from "@/lib/labels";
export type WorkSettingPerson = {
  id: string;
  name: string;
  services: string[];
  canWork: boolean;
  canReview: boolean;
  canEscalate: boolean;
  canFinance: boolean;
};
export default function WorkSettings({
  initial,
  people = [],
}: {
  initial: WorkConfig;
  people?: WorkSettingPerson[];
}) {
  const [config, setConfig] = useState(initial),
    [service, setService] = useState("VISA"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const template = config.templates.find((t) => t.service === service)!;
  function update(run: (next: WorkConfig) => void) {
    setConfig((c) => {
      const n = structuredClone(c);
      run(n);
      return n;
    });
    setReviewed(false);
    setNotice("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/work/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setConfig((c) => ({ ...c, version: d.version }));
      setReviewed(false);
      setNotice(
        `Version ${d.version} saved for future plan applications. Existing work remains unchanged.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rules.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-page work-desk">
      <PageHeader
        eyebrow={`Work configuration · version ${config.version}`}
        title="Work templates & rules"
        description="Define repeatable service steps, the result each step needs and which steps require a separate reviewer."
        actions={
          <Link className="btn-secondary" href="/work">
            Back to work
          </Link>
        }
      />
      <form onSubmit={save} className="space-y-6">
        <fieldset disabled={busy} className="space-y-6">
          <section className="panel p-5">
            <h2 className="text-lg font-semibold">Service template</h2>
            <div className="work-filter-inputs my-4">
              <Field label="Service">
                <select
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                >
                  {config.templates.map((t) => (
                    <option key={t.service}>{t.service}</option>
                  ))}
                </select>
              </Field>
              <p>
                Assignments and deadlines are chosen in the case plan preview.
                Each step retains its identity across template versions.
              </p>
            </div>
            {template.steps.map((s, i) => (
              <section className="work-plan-step" key={s.key}>
                <h3>Step {i + 1}</h3>
                <Field label="Action title *">
                  <input
                    required
                    minLength={3}
                    maxLength={160}
                    value={s.title}
                    onChange={(e) =>
                      update((c) => {
                        c.templates.find((t) => t.service === service)!.steps[
                          i
                        ].title = e.target.value;
                      })
                    }
                  />
                </Field>
                <Field label="Instructions">
                  <textarea
                    maxLength={2000}
                    rows={2}
                    value={s.instructions}
                    onChange={(e) =>
                      update((c) => {
                        c.templates.find((t) => t.service === service)!.steps[
                          i
                        ].instructions = e.target.value;
                      })
                    }
                  />
                </Field>
                <details className="work-defaults">
                  <summary>Assignment defaults & due target</summary>
                  <div className="space-y-4 mt-4">
                    <Field
                      label="Default assignee"
                      hint="Eligibility is checked again for each case. Unavailable defaults become unassigned in the preview."
                    >
                      <select
                        value={s.defaultOwnerId ?? ""}
                        onChange={(e) =>
                          update((c) => {
                            c.templates.find(
                              (t) => t.service === service,
                            )!.steps[i].defaultOwnerId = e.target.value || null;
                          })
                        }
                      >
                        <option value="">Choose when planning</option>
                        <option value="CASE_COORDINATOR">
                          Case coordinator
                        </option>
                        {s.defaultOwnerId &&
                          s.defaultOwnerId !== "CASE_COORDINATOR" &&
                          !people.some((p) => p.id === s.defaultOwnerId) && (
                            <option disabled value={s.defaultOwnerId}>
                              Unavailable colleague — select another
                            </option>
                          )}
                        {people
                          .filter(
                            (p) =>
                              p.canWork &&
                              p.services.includes(service) &&
                              (s.resultType !== "PAYMENT" || p.canFinance),
                          )
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Default reviewer">
                      <select
                        value={s.defaultReviewerId ?? ""}
                        onChange={(e) =>
                          update((c) => {
                            c.templates.find(
                              (t) => t.service === service,
                            )!.steps[i].defaultReviewerId =
                              e.target.value || null;
                          })
                        }
                      >
                        <option value="">Choose when planning</option>
                        <option value="CASE_COORDINATOR">
                          Case coordinator
                        </option>
                        {s.defaultReviewerId &&
                          s.defaultReviewerId !== "CASE_COORDINATOR" &&
                          !people.some((p) => p.id === s.defaultReviewerId) && (
                            <option disabled value={s.defaultReviewerId}>
                              Unavailable colleague — select another
                            </option>
                          )}
                        {people
                          .filter(
                            (p) =>
                              p.canReview &&
                              p.services.includes(service) &&
                              (s.resultType !== "PAYMENT" || p.canFinance),
                          )
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field
                      label="Due after hours"
                      hint="Calendar hours from the plan preview. Leave blank to choose a date for each case; the planner reviews the actual India-time deadline."
                    >
                      <input
                        type="number"
                        min={1}
                        max={8760}
                        value={s.dueAfterHours ?? ""}
                        onChange={(e) =>
                          update((c) => {
                            c.templates.find(
                              (t) => t.service === service,
                            )!.steps[i].dueAfterHours = e.target.value
                              ? Number(e.target.value)
                              : null;
                          })
                        }
                      />
                    </Field>
                  </div>
                </details>
                <div className="work-filter-inputs">
                  <Field label="Required result">
                    <select
                      value={s.resultType}
                      onChange={(e) =>
                        update((c) => {
                          c.templates.find((t) => t.service === service)!.steps[
                            i
                          ].resultType = e.target.value as typeof s.resultType;
                        })
                      }
                    >
                      {resultsForService(service).map((r) => (
                        <option key={r} value={r}>
                          {enumLabel(r)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Prerequisite">
                    <select
                      value={s.prerequisite ?? ""}
                      onChange={(e) =>
                        update((c) => {
                          c.templates.find((t) => t.service === service)!.steps[
                            i
                          ].prerequisite = e.target.value || null;
                        })
                      }
                    >
                      <option value="">No prerequisite</option>
                      {template.steps.slice(0, i).map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="flex flex-wrap gap-5">
                  <label className="flex gap-3 items-center">
                    <input
                      type="checkbox"
                      checked={s.requiresReview}
                      onChange={(e) =>
                        update((c) => {
                          c.templates.find((t) => t.service === service)!.steps[
                            i
                          ].requiresReview = e.target.checked;
                        })
                      }
                    />
                    Separate review required
                  </label>
                  <label className="flex gap-3 items-center">
                    <input
                      type="checkbox"
                      checked={s.required}
                      onChange={(e) =>
                        update((c) => {
                          c.templates.find((t) => t.service === service)!.steps[
                            i
                          ].required = e.target.checked;
                        })
                      }
                    />
                    Required before case closure
                  </label>
                  {template.steps.length > 1 && (
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() =>
                        update((c) => {
                          const t = c.templates.find(
                            (t) => t.service === service,
                          )!;
                          t.steps = t.steps
                            .filter((p) => p.key !== s.key)
                            .map((p) => ({
                              ...p,
                              prerequisite:
                                p.prerequisite === s.key
                                  ? null
                                  : p.prerequisite,
                            }));
                        })
                      }
                    >
                      Remove step
                    </button>
                  )}
                </div>
              </section>
            ))}
            <button
              type="button"
              className="btn-secondary"
              disabled={template.steps.length >= 20}
              onClick={() =>
                update((c) => {
                  c.templates
                    .find((t) => t.service === service)!
                    .steps.push({
                      key: "step-" + crypto.randomUUID().slice(0, 8),
                      title: "New service action",
                      instructions: "",
                      resultType: "NOTE",
                      prerequisite: null,
                      requiresReview: false,
                      required: true,
                      defaultOwnerId: null,
                      defaultReviewerId: null,
                      dueAfterHours: null,
                    });
                })
              }
            >
              Add template step
            </button>
          </section>
          <section className="panel p-5 space-y-4">
            <h2 className="text-lg font-semibold">Staff reminder calendar</h2>
            <p>
              In-app work reminders are independent of customer WhatsApp
              automation. Hard service deadlines remain visible at all times.
              Business-hour reminders start only when this calendar is enabled.
            </p>
            <label className="flex gap-3 items-center">
              <input
                type="checkbox"
                checked={config.businessHoursEnabled}
                onChange={(e) =>
                  update((c) => {
                    c.businessHoursEnabled = e.target.checked;
                  })
                }
              />
              Enable calendar-based staff reminders
            </label>
            <div
              className="flex flex-wrap gap-4"
              role="group"
              aria-label="Working days"
            >
              {[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((d, i) => (
                <label className="flex gap-2 items-center" key={d}>
                  <input
                    type="checkbox"
                    checked={config.weekdays.includes(i)}
                    onChange={(e) =>
                      update((c) => {
                        c.weekdays = e.target.checked
                          ? [...c.weekdays, i]
                          : c.weekdays.filter((v) => v !== i);
                      })
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
            <div className="work-filter-inputs">
              <Field label="Opening hour (India time)">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={config.openHour}
                  onChange={(e) =>
                    update((c) => {
                      c.openHour = Number(e.target.value);
                    })
                  }
                />
              </Field>
              <Field label="Closing hour (India time)">
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={config.closeHour}
                  onChange={(e) =>
                    update((c) => {
                      c.closeHour = Number(e.target.value);
                    })
                  }
                />
              </Field>
              <Field
                label="Unavailable-message follow-up target (hours)"
                hint="Calendar hours for newly created missing-content follow-ups. Working hours still control soft reminder delivery."
              >
                <input
                  type="number"
                  required
                  min={1}
                  max={168}
                  value={config.responseHours}
                  onChange={(e) =>
                    update((c) => {
                      c.responseHours = Number(e.target.value);
                    })
                  }
                />
              </Field>
              <Field label="Stale after days without an update">
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={config.staleDays}
                  onChange={(e) =>
                    update((c) => {
                      c.staleDays = Number(e.target.value);
                    })
                  }
                />
              </Field>
            </div>
            <Field
              label="Additional escalation managers"
              hint="Optional, up to ten. Only colleagues permitted to view the work receive reminders; assignees, reviewers and coordinators keep their existing notifications."
            >
              <select
                multiple
                size={4}
                value={config.escalationUserIds}
                onChange={(e) =>
                  update((c) => {
                    c.escalationUserIds = Array.from(
                      e.target.selectedOptions,
                    ).map((o) => o.value);
                  })
                }
              >
                {people
                  .filter((p) => p.canEscalate)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              label="Holiday dates"
              hint="One date per line, YYYY-MM-DD. Existing deadlines are not changed."
            >
              <textarea
                rows={4}
                value={config.holidays.join("\n")}
                onChange={(e) =>
                  update((c) => {
                    c.holidays = e.target.value
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                  })
                }
              />
            </Field>
          </section>
          <section className="panel p-5">
            <h2 className="text-lg font-semibold">Review this change</h2>
            <p className="work-report-note">
              {config.templates.reduce((n, t) => n + t.steps.length, 0)} steps
              across three services;{" "}
              {
                config.templates
                  .flatMap((t) => t.steps)
                  .filter((s) => s.requiresReview).length
              }{" "}
              require review. Saving creates a new version. It does not rewrite
              existing assignments, outcomes or deadlines.
            </p>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                required
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed the service steps and reminder calendar.
            </label>
          </section>
        </fieldset>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <button className="btn-primary" disabled={busy || !reviewed}>
          {busy ? "Saving…" : "Save new version"}
        </button>
      </form>
    </div>
  );
}
