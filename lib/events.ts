import { EventEmitter } from 'node:events';

export type LiveEventType = 'audit' | 'swap' | 'donation' | 'checks' | 'mints';
export type LiveEvent = { type: LiveEventType; at: number; data?: Record<string, string | number | boolean | null> };

const g = globalThis as unknown as { __cashuAuditBus?: EventEmitter };

export const bus: EventEmitter =
  g.__cashuAuditBus ??
  (g.__cashuAuditBus = (() => {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    return emitter;
  })());

export function publish(type: LiveEventType, data?: LiveEvent['data']) {
  bus.emit('event', { type, at: Date.now(), data } satisfies LiveEvent);
}
