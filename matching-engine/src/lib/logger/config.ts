/**
 * Logger configuration
 * Environment-based settings for Pino logger
 */

import type { LoggerOptions } from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

/** Fields to redact from logs */
const redactPaths = [
  'secret',
  'nonce',
  'req.headers.authorization',
  'req.headers.cookie',
];

/** Development configuration with pretty printing */
const developmentConfig: LoggerOptions = {
  level: process.env.LOG_LEVEL || 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
  redact: redactPaths,
};

/** Production configuration with JSON output */
const productionConfig: LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  redact: redactPaths,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
};

export const loggerConfig: LoggerOptions = isDevelopment
  ? developmentConfig
  : productionConfig;

export { isDevelopment };
