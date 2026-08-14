export type Status = 'COMPLETED' | 'DOWN';

export type Category = 'RECHARGE' | 'PM' | 'INSPECTION' | 'GR' | 'REFILL';

export const CATEGORIES: Category[] = ['RECHARGE', 'PM', 'INSPECTION', 'GR', 'REFILL'];

export interface Job {
  /** Stable client-side id, used as React key and edit target. Never written to Excel. */
  id: string;
  truck: string;
  downTime: string; // "HH:MM" 24h, or "" if unknown
  upTime: string; // "HH:MM" 24h, or "" if not yet resolved
  duration: string; // derived, human readable (e.g. "1h 45min")
  category: Category | '';
  jobDescription: string;
  action: string;
  status: Status;
  assignedTo: string;
  /** Down-truck sheet uses "Reason" instead of Job Description; defaults to jobDescription. */
  reason: string;
  eta: string;
  /** Human-readable reasons this job needs a second look before generating the report. */
  warnings: string[];
}

export interface Report {
  date: string; // ISO "YYYY-MM-DD", or "" if not detected
  shift: 'D' | 'N';
  reportTime: string; // "HH:MM", the time the shift report itself was sent
  safety: string;
  jobs: Job[];
  /** Report-level issues (e.g. no date found in the pasted text). */
  warnings: string[];
}
