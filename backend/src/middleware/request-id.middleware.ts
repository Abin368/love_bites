import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incomingId = req.headers['x-request-id'] as string;
  const requestId = incomingId && incomingId.trim().length > 0 ? incomingId : uuidv4();

  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  next();
};
