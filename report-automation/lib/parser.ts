import { Category, Job, Report } from './types';
import { computeDuration, parseReportDate, parseTime } from './time';

let counter = 0;
function nextId(): string {
  counter += 1;
  return `job-${Date.now().toString(36)}-${counter}`;
}

const TRUCK_ID = /\bET\d{3}\b/gi;

/** Keywords that indicate a job was resolved during the shift. */
const RESOLVED_HINTS =
  /\b(is up|up now|back up|operational|completed|replaced|resolved|fixed|repaired|topped up|top[- ]?up complete)\b/i;

/** Keywords that describe the truck's CURRENT state as down - these always win, even over an earlier resolution mention. */
const STILL_DOWN_HINTS =
  /\b(pending repair|still down|down pending|awaiting|not\s+(?:yet\s+)?repaired)\b/i;

/** "is down"/"down for" only narrates why the truck went down, not its current state - used as a fallback, never an override. */
const WEAK_DOWN_HINTS = /\b(is down|down for)\b/i;

function categoryFromText(text: string): Category {
  const lower = text.toLowerCase();
  if (/coolant|top[- ]?up|refill|lubric/.test(lower)) return 'REFILL';
  if (/inspect|check/.test(lower)) return 'INSPECTION';
  if (/\bpm\b|preventive/.test(lower)) return 'PM';
  if (/charge|recharge|battery/.test(lower)) return 'RECHARGE';
  return 'GR';
}

/** Strips bullet markers, self-referential truck mentions, and stray punctuation from a fragment of job text. */
function clean(fragment: string): string {
  return fragment
    .replace(/^[-*\u2022\s]+/, '')
    .replace(TRUCK_ID, '')
    .replace(/\bis\s+(up|down)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[.,\s]+|[.,\s]+$/g, '');
}

interface JobDraft {
  job: Job;
  /** Raw lines belonging to this job, kept for status classification across the whole block. */
  rawText: string[];
}

function newDraft(truck: string, status: Job['status']): JobDraft {
  return {
    rawText: [],
    job: {
      id: nextId(),
      truck,
      downTime: '',
      upTime: '',
      duration: '',
      category: '',
      jobDescription: '',
      action: '',
      status,
      assignedTo: '',
      reason: '',
      eta: '',
      warnings: [],
    },
  };
}

/** Extracts description + action from the text following a truck mention, without discarding real content. */
function extractDescriptionAndAction(job: Job, afterTruckId: string) {
  // Drop a leading restatement like "is down for" / "is up" so the real content leads.
  const content = afterTruckId.replace(/^\s*is\s+(up|down)(\s+for)?\s*/i, '').trim();
  if (!content) return;

  const parts = content
    .split(/\.(?=\s|$)/)
    .map(clean)
    .filter(Boolean);

  if (parts.length === 0) return;
  if (!job.jobDescription) job.jobDescription = parts[0];
  const rest = job.jobDescription === parts[0] ? parts.slice(1) : parts;
  if (rest.length && !job.action) job.action = rest.join('. ');
}

function classifyStatus(rawText: string[]): Job['status'] {
  const text = rawText.join(' ');
  // A current-state phrase ("pending repair", "still down") always wins,
  // even over an earlier mention of a repair attempt in the same block.
  if (STILL_DOWN_HINTS.test(text)) return 'DOWN';
  if (RESOLVED_HINTS.test(text)) return 'COMPLETED';
  if (WEAK_DOWN_HINTS.test(text)) return 'DOWN';
  return 'DOWN'; // safest default when the outcome is unclear: surface it for review
}

/** True when the classification above had *something* concrete to go on, rather than falling all the way to the default. */
function statusWasConfident(rawText: string[]): boolean {
  const text = rawText.join(' ');
  return STILL_DOWN_HINTS.test(text) || RESOLVED_HINTS.test(text) || WEAK_DOWN_HINTS.test(text);
}

export function parseReport(text: string): Report {
  const date = parseReportDate(text);
  const shift: Report['shift'] = /night/i.test(text) ? 'N' : 'D';
  const reportTime = parseTime(text.match(/(?:day|night)\s*shift\s*(.*)/i)?.[1] || '');
  const safety =
    text.match(/health\s*(?:and|&)\s*safety\s*[:\-]?\s*\**\s*([^\n]+)/i)?.[1]?.trim() || '';

  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const drafts: JobDraft[] = [];
  let current: JobDraft | null = null;

  for (const line of lines) {
    const trucks = [...line.matchAll(TRUCK_ID)].map((m) => m[0].toUpperCase());

    if (trucks.length > 0) {
      // A new truck mention starts a new job entry, even if the same truck
      // already appeared earlier in the report (multiple incidents/day are common).
      current = newDraft(trucks[0], 'DOWN');
      drafts.push(current);

      const afterTruckId = line.replace(new RegExp(`.*?${trucks[0]}`, 'i'), '').trim();
      const downTime = parseTime(line.match(/down\s*time\s*[:\-]?\s*([^,.\n]*)/i)?.[1] || '');
      const upTime = parseTime(line.match(/up\s*time\s*[:\-]?\s*([^,.\n]*)/i)?.[1] || '');
      if (downTime) current.job.downTime = downTime;
      if (upTime) current.job.upTime = upTime;

      extractDescriptionAndAction(current.job, afterTruckId);
      current.rawText.push(line);
      continue;
    }

    if (!current) continue; // narrative text before the first truck mention (e.g. safety line) - ignore

    // Continuation line for the current job (no truck id of its own).
    const downTime = parseTime(line.match(/down\s*time\s*[:\-]?\s*([^,.\n]*)/i)?.[1] || '');
    const upTime = parseTime(line.match(/up\s*time\s*[:\-]?\s*([^,.\n]*)/i)?.[1] || '');
    if (downTime) current.job.downTime = downTime;
    if (upTime) current.job.upTime = upTime;

    if (!current.job.jobDescription) current.job.jobDescription = clean(line);
    else if (!current.job.action) current.job.action = clean(line);
    current.rawText.push(line);
  }

  const jobs: Job[] = drafts.map(({ job, rawText }) => {
    job.status = classifyStatus(rawText);
    job.duration = computeDuration(job.downTime, job.upTime);
    job.category = job.category || categoryFromText(`${job.jobDescription} ${job.action}`);
    job.reason = job.reason || job.jobDescription;

    if (!job.jobDescription) job.warnings.push('Job description is required');
    if (!job.action) job.warnings.push('Action is required');
    if (job.status === 'COMPLETED' && (!job.downTime || !job.upTime)) {
      job.warnings.push('Completed job is missing a start or finish time');
    }
    if (job.status === 'DOWN' && !job.downTime) {
      job.warnings.push('Down job is missing a start time');
    }
    if (!statusWasConfident(rawText)) {
      job.warnings.push('Status could not be determined automatically — please verify');
    }
    return job;
  });

  return {
    date,
    shift,
    reportTime,
    safety,
    jobs,
    warnings: date ? [] : ['Report date not found — please set it manually'],
  };
}
