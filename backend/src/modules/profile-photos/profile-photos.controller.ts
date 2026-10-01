import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as profilePhotosService from './profile-photos.service';
import type { ConfirmPhotoBody, UpdatePhotoBody, UploadUrlBody } from './profile-photos.validator';

function send(res: Response, status: number, data: unknown, message: string): void {
  res.status(status).json({ success: true, data, message });
}

export const createUploadUrl = asyncHandler(async (req, res) => {
  const data = await profilePhotosService.createUploadUrl(req.user!.id, req.body as UploadUrlBody);
  send(res, 200, data, 'Upload URL created successfully');
});

export const confirmPhoto = asyncHandler(async (req, res) => {
  const data = await profilePhotosService.confirmPhoto(req.user!.id, req.body as ConfirmPhotoBody);
  send(res, 201, data, 'Photo confirmed successfully');
});

export const listPhotos = asyncHandler(async (req, res) => {
  const data = await profilePhotosService.listPhotos(req.user!.id);
  send(res, 200, data, 'Photos retrieved successfully');
});

export const updatePhoto = asyncHandler(async (req, res) => {
  const data = await profilePhotosService.updatePhoto(req.user!.id, req.params.photoId, req.body as UpdatePhotoBody);
  send(res, 200, data, 'Photos updated successfully');
});

export const deletePhoto = asyncHandler(async (req, res) => {
  const data = await profilePhotosService.deletePhoto(req.user!.id, req.params.photoId);
  send(res, 200, data, 'Photo deleted successfully');
});
