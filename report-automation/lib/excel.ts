import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { Job, Report } from './types';
import { computeDuration } from './time';

const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'Daily maintenance log.xlsx');

/**
 * Sheet1 ("DAILY COMPLETED LOG") gets one row per COMPLETED job: NO, DATE, TRUCK No.,
 * SHIFT, Start time, Finish time, Duration, Task Category, JOB DESCRIPTION, ACTION,
 * STATUS, Assigned To.
 */
const SHEET1_NAME = 'Sheet1';
const SHEET1_FIRST_DATA_ROW = 10;
const SHEET1_TRUCK_COL = 3; // column C, used to detect the next empty row

/**
 * Sheet2 ("DOWN EV TRUCKS") tracks every incident that involved actual downtime -
 * both trucks that came back up during the shift and trucks still down at shift end.
 * TRUCK No., Down Date, Down Time, Up Date, Up Time, Reason, Current Status, ETA.
 */
const SHEET2_NAME = 'Sheet2';
const SHEET2_FIRST_DATA_ROW = 4;
const SHEET2_TRUCK_COL = 1; // column A, used to detect the next empty row

export class TemplateError extends Error {}
export class ValidationError extends Error {}

/** Combines an ISO date with an "HH:MM" time into a UTC-anchored Date so ExcelJS serializes it without a timezone shift. */
function toExcelDateTime(dateIso: string, hhmm?: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const [year, month, day] = dateIso.split('-').map(Number);
  if (hhmm) {
    const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return new Date(Date.UTC(year, month - 1, day, Number(m[1]), Number(m[2])));
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function findNextEmptyRow(sheet: ExcelJS.Worksheet, firstRow: number, checkCol: number): number {
  let row = firstRow;
  while (sheet.getCell(row, checkCol).value != null && sheet.getCell(row, checkCol).value !== '') {
    row += 1;
  }
  return row;
}

/** Scans column A above `beforeRow` for the last numeric NO. value already used, so numbering continues across report runs. */
function findNextSequenceNumber(sheet: ExcelJS.Worksheet, firstRow: number, beforeRow: number): number {
  let last = 0;
  for (let row = firstRow; row < beforeRow; row += 1) {
    const value = sheet.getCell(row, 1).value;
    if (typeof value === 'number') last = value;
  }
  return last + 1;
}

export async function buildReportWorkbook(report: Report): Promise<Uint8Array> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.date)) {
    throw new ValidationError('Report date is missing or invalid. Set a date before generating the report.');
  }
  if (!Array.isArray(report.jobs) || report.jobs.length === 0) {
    throw new ValidationError('Add at least one job before generating the report.');
  }
  for (const job of report.jobs) {
    if (!job.truck.trim()) {
      throw new ValidationError('Every job needs a truck number.');
    }
  }

  let templateFile: Buffer;
  try {
    templateFile = await fs.readFile(TEMPLATE_PATH);
  } catch {
    throw new TemplateError(`Template not found at ${TEMPLATE_PATH}. Make sure "Daily maintenance log.xlsx" is in the public/ folder.`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toArrayBuffer(templateFile));

  const completedSheet = workbook.getWorksheet(SHEET1_NAME);
  const downSheet = workbook.getWorksheet(SHEET2_NAME);
  if (!completedSheet) throw new TemplateError(`Sheet "${SHEET1_NAME}" was not found in the template.`);
  if (!downSheet) throw new TemplateError(`Sheet "${SHEET2_NAME}" was not found in the template.`);

  writeCompletedJobs(completedSheet, report);
  writeDownTrackingRows(downSheet, report);

  const output = await workbook.xlsx.writeBuffer();
  return new Uint8Array(output as ArrayBuffer);
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function writeCompletedJobs(sheet: ExcelJS.Worksheet, report: Report) {
  const completed = report.jobs.filter((job) => job.status === 'COMPLETED');
  if (completed.length === 0) return;

  const startRow = findNextEmptyRow(sheet, SHEET1_FIRST_DATA_ROW, SHEET1_TRUCK_COL);
  const sequenceNumber = findNextSequenceNumber(sheet, SHEET1_FIRST_DATA_ROW, startRow);
  const reportDate = toExcelDateTime(report.date);

  completed.forEach((job: Job, index: number) => {
    const row = sheet.getRow(startRow + index);
    if (index === 0) row.getCell(1).value = sequenceNumber; // NO. is only marked on the first row of each batch
    row.getCell(2).value = reportDate;
    row.getCell(3).value = job.truck;
    row.getCell(4).value = report.shift;
    row.getCell(5).value = toExcelDateTime(report.date, job.downTime) ?? job.downTime;
    row.getCell(6).value = toExcelDateTime(report.date, job.upTime) ?? job.upTime;
    // Recompute from the times rather than trusting a client-supplied value,
    // so the sheet is always internally consistent even if the client's copy is stale.
    row.getCell(7).value = computeDuration(job.downTime, job.upTime);
    row.getCell(8).value = job.category || '';
    row.getCell(9).value = job.jobDescription;
    row.getCell(10).value = job.action;
    row.getCell(11).value = 'COMPLETED';
    row.getCell(12).value = job.assignedTo;
    row.commit();
  });
}

function writeDownTrackingRows(sheet: ExcelJS.Worksheet, report: Report) {
  // Every job that has a recorded down-time represents a downtime incident,
  // whether it was resolved during the shift or is still open.
  const trackedJobs = report.jobs.filter((job) => job.downTime);
  if (trackedJobs.length === 0) return;

  const startRow = findNextEmptyRow(sheet, SHEET2_FIRST_DATA_ROW, SHEET2_TRUCK_COL);

  trackedJobs.forEach((job: Job, index: number) => {
    const row = sheet.getRow(startRow + index);
    const resolved = job.status === 'COMPLETED' && !!job.upTime;
    row.getCell(1).value = job.truck;
    row.getCell(2).value = toExcelDateTime(report.date);
    row.getCell(3).value = toExcelDateTime(report.date, job.downTime);
    row.getCell(4).value = resolved ? toExcelDateTime(report.date) : null;
    row.getCell(5).value = resolved ? toExcelDateTime(report.date, job.upTime) : null;
    row.getCell(6).value = job.reason || job.jobDescription;
    row.getCell(7).value = resolved ? 'up' : 'down';
    row.getCell(8).value = resolved ? null : toExcelDateTime(job.eta) ?? (job.eta || null);
    row.commit();
  });
}
