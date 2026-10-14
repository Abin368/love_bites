import type { ReportReason } from '../../database/models/report.model';

export interface SubmitReportInput {
  callerId: string;
  reportedUserId: string;
  reason: ReportReason;
  description: string | null;
}

export interface SubmitReportResult {
  reportId: string;
  status: 'PENDING';
}
