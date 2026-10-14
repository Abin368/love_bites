import { Transaction } from 'sequelize';
import '../../database/associations';
import { Report, ReportReason } from '../../database/models/report.model';

export async function insertReport(
  input: {
    reporterId: string;
    reportedUserId: string;
    reason: ReportReason;
    description: string | null;
  },
  transaction: Transaction
): Promise<Report> {
    const now = new Date();
    return Report.create(
    {
      reporterId: input.reporterId,
      reportedUserId: input.reportedUserId,
      reason: input.reason,
      description: input.description,
      status: 'PENDING',
      adminNotes: null,
      resolvedById: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now
    },
    { transaction }
  );
}
