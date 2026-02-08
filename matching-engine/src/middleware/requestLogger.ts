/**
 * HTTP Request Logger Middleware
 * pino-http middleware for Express with request ID generation
 */

import pinoHttp from 'pino-http';
import { logger } from '../lib/logger';

/** Request logger middleware */
export const requestLogger = pinoHttp({
  logger: logger.server,

  // Generate unique request IDs
  genReqId: (req) => {
    return (req.headers['x-request-id'] as string) || crypto.randomUUID();
  },

  // Custom log level based on response status
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },

  // Skip health check endpoint
  autoLogging: {
    ignore: (req) => req.url === '/health',
  },

  // Custom success message
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },

  // Custom error message
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
  },

  // Serialize request (minimize logged data)
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      query: req.query,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});

export default requestLogger;
