import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as profilePhotosController from './profile-photos.controller';
import { confirmPhotoSchema, updatePhotoSchema, uploadUrlSchema } from './profile-photos.validator';

const router = Router();

router.use(authenticate, requireRole('USER'));
router.post('/upload-url', validate(uploadUrlSchema), profilePhotosController.createUploadUrl);
router.post('/confirm', validate(confirmPhotoSchema), profilePhotosController.confirmPhoto);
router.get('/', profilePhotosController.listPhotos);
router.patch('/:photoId', validate(updatePhotoSchema), profilePhotosController.updatePhoto);
router.delete('/:photoId', profilePhotosController.deletePhoto);

export const profilePhotoRoutes = router;
