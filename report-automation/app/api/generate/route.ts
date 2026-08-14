import { NextRequest, NextResponse } from 'next/server';
import { buildReportWorkbook, TemplateError, ValidationError } from '../../../lib/excel';
import { Report } from '../../../lib/types';

// Never let Next.js cache or statically optimize this route - every request
// must regenerate the file from the submitted report data.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let report: Report;
  try {
    const body = await request.json();
    report = body.report;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (!report) {
    return NextResponse.json({ error: 'Missing "report" in request body.' }, { status: 400 });
  }

  try {
    const buffer = await buildReportWorkbook(report);
    return new NextResponse(buffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="EV_Maintenance_${report.date || 'report'}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof TemplateError) {
      console.error('Excel template error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error('Unexpected error generating report:', error);
    return NextResponse.json({ error: 'Failed to generate the Excel report.' }, { status: 500 });
  }
}
