import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as gendersService from './genders.service';

function send(res: Response, data: unknown, message: string): void {
  res.status(200).json({ success: true, data, message });
}

export const listGenders = asyncHandler(async (_req, res) => {
  const genders = await gendersService.listActiveGenders();
  send(res, genders, 'Genders retrieved successfully');
});
