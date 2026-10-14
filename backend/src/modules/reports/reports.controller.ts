import { asyncHandler } from '../../utils/async-handler';
import * as reportsService from './reports.service';
import type { SubmitReportBody } from './reports.validator';

export const submitReport = asyncHandler(async (req, res) => {
  const body = req.body as SubmitReportBody;
  const data = await reportsService.submitReport({
    callerId: req.user!.id,
    reportedUserId: body.reportedUserId,
    reason: body.reason,
    description: body.description
  });

  res.status(201).json({
    success: true,
    data,
    message: 'Report submitted. Our safety team will review it.'
  });
});
