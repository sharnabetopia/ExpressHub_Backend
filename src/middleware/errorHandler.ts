import type { NextFunction, Request, Response } from "express";

import { sendError } from "../utils/response";

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json(
    sendError(`Route not found: ${req.method} ${req.originalUrl}`, [{ path: req.originalUrl }]),
  );
};

export const errorHandler = (
  error: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const statusCode = error.statusCode ?? error.status ?? 500;
  const message = error.message ?? "Something went wrong";

  res.status(statusCode).json(
    sendError(message, Array.isArray(error.errors) ? error.errors : [{ message }]),
  );
};
