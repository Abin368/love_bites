export interface ErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export abstract class AppError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly errorCode: string;
  public readonly isOperational: boolean;
  public readonly details: ErrorDetail[];

  constructor(message: string, details: ErrorDetail[] = [], isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}
