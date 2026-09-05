import type { EventHandler, H3Event } from 'h3';
import type { Numra, NumraError } from '@numra/core';

export interface NumraHandlerOptions {
  /** Numra credential. Server-side only. */
  apiKey?: string;
  /**
   * Runs before every lookup. Return false to reject.
   *
   * REQUIRED. The default denies everything and logs why — this route spends
   * your Numra quota, so leaving it open is an open relay pointed at your
   * own bill.
   */
  authorize?: (event: H3Event) => boolean | Promise<boolean>;
  /** Enables the `/webhook` segment when set. */
  webhookSecret?: string;
  onEvent?: (event: Record<string, unknown>, h3Event: H3Event) => void | Promise<void>;
  /** A pre-built client, for tests. */
  client?: Numra;
  baseUrl?: string;
}

/** What the browser receives — a subset. Never `raw`, never engine internals. */
export interface BrowserCheck {
  phone: string;
  verdict: string;
  riskLevel: string;
  riskScore: number;
  trustScore: number;
  confidence: number;
  isRated: boolean;
  isBlacklisted: boolean;
  customerStyle: { code: string; label: string; icon: string; color: string; riskSensitivity: number } | null;
}

/**
 * A catch-all server route:
 *
 *     // server/api/numra/[...].js
 *     export default createNumraHandler({ apiKey, authorize });
 */
export declare function createNumraHandler(options?: NumraHandlerOptions): EventHandler;

export { Numra, NumraError } from '@numra/core';
