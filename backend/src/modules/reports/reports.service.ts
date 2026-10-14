import { sequelize } from '../../config/database';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { findUserById } from '../users/users.data-access';
import { insertReport } from './reports.data-access';
import type { SubmitReportInput, SubmitReportResult } from './reports.types';

const SELF_REPORT_MESSAGE = 'You cannot report your own profile.';
const TARGET_NOT_FOUND_MESSAGE = 'Target user profile not found.';

export async function submitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
  const callerId = input.callerId.toLowerCase();
  const reportedUserId = input.reportedUserId.toLowerCase();

  if (callerId === reportedUserId) {
    throw new ValidationError(SELF_REPORT_MESSAGE, [], 'SELF_INTERACTION');
  }

  const report = await sequelize.transaction(async (transaction) => {
    const target = await findUserById(reportedUserId, { transaction });
    if (!target || target.status === 'DELETED' || target.deletedAt) {
      throw new NotFoundError(TARGET_NOT_FOUND_MESSAGE, [], 'USER_NOT_FOUND');
    }

    return insertReport(
      {
        reporterId: callerId,
        reportedUserId,
        reason: input.reason,
        description: input.description
      },
      transaction
    );
  });

  return {
    reportId: report.id,
    status: 'PENDING'
  };
}
