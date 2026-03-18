export interface RecordVerifyConfig {
  apiKey: string;
  hostedUrl?: string;
  /**
   * Your backend base URL — used to reach the signing endpoint.
   * e.g. "https://api.yourapp.com/api/v1"
   * Defaults to the same origin as hostedUrl if omitted.
   */
  apiBaseUrl?: string;
}

export interface RecordVerifyOpenOptions {
  session: string;
  recordVerificationId: string;
  candidateName?: string;
  theme?: 'light' | 'dark';
  onSuccess?: (data: VerificationSuccessData) => void;
  onFailure?: (error: VerificationError) => void;
  onClose?: () => void;
  onStepChange?: (step: VerificationStep) => void;
}

export interface RecordVerifyOpenUrlOptions {
  type: 'verification' | 'skillActivity';
  // For type: 'verification'
  session?: string;
  recordVerificationId?: string;
  candidateName?: string;
  theme?: 'light' | 'dark';
  onSuccess?: (data: VerificationSuccessData) => void;
  onFailure?: (error: VerificationError) => void;
  onStepChange?: (step: VerificationStep) => void;
  // For type: 'skillActivity'
  skillId?: string;
  recordUserId?: string;
  // Common
  onClose?: () => void;
}

export interface VerificationSuccessData {
  recordVerificationId: string;
  recordUserId: string;
  verifiedSkills: string[];
  score?: number;
  method: string;
  completedAt: string;
}

export interface VerificationError {
  code: string;
  message: string;
}

export type VerificationStep =
  | 'skills'
  | 'method'
  | 'documents'
  | 'assessment'
  | 'review'
  | 'complete';

type PostMessage =
  | { event: 'record:verification.success'; data: VerificationSuccessData }
  | { event: 'record:verification.failed'; error: VerificationError }
  | { event: 'record:verification.close' }
  | { event: 'record:step.change'; step: VerificationStep }
  | { event: 'record:ready' };

// ─── Signed headers shape ────────────────────────────────────────────────────
interface SignedHeaders {
  'x-api-key': string;
  'x-signature': string;
  'x-timestamp': string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_HOSTED_URL = 'https://record-infra-frontend.vercel.app';
const MODAL_ID           = '__record_verify_modal__';
const KEYFRAMES_ID       = '__record_verify_kf__';

const KEYFRAMES = `
  @keyframes recordFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes recordFadeOut {
    from { opacity: 1; }
    to   { opacity: 0; }
  }
  @keyframes recordSlideUp {
    from { transform: translateY(40px) scale(0.97); opacity: 0; }
    to   { transform: translateY(0)    scale(1);    opacity: 1; }
  }
  @keyframes recordSlideDown {
    from { transform: translateY(0)    scale(1);    opacity: 1; }
    to   { transform: translateY(30px) scale(0.97); opacity: 0; }
  }
  @keyframes recordSpin { to { transform: rotate(360deg) } }
`;

// ─── DOM helpers ─────────────────────────────────────────────────────────────
function injectKeyframes(): void {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

function removeModal(): void {
  const el = document.getElementById(MODAL_ID);
  if (el) el.remove();
}

function buildModalShell(): {
  overlay: HTMLDivElement;
  modal: HTMLDivElement;
  loader: HTMLDivElement;
} {
  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.style.cssText = [
    'position:fixed', 'inset:0',
    'background:rgba(0,0,0,0.65)',
    'z-index:99999',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'animation:recordFadeIn 0.25s ease',
  ].join(';');

  const modal = document.createElement('div');
  modal.style.cssText = [
    'width:1002px',
    'max-width:95vw',
    'background:#fff',
    'border-radius:8px',
    'overflow:hidden',
    'box-shadow:0 4px 40px rgba(0,0,0,0.4)',
    'animation:recordSlideUp 0.3s cubic-bezier(0.34,1.56,0.64,1)',
  ].join(';');

  const loader = document.createElement('div');
  loader.style.cssText =
    'height:590px;display:flex;align-items:center;justify-content:center;background:#fff;';
  loader.innerHTML =
    '<div style="width:32px;height:32px;border:3px solid #e5e7eb;border-top-color:#022c22;border-radius:50%;animation:recordSpin 0.7s linear infinite;"></div>';

  return { overlay, modal, loader };
}

function buildIframe(src: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.width = '100%';
  iframe.height = '590';
  iframe.allow = 'camera; microphone';
  iframe.style.cssText = 'border:none;display:none;';
  return iframe;
}

// ─── SDK class ────────────────────────────────────────────────────────────────
export class RecordVerify {
  private readonly apiKey: string;
  private readonly hostedUrl: string;
  private readonly hostedOrigin: string;
  /**
   * Base URL used to reach your backend, e.g. "https://api.yourapp.com/api/v1".
   * The SDK calls `<apiBaseUrl>/verify/sign` to obtain request signatures.
   */
  private readonly apiBaseUrl: string;
  /** The path prefix extracted from apiBaseUrl, e.g. "/api/v1" */
  private readonly apiBasePath: string;

  private msgHandler: ((e: MessageEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(config: RecordVerifyConfig) {
    if (!config.apiKey) throw new Error('[RecordVerify] apiKey is required');

    this.apiKey      = config.apiKey;
    this.hostedUrl   = (config.hostedUrl ?? DEFAULT_HOSTED_URL).replace(/\/$/, '');
    this.hostedOrigin = new URL(this.hostedUrl).origin;

    // Default apiBaseUrl to the hosted origin's /api/v1 path when not provided
    this.apiBaseUrl  = (config.apiBaseUrl ?? `${this.hostedOrigin}/api/v1`).replace(/\/$/, '');
    this.apiBasePath = new URL(this.apiBaseUrl).pathname.replace(/\/$/, ''); // e.g. "/api/v1"
  }

  // ─── Request signing ───────────────────────────────────────────────────────
  /**
   * Calls your backend's `/verify/sign` endpoint (mirrors the `signRequest`
   * utility used in your Next.js frontend) and returns the three auth headers.
   *
   * @param method  HTTP verb, e.g. "GET" or "POST"
   * @param url     Path relative to apiBasePath, e.g. "/humanverification/verify"
   *                OR the full path already including the base prefix.
   * @param body    Optional request body (will be forwarded to the signer).
   */
  private async signRequest(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<SignedHeaders> {
    // Ensure the URL always includes the base prefix so it matches
    // req.originalUrl on the server (same logic as your frontend utility).
    const fullUrl = url.startsWith(this.apiBasePath)
      ? url
      : `${this.apiBasePath}${url}`;

    const res = await fetch(`${this.apiBaseUrl}/verify/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: this.apiKey,
        method: method.toUpperCase(),
        url:    fullUrl,
        body:   body ?? null,
      }),
    });

    if (!res.ok) {
      throw new Error(`[RecordVerify] Failed to obtain request signature (${res.status})`);
    }

    const { signature, timestamp } = (await res.json()) as {
      signature: string;
      timestamp: string;
    };

    return {
      'x-api-key':    this.apiKey,
      'x-signature':  signature,
      'x-timestamp':  timestamp,
    };
  }

  /**
   * Generic signed fetch helper — use this whenever the SDK needs to call
   * your backend directly (e.g. future server-side validation calls).
   *
   * @param method   HTTP verb
   * @param path     Path relative to apiBasePath
   * @param body     Optional JSON body
   */
  async fetch<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const signed = await this.signRequest(method, path, body);

    const res = await fetch(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...signed,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`[RecordVerify] ${method} ${path} failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // ─── open() ───────────────────────────────────────────────────────────────
  open(options: RecordVerifyOpenOptions): void {
    if (!options.session)
      throw new Error('[RecordVerify] session is required');
    if (!options.recordVerificationId)
      throw new Error('[RecordVerify] recordVerificationId is required');

    removeModal();
    injectKeyframes();

    const iframeUrl = new URL(this.hostedUrl);
    iframeUrl.searchParams.set('session',                options.session);
    iframeUrl.searchParams.set('recordVerificationId',   options.recordVerificationId);
    iframeUrl.searchParams.set('apiKey',                 this.apiKey);
    iframeUrl.searchParams.set('theme',                  options.theme ?? 'light');
    iframeUrl.searchParams.set('origin',                 window.location.origin);
    if (options.candidateName)
      iframeUrl.searchParams.set('candidateName', options.candidateName);

    // Pass the apiBaseUrl so the hosted app can reach the signing endpoint
    iframeUrl.searchParams.set('apiBaseUrl', this.apiBaseUrl);

    const { overlay, modal, loader } = buildModalShell();
    const iframe = buildIframe(iframeUrl.toString());

    iframe.onload = () => {
      loader.style.display = 'none';
      iframe.style.display = 'block';
    };

    modal.appendChild(loader);
    modal.appendChild(iframe);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    this.msgHandler = (event: MessageEvent) => {
      if (event.origin !== this.hostedOrigin) return;
      const msg = event.data as PostMessage;
      if (!msg?.event) return;

      switch (msg.event) {
        case 'record:verification.success':
          this.close();
          options.onSuccess?.(msg.data);
          break;
        case 'record:verification.failed':
          this.close();
          options.onFailure?.(msg.error);
          break;
        case 'record:verification.close':
          this.close();
          options.onClose?.();
          break;
        case 'record:step.change':
          options.onStepChange?.(msg.step);
          break;
      }
    };
    window.addEventListener('message', this.msgHandler);

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        options.onClose?.();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  openUrl(options: RecordVerifyOpenUrlOptions): void {
    removeModal();
    injectKeyframes();

    let iframeSrc: string;

    if (options.type === 'verification') {
      if (!options.session)
        throw new Error('[RecordVerify] session is required for verification');
      if (!options.recordVerificationId)
        throw new Error('[RecordVerify] recordVerificationId is required for verification');

      const url = new URL(`${this.hostedUrl}/step1`);
      url.searchParams.set('session',              options.session);
      url.searchParams.set('recordVerificationId', options.recordVerificationId);
      url.searchParams.set('apiKey',               this.apiKey);
      url.searchParams.set('theme',                options.theme ?? 'light');
      url.searchParams.set('origin',               window.location.origin);
      url.searchParams.set('apiBaseUrl',           this.apiBaseUrl);
      if (options.candidateName)
        url.searchParams.set('candidateName', options.candidateName);

      iframeSrc = url.toString();
    } else if (options.type === 'skillActivity') {
      if (!options.skillId)
        throw new Error('[RecordVerify] skillId is required for skillActivity');
      if (!options.recordUserId)
        throw new Error('[RecordVerify] recordUserId is required for skillActivity');

      const url = new URL(`${this.hostedUrl}/skillactivity`);
      url.searchParams.set('skillId',      options.skillId);
      url.searchParams.set('recordUserId', options.recordUserId);
      url.searchParams.set('apiBaseUrl',   this.apiBaseUrl);

      iframeSrc = url.toString();
    } else {
      throw new Error('[RecordVerify] invalid type — must be "verification" or "skillActivity"');
    }

    const { overlay, modal, loader } = buildModalShell();
    const iframe = buildIframe(iframeSrc);

    iframe.onload = () => {
      loader.style.display = 'none';
      iframe.style.display = 'block';
    };

    modal.appendChild(loader);
    modal.appendChild(iframe);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    this._attachListeners(options, options.type === 'verification');
  }

  // ─── close() ──────────────────────────────────────────────────────────────
  close(): void {
    const overlay = document.getElementById(MODAL_ID);
    if (overlay) {
      const modal = overlay.querySelector('div') as HTMLElement;
      overlay.style.animation = 'recordFadeOut 0.2s ease forwards';
      if (modal) modal.style.animation = 'recordSlideDown 0.2s ease forwards';
      setTimeout(() => removeModal(), 200);
    }
    document.body.style.overflow = '';
    if (this.msgHandler) {
      window.removeEventListener('message', this.msgHandler);
      this.msgHandler = null;
    }
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }

  // ─── Internal: shared postMessage + keyboard listeners ───────────────────
  private _attachListeners(
    options: RecordVerifyOpenOptions | RecordVerifyOpenUrlOptions,
    strictOrigin = true,
  ): void {
    this.msgHandler = (event: MessageEvent) => {
      if (strictOrigin && event.origin !== this.hostedOrigin) return;

      const msg = event.data as PostMessage;
      if (!msg?.event) return;

      switch (msg.event) {
        case 'record:verification.success':
          this.close();
          options.onSuccess?.(msg.data);
          break;
        case 'record:verification.failed':
          this.close();
          options.onFailure?.(msg.error);
          break;
        case 'record:verification.close':
          this.close();
          options.onClose?.();
          break;
        case 'record:step.change':
          options.onStepChange?.(msg.step);
          break;
      }
    };
    window.addEventListener('message', this.msgHandler);

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        options.onClose?.();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }
}

export default RecordVerify;