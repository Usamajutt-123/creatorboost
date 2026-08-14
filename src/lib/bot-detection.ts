/**
 * Server-authoritative request/bot signal derivation.
 * ----------------------------------------------------------------
 * Everything in this module is computed from data the SERVER observed:
 * the real request headers and the request method/content type. The browser
 * cannot influence any of it through the JSON body.
 *
 * Explicitly NOT trusted (and never read here):
 *   body.userAgent, body.fingerprint, body.timestamp, body.country,
 *   body.cpm, body.earning, body.multiplier, body.fraudScore, body.ip
 *
 * The functions are pure so they are unit-testable without a request object;
 * `deriveRequestSignals()` adapts a real `Headers` instance onto them.
 *
 * DESIGN RULE — risk signals, not blanket blocks.
 * Weak signals (a missing Accept-Language, a shared mobile IP, a slightly
 * unusual header set) only raise the score. Only unambiguous automation
 * markers (an automation UA, a declared headless client hint, a
 * self-identified bot) are treated as hard bot evidence, so legitimate
 * visitors on unusual browsers keep earning for their creator.
 */

/** Maximum accepted body size for the public view endpoint, in bytes. */
export const MAX_VIEW_PAYLOAD_BYTES = 4_096;

export type HeaderSignals = {
  /** Unambiguous automation/bot evidence derived from headers. */
  isBot: boolean;
  /** Headless/automation framework evidence specifically. */
  isEmulator: boolean;
  /** 0-100 risk contribution. */
  score: number;
  /** Internal, admin-only reason codes. Never sent to creators/visitors. */
  reasons: string[];
};

/**
 * Automation frameworks and headless runtimes.
 * Matched against the SERVER-side user-agent header only.
 */
const AUTOMATION_UA_RE =
  /headless|phantomjs|phantom\.js|selenium|webdriver|chromedriver|geckodriver|puppeteer|playwright|cypress|nightmare|electron\/|splash|katalon|appium/i;

/** Self-identified non-browser clients / libraries. */
const LIBRARY_UA_RE =
  /\bbot\b|crawler|spider|scrapy|wget|curl\/|libwww|python-requests|python-urllib|aiohttp|httpx|okhttp|axios|node-fetch|got\/|java\/|jakarta|go-http-client|ruby|perl|powershell|winhttp|httpclient|postman|insomnia|apache-httpclient|lighthouse|pagespeed|gtmetrix|uptime|pingdom|monitor/i;

/** Markers a real browser navigation always carries in some form. */
const BROWSER_UA_RE = /mozilla\/|applewebkit|gecko\/|trident|edge?\/|opr\/|chrome\/|safari\/|firefox\//i;

function normalizeHeaderValue(value: string | null | undefined): string {
  return (value || '').trim();
}

/**
 * Analyse the request headers a browser must realistically produce.
 *
 * `fetch()` from a real page carries: a browser UA, an Accept header, an
 * Accept-Language, and (on Chromium) Sec-Fetch-* metadata. Automation stacks
 * routinely omit several of these or produce impossible combinations.
 */
export function analyzeRequestHeaders(input: {
  userAgent?: string | null;
  accept?: string | null;
  acceptLanguage?: string | null;
  acceptEncoding?: string | null;
  secFetchSite?: string | null;
  secFetchMode?: string | null;
  secFetchDest?: string | null;
  secChUa?: string | null;
  secChUaMobile?: string | null;
  secChUaPlatform?: string | null;
  origin?: string | null;
  referer?: string | null;
  connection?: string | null;
}): HeaderSignals {
  const ua = normalizeHeaderValue(input.userAgent);
  const lowerUa = ua.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  let isBot = false;
  let isEmulator = false;

  // ---- 1. Hard automation evidence -------------------------------------
  if (AUTOMATION_UA_RE.test(lowerUa)) {
    isBot = true;
    isEmulator = true;
    score = Math.max(score, 95);
    reasons.push('automation_ua');
  }
  if (LIBRARY_UA_RE.test(lowerUa)) {
    isBot = true;
    score = Math.max(score, 95);
    reasons.push('non_browser_client');
  }
  if (!ua) {
    isBot = true;
    score = Math.max(score, 90);
    reasons.push('missing_ua');
  } else if (ua.length < 20) {
    isBot = true;
    score = Math.max(score, 70);
    reasons.push('short_ua');
  } else if (!BROWSER_UA_RE.test(lowerUa)) {
    // Claims to be neither a known library nor a browser engine.
    isBot = true;
    score = Math.max(score, 75);
    reasons.push('non_browser_ua');
  }

  // Chromium client hints are server-observed and cannot be forged by page JS
  // on the CreatorBoost origin. A UA-CH brand list advertising a headless
  // build is unambiguous automation.
  const secChUa = normalizeHeaderValue(input.secChUa).toLowerCase();
  if (secChUa && /headless/.test(secChUa)) {
    isBot = true;
    isEmulator = true;
    score = Math.max(score, 95);
    reasons.push('headless_client_hint');
  }

  // ---- 2. Missing / inconsistent browser headers (risk signals) --------
  const accept = normalizeHeaderValue(input.accept);
  const acceptLanguage = normalizeHeaderValue(input.acceptLanguage);
  const acceptEncoding = normalizeHeaderValue(input.acceptEncoding);

  if (!accept) {
    score = Math.max(score, 45);
    reasons.push('missing_accept');
  }
  if (!acceptLanguage) {
    // Some privacy browsers strip this, so it is a signal and never a block.
    score = Math.max(score, 40);
    reasons.push('missing_accept_language');
  }
  if (!acceptEncoding) {
    score = Math.max(score, 35);
    reasons.push('missing_accept_encoding');
  }

  // Sec-Fetch-* is emitted by every current Chromium/Firefox/Safari build for
  // a same-origin fetch. Its absence alongside a Chrome UA is contradictory.
  const secFetchSite = normalizeHeaderValue(input.secFetchSite).toLowerCase();
  const secFetchMode = normalizeHeaderValue(input.secFetchMode).toLowerCase();
  const claimsModernChromium = /chrome\/(\d+)/i.test(lowerUa) && !/edg[ae]?\//i.test(lowerUa);
  if (claimsModernChromium && !secFetchSite && !secFetchMode) {
    score = Math.max(score, 55);
    reasons.push('missing_fetch_metadata');
  }
  // Chromium always sends Sec-CH-UA on secure origins; a Chrome UA without it
  // is a common signature of a spoofed UA string on a non-Chromium client.
  if (claimsModernChromium && !secChUa && (secFetchSite || secFetchMode)) {
    score = Math.max(score, 40);
    reasons.push('missing_client_hints');
  }

  // A same-origin XHR from the unlock page must be cross-site=false.
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'same-site' && secFetchSite !== 'none') {
    score = Math.max(score, 50);
    reasons.push('cross_site_request');
  }

  // ---- 3. Impossible browser combinations ------------------------------
  const platform = normalizeHeaderValue(input.secChUaPlatform).toLowerCase().replace(/"/g, '');
  const mobileHint = normalizeHeaderValue(input.secChUaMobile).toLowerCase();
  const uaSaysMobile = /android|iphone|ipad|ipod|mobile/i.test(lowerUa);
  const uaSaysWindows = /windows nt/i.test(lowerUa);
  const uaSaysMac = /macintosh|mac os x/i.test(lowerUa);
  const uaSaysAndroid = /android/i.test(lowerUa);
  const uaSaysIos = /iphone|ipad|ipod/i.test(lowerUa);

  if (mobileHint === '?1' && !uaSaysMobile) {
    score = Math.max(score, 55);
    reasons.push('mobile_hint_mismatch');
  }
  if (platform) {
    const platformConflict =
      (platform === 'windows' && !uaSaysWindows) ||
      (platform === 'android' && !uaSaysAndroid) ||
      (platform === 'macos' && !uaSaysMac && !uaSaysIos) ||
      (platform === 'ios' && !uaSaysIos);
    if (platformConflict) {
      score = Math.max(score, 55);
      reasons.push('platform_hint_mismatch');
    }
  }
  // A UA cannot legitimately be two mutually exclusive operating systems.
  if ((uaSaysWindows && uaSaysAndroid) || (uaSaysWindows && uaSaysIos) || (uaSaysAndroid && uaSaysIos)) {
    score = Math.max(score, 70);
    reasons.push('impossible_ua_combination');
  }
  // Trident (IE) with a modern Chrome build number is a fabricated string.
  if (/trident/i.test(lowerUa) && /chrome\/(\d{2,})/i.test(lowerUa)) {
    score = Math.max(score, 70);
    reasons.push('impossible_ua_combination');
  }

  return { isBot, isEmulator, score: Math.max(0, Math.min(100, score)), reasons };
}

/** Adapter over a real `Headers` object (route handlers, middleware). */
export function deriveRequestSignals(headers: Headers): HeaderSignals {
  return analyzeRequestHeaders({
    userAgent: headers.get('user-agent'),
    accept: headers.get('accept'),
    acceptLanguage: headers.get('accept-language'),
    acceptEncoding: headers.get('accept-encoding'),
    secFetchSite: headers.get('sec-fetch-site'),
    secFetchMode: headers.get('sec-fetch-mode'),
    secFetchDest: headers.get('sec-fetch-dest'),
    secChUa: headers.get('sec-ch-ua'),
    secChUaMobile: headers.get('sec-ch-ua-mobile'),
    secChUaPlatform: headers.get('sec-ch-ua-platform'),
    origin: headers.get('origin'),
    referer: headers.get('referer'),
    connection: headers.get('connection'),
  });
}

/**
 * Validate the transport-level shape of a public JSON POST.
 * Returns an HTTP status + safe message when the request must be rejected.
 *
 * The visitor-facing message never explains which security rule fired.
 */
export function validateJsonRequestEnvelope(input: {
  method: string;
  contentType: string | null;
  contentLength: string | null;
  maxBytes?: number;
}): { ok: true } | { ok: false; status: number; error: string; reason: string } {
  const maxBytes = input.maxBytes ?? MAX_VIEW_PAYLOAD_BYTES;

  if (input.method.toUpperCase() !== 'POST') {
    return { ok: false, status: 405, error: 'Method not allowed', reason: 'method_not_allowed' };
  }

  const contentType = (input.contentType || '').toLowerCase();
  // `application/json` optionally followed by parameters (charset, boundary…).
  if (!contentType.startsWith('application/json')) {
    return { ok: false, status: 415, error: 'Unsupported content type', reason: 'bad_content_type' };
  }

  if (input.contentLength != null && input.contentLength !== '') {
    const declared = Number(input.contentLength);
    if (!Number.isFinite(declared) || declared < 0) {
      return { ok: false, status: 400, error: 'Invalid request', reason: 'bad_content_length' };
    }
    if (declared > maxBytes) {
      return { ok: false, status: 413, error: 'Request payload is too large', reason: 'payload_too_large' };
    }
  }

  return { ok: true };
}

/** Reject an over-sized body even when Content-Length was absent or lied. */
export function exceedsPayloadLimit(raw: string, maxBytes = MAX_VIEW_PAYLOAD_BYTES): boolean {
  // Byte length, not code-unit length: a multi-byte payload must not slip past.
  return Buffer.byteLength(raw, 'utf8') > maxBytes;
}

/**
 * Behavioural risk from server-observed activity counters.
 *
 * All inputs are produced by the server (database counts over the `views`
 * table), never by the client. The output is a risk contribution — the
 * earnings engine decides what to do with it, and the 24-hour campaign+IP
 * rule stays independent of this score.
 */
export function scoreBehavior(input: {
  /** Views recorded for this IP across ALL campaigns in the last 15 minutes. */
  recentViews?: number;
  /** Distinct campaigns this IP touched in the last 15 minutes. */
  distinctCampaigns?: number;
  /** Requests for this exact campaign + IP in the last 15 minutes. */
  campaignRepeats?: number;
  /** Seconds between the visitor loading the campaign and submitting. */
  sessionSeconds?: number | null;
  /** Number of tasks the campaign requires. */
  requiredTasks?: number;
}): { score: number; reasons: string[]; isRepeat: boolean } {
  const reasons: string[] = [];
  let score = 0;
  let isRepeat = false;

  const recent = Math.max(0, Number(input.recentViews) || 0);
  const campaigns = Math.max(0, Number(input.distinctCampaigns) || 0);
  const repeats = Math.max(0, Number(input.campaignRepeats) || 0);

  // Excessive request frequency. A shared/NAT IP can legitimately produce a
  // handful of views, so the low bands stay well under any blocking threshold.
  if (recent > 40) {
    score = Math.max(score, 80);
    isRepeat = true;
    reasons.push('frequency_abuse');
  } else if (recent > 15) {
    score = Math.max(score, 50);
    isRepeat = true;
    reasons.push('frequent_visits');
  } else if (recent > 5) {
    score = Math.max(score, 25);
    isRepeat = true;
    reasons.push('repeated_visits');
  }

  // Rapid campaign switching: one IP sweeping many campaigns in minutes.
  if (campaigns > 12) {
    score = Math.max(score, 75);
    reasons.push('rapid_campaign_switching');
  } else if (campaigns > 6) {
    score = Math.max(score, 45);
    reasons.push('campaign_switching');
  }

  // Repeated reloads of the SAME campaign from one IP. This is a risk signal
  // only — the 24h rule already makes the extra views unpaid.
  if (repeats > 10) {
    score = Math.max(score, 70);
    isRepeat = true;
    reasons.push('reload_pattern');
  } else if (repeats > 4) {
    score = Math.max(score, 40);
    isRepeat = true;
    reasons.push('repeated_reloads');
  }

  // Impossible completion speed: opening N task links and returning cannot
  // realistically happen in under ~1.5s per task.
  const sessionSeconds = input.sessionSeconds;
  const requiredTasks = Math.max(0, Number(input.requiredTasks) || 0);
  if (typeof sessionSeconds === 'number' && Number.isFinite(sessionSeconds) && requiredTasks > 0) {
    if (sessionSeconds < 0) {
      score = Math.max(score, 60);
      reasons.push('impossible_timing');
    } else if (sessionSeconds < requiredTasks * 1.5) {
      score = Math.max(score, 60);
      reasons.push('instant_completion');
    } else if (sessionSeconds < requiredTasks * 3) {
      score = Math.max(score, 30);
      reasons.push('fast_completion');
    } else if (sessionSeconds > 6 * 3600) {
      // A session open for many hours before submitting is stale/abnormal.
      score = Math.max(score, 30);
      reasons.push('abnormal_session_duration');
    }
  }

  return { score: Math.max(0, Math.min(100, score)), reasons, isRepeat };
}
