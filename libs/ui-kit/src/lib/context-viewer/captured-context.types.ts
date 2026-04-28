export interface CapturedContextShape {
  url?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  ids?: Record<string, string>;
  sparte?: string | null;
  appVersion?: string | null;
  userAgent?: string;
  viewport?: { width: number; height: number };
  timezone?: string;
  locale?: string;
  timestamp?: string;
  referrer?: string;
  reporterEmail?: string | null;
  [key: string]: unknown;
}
