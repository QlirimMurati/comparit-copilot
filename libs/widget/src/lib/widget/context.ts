import type { CapturedContext, WidgetSparte } from './widget.types';

export interface CaptureInputs {
  sparte?: WidgetSparte | null;
  appVersion?: string | null;
  reporterEmail?: string | null;
}

const ID_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: 'vergleichId',
    re: /\/vergleich\/([^/?#]+)|vergleich(?:_id|Id)=([^&]+)/i,
  },
  { name: 'tarifId', re: /\/tarif\/([^/?#]+)|tarif(?:_id|Id)=([^&]+)/i },
  { name: 'antragId', re: /\/antrag\/([^/?#]+)|antrag(?:_id|Id)=([^&]+)/i },
  { name: 'kundeId', re: /\/kunde\/([^/?#]+)|kunde(?:_id|Id)=([^&]+)/i },
];

export function captureContext(input: CaptureInputs = {}): CapturedContext {
  const url = window.location.href;
  const ids: Record<string, string> = {};
  for (const p of ID_PATTERNS) {
    const m = url.match(p.re);
    const value = m ? m[1] ?? m[2] : null;
    if (value) ids[p.name] = decodeURIComponent(value);
  }

  return {
    url,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    ids,
    sparte: input.sparte ?? null,
    appVersion: input.appVersion ?? null,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language,
    timestamp: new Date().toISOString(),
    referrer: document.referrer,
    reporterEmail: input.reporterEmail ?? null,
  };
}
