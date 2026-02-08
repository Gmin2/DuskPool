/**
 * Central Logger Module
 * Pino-based structured logging for the matching engine
 */

import pino from 'pino';
import { loggerConfig } from './config';
import type { ModuleName } from './types';

/** Root logger instance */
const rootLogger = pino(loggerConfig);

/** Create a child logger for a specific module */
function createModuleLogger(module: ModuleName) {
  return rootLogger.child({ module });
}

/** Pre-configured module loggers */
export const logger = {
  /** Root logger for general use */
  root: rootLogger,

  /** Server/HTTP layer logging */
  server: createModuleLogger('server'),

  /** Matching engine core logging */
  engine: createModuleLogger('engine'),

  /** Settlement service logging */
  settlement: createModuleLogger('settlement'),

  /** WebSocket logging */
  websocket: createModuleLogger('websocket'),

  /** EventBus logging */
  eventbus: createModuleLogger('eventbus'),

  /** Orders route logging */
  orders: createModuleLogger('orders'),

  /** Matches route logging */
  matches: createModuleLogger('matches'),

  /** Commitment route logging */
  commitment: createModuleLogger('commitment'),

  /** Whitelist route logging */
  whitelist: createModuleLogger('whitelist'),
};

export type { ModuleName, LogContext } from './types';
export default logger;
