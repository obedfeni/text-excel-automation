'use client';

import { useState } from 'react';
import { parseReport } from '../lib/parser';
import { computeDuration } from '../lib/time';
import { CATEGORIES, Category, Job, Report } from '../lib/types';

const SAMPLE = `
[DATE] [DAY/NIGHT] shift [TIME REPORT SENT]
Health and Safety: [note, or "no safety incidents"]
- [TRUCK ID] DOWN TIME: [H:MMam/pm]. [What was wrong]. [What was done]. UP TIME: [H:MMam/pm]. [TRUCK ID] is up.

10/08/2026 day shift 5:00pm
Health and Safety: no safety incidents
-ET023 low coolant level. Coolant top up complete. ET023 is up
-ET013 is down for leaking steering wheel oil hose. Steering oil hose replacement completed. ET013 is up
-ET018 low coolant level. Coolant top up complete. ET018 is up
-ET014 damaged guardrail due to impact has been replaced. ET014 is up
ET013 reported a steering wheel malfunction. Truck is down pending repair.`;

function makeBlankJob(): Job {
  return {
    id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    truck: '',
    downTime: '',
    upTime: '',
    duration: '',
    category: '',
    jobDescription: '',
    action: '',
    status: 'DOWN',
    assignedTo: '',
    reason: '',
    eta: '',
    warnings: [],
  };
}

type Screen = 'paste' | 'review';

export default function Home() {
  const [text, setText] = useState(SAMPLE);
  const [report, setReport] = useState<Report | null>(null);
  const [screen, setScreen] = useState<Screen>('paste');
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFilename, setResultFilename] = useState('');
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  /** Wraps a report update so any edit invalidates a previously generated file - it no longer matches what's on screen. */
  function mutateReport(updater: (r: Report) => Report) {
    setReport((r) => (r ? updater(r) : r));
    if (generated) {
      setGenerated(false);
      setResultBlob(null);
      setResultFilename('');
    }
    setShareNotice(null);
  }

  function handleParse() {
    if (!text.trim()) return;
    setReport(parseReport(text));
    setScreen('review');
    setGenerated(false);
    setResultBlob(null);
    setResultFilename('');
    setShareNotice(null);
    setError(null);
  }

  function reset() {
    setText(SAMPLE);
    setReport(null);
    setScreen('paste');
    setGenerated(false);
    setError(null);
    setResultBlob(null);
    setResultFilename('');
    setShareNotice(null);
  }

  function updateJob(id: string, patch: Partial<Job>) {
    mutateReport((r) => ({
      ...r,
      jobs: r.jobs.map((job) => {
        if (job.id !== id) return job;
        const next = { ...job, ...patch, warnings: [] };
        if ('downTime' in patch || 'upTime' in patch) {
          next.duration = computeDuration(next.downTime, next.upTime);
        }
        return next;
      }),
    }));
  }

  function removeJob(id: string) {
    mutateReport((r) => ({ ...r, jobs: r.jobs.filter((j) => j.id !== id) }));
  }

  function addJob() {
    mutateReport((r) => ({ ...r, jobs: [...r.jobs, makeBlankJob()] }));
  }

  async function generateReport() {
    if (!report) return;
    setBusy(true);
    setError(null);
    setShareNotice(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Report generation failed (${res.status}).`);
      }
      const blob = await res.blob();
      setResultBlob(blob);
      setResultFilename(`EV_Maintenance_${report.date || 'report'}.xlsx`);
      setGenerated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong generating the report.');
    } finally {
      setBusy(false);
    }
  }

  function saveToDevice() {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resultFilename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendToWhatsApp() {
    if (!resultBlob) return;
    setShareNotice(null);
    const file = new File([resultBlob], resultFilename, { type: resultBlob.type });
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
      share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
    };

    // On phones (Android Chrome, iOS Safari), the Web Share API opens the native
    // share sheet with the file attached - WhatsApp shows up there directly.
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file], title: 'Daily Maintenance Log', text: `EV Maintenance Report - ${report?.date || ''}` });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return; // user cancelled the share sheet
        // fall through to the desktop fallback below
      }
    }

    // Desktop browsers can't attach a file to WhatsApp automatically - save the
    // file and open WhatsApp Web so it's one paste away from being attached.
    saveToDevice();
    window.open('https://web.whatsapp.com/', '_blank');
    setShareNotice(`Saved "${resultFilename}" - attach it from your downloads in the WhatsApp chat that just opened.`);
  }

  const completedCount = report?.jobs.filter((j) => j.status === 'COMPLETED').length ?? 0;
  const downCount = report?.jobs.filter((j) => j.status === 'DOWN').length ?? 0;
  const hasBlockingIssues =
    !report?.date || report.jobs.length === 0 || report.jobs.some((j) => !j.truck.trim());

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">FleetLog</span>
          <div>
            <h1>Tonly Team Maintenance Report </h1>
            <p>WhatsApp shift report → editable daily maintenance log</p>
          </div>
        </div>
        {screen === 'review' && (
          <button className="btn-reset" onClick={reset}>
            Start over
          </button>
        )}
      </header>

      <Stepper screen={screen} generating={busy} generated={generated} />

      <main className="main">
        {screen === 'paste' && (
          <section className="panel">
            <h2>1. Paste the WhatsApp shift report</h2>
            <p className="panel-hint">Paste the report exactly as it was sent. You'll review and fix every field before anything is generated.</p>
            <textarea
              className="report-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
            <div className="action-row">
              <button className="btn btn-primary" onClick={handleParse} disabled={!text.trim()}>
                Parse report
              </button>
              <button className="btn" onClick={() => setText(SAMPLE)}>
                Load example
              </button>
            </div>
          </section>
        )}

        {screen === 'review' && report && (
          <>
            <section className="panel">
              <h2>2. Report details</h2>
              <p className="panel-hint">Confirm the date and shift before generating - every job in this report is filed under them.</p>
              <div className="meta-grid">
                <div className="field">
                  <label htmlFor="date">Date</label>
                  <input
                    id="date"
                    type="date"
                    value={report.date}
                    onChange={(e) => mutateReport((r) => ({ ...r, date: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="shift">Shift</label>
                  <select
                    id="shift"
                    value={report.shift}
                    onChange={(e) => mutateReport((r) => ({ ...r, shift: e.target.value as Report['shift'] }))}
                  >
                    <option value="D">Day</option>
                    <option value="N">Night</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="safety">Health &amp; safety</label>
                  <input
                    id="safety"
                    value={report.safety}
                    onChange={(e) => mutateReport((r) => ({ ...r, safety: e.target.value }))}
                    placeholder="e.g. no safety incidents"
                  />
                </div>
              </div>
              {report.warnings.length > 0 && (
                <p className="report-warning">⚠ {report.warnings.join(' · ')}</p>
              )}
            </section>

            <section className="panel">
              <div className="tickets-head">
                <h2>3. Review each job</h2>
                <div className="summary-chips">
                  <span className="chip chip-up">{completedCount} completed</span>
                  <span className="chip chip-down">{downCount} down</span>
                </div>
              </div>
              <p className="panel-hint">
                Job description and action are required for every job. Fix anything the parser got wrong - it flags what it's unsure about.
              </p>

              {report.jobs.length === 0 && (
                <div className="empty-state">
                  <h2>No jobs found</h2>
                  <p>Add one manually, or go back and re-check the pasted text.</p>
                </div>
              )}

              {report.jobs.map((job, i) => (
                <JobTicket
                  key={job.id}
                  job={job}
                  index={i}
                  onChange={(patch) => updateJob(job.id, patch)}
                  onRemove={() => removeJob(job.id)}
                />
              ))}

              <button className="btn" onClick={addJob}>
                + Add job manually
              </button>
            </section>
          </>
        )}
      </main>

      {screen === 'review' && report && (
        <footer className="footer-bar">
          <div className="footer-summary">
            {error ? (
              <strong style={{ color: 'var(--color-down)' }}>{error}</strong>
            ) : shareNotice ? (
              <strong>{shareNotice}</strong>
            ) : (
              <>
                <strong>{report.jobs.length}</strong> job{report.jobs.length === 1 ? '' : 's'} for{' '}
                <strong>{report.date || 'no date set'}</strong>
              </>
            )}
          </div>
          {!generated ? (
            <button className="btn btn-amber" onClick={generateReport} disabled={busy || hasBlockingIssues}>
              {busy ? 'Generating…' : 'Generate Excel report'}
            </button>
          ) : (
            <div className="action-row" style={{ margin: 0 }}>
              <button className="btn" onClick={saveToDevice}>
                Save to device
              </button>
              <button className="btn btn-amber" onClick={sendToWhatsApp}>
                Send via WhatsApp
              </button>
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

function Stepper({ screen, generating, generated }: { screen: Screen; generating: boolean; generated: boolean }) {
  const steps: { key: string; label: string; active: boolean; done: boolean }[] = [
    { key: 'paste', label: 'Paste', active: screen === 'paste', done: screen === 'review' },
    { key: 'review', label: 'Review', active: screen === 'review' && !generating, done: generated },
    { key: 'generate', label: 'Generate', active: generating, done: generated },
  ];
  return (
    <nav className="stepper" aria-label="Progress">
      {steps.map((step, i) => (
        <span key={step.key} style={{ display: 'flex', alignItems: 'center' }}>
          <span className={`step ${step.active ? 'is-active' : ''} ${step.done ? 'is-done' : ''}`}>
            <span className="step-dot">{step.done ? '✓' : i + 1}</span>
            <span className="step-label">{step.label}</span>
          </span>
          {i < steps.length - 1 && <span className={`step-connector ${steps[i + 1].done || step.done ? 'is-done' : ''}`} />}
        </span>
      ))}
    </nav>
  );
}

function JobTicket({
  job,
  index,
  onChange,
  onRemove,
}: {
  job: Job;
  index: number;
  onChange: (patch: Partial<Job>) => void;
  onRemove: () => void;
}) {
  return (
    <article className={`job-ticket ${job.status === 'COMPLETED' ? 'is-completed' : ''}`}>
      <div className="ticket-head">
        <span className="ticket-truck">
          <span className="ticket-index">#{index + 1}</span>
          {job.truck || 'No truck number'}
        </span>
        <span className={`status-pill ${job.status === 'COMPLETED' ? 'completed' : 'down'}`}>{job.status}</span>
      </div>

      <div className="ticket-fields">
        <div className="field">
          <label>Truck</label>
          <input value={job.truck} onChange={(e) => onChange({ truck: e.target.value.toUpperCase() })} placeholder="ET023" />
        </div>
        <div className="field">
          <label>Start time</label>
          <input type="time" value={job.downTime} onChange={(e) => onChange({ downTime: e.target.value })} />
        </div>
        <div className="field">
          <label>Finish time</label>
          <input type="time" value={job.upTime} onChange={(e) => onChange({ upTime: e.target.value })} />
        </div>
        <div className="field">
          <label>Status</label>
          <select value={job.status} onChange={(e) => onChange({ status: e.target.value as Job['status'] })}>
            <option value="COMPLETED">Completed</option>
            <option value="DOWN">Down</option>
          </select>
        </div>

        <div className="field">
          <label>Category</label>
          <select value={job.category} onChange={(e) => onChange({ category: e.target.value as Category })}>
            <option value="">-</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Duration</label>
          <input value={job.duration} readOnly placeholder="auto" />
        </div>
        <div className="field">
          <label>Assigned to</label>
          <input value={job.assignedTo} onChange={(e) => onChange({ assignedTo: e.target.value })} placeholder="e.g. Eric, Cornelius" />
        </div>
        {job.status === 'DOWN' && (
          <div className="field">
            <label>ETA</label>
            <input type="date" value={job.eta} onChange={(e) => onChange({ eta: e.target.value })} />
          </div>
        )}

        <div className="field wide full">
          <label>Job description</label>
          <input value={job.jobDescription} onChange={(e) => onChange({ jobDescription: e.target.value })} placeholder="What was wrong" />
        </div>
        <div className="field wide full">
          <label>Action</label>
          <input value={job.action} onChange={(e) => onChange({ action: e.target.value })} placeholder="What was done about it" />
        </div>
      </div>

      {job.warnings.length > 0 && <p className="ticket-warning">⚠ {job.warnings.join(' · ')}</p>}

      <div className="action-row">
        <button className="btn" onClick={onRemove}>
          Remove job
        </button>
      </div>
    </article>
  );
}
