/**
 * Logger type definitions
 */

export type ModuleName =
  | 'server'
  | 'engine'
  | 'settlement'
  | 'websocket'
  | 'eventbus'
  | 'orders'
  | 'matches'
  | 'commitment'
  | 'whitelist';

export interface LogContext {
  module: ModuleName;
  [key: string]: unknown;
}
