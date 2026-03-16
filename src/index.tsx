export interface RecordVerifyConfig {
  apiKey: string;
  hostedUrl?: string;
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

const DEFAULT_HOSTED_URL = 'https://record-infra-frontend.vercel.app';
const MODAL_ID = '__record_verify_modal__';
const KEYFRAMES_ID = '__record_verify_kf__';

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

function buildModalShell(): { overlay: HTMLDivElement; modal: HTMLDivElement; loader: HTMLDivElement } {
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

export class RecordVerify {
  private readonly apiKey: string;
  private readonly hostedUrl: string;
  private readonly hostedOrigin: string;
  private msgHandler: ((e: MessageEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(config: RecordVerifyConfig) {
    if (!config.apiKey) throw new Error('[RecordVerify] apiKey is required');
    this.apiKey = config.apiKey;
    this.hostedUrl = (config.hostedUrl ?? DEFAULT_HOSTED_URL).replace(/\/$/, '');
    this.hostedOrigin = new URL(this.hostedUrl).origin;
  }

  open(options: RecordVerifyOpenOptions): void {
    if (!options.session) throw new Error('[RecordVerify] session is required');
    if (!options.recordVerificationId) throw new Error('[RecordVerify] recordVerificationId is required');

    removeModal();
    injectKeyframes();

    const iframeUrl = new URL(this.hostedUrl);
    iframeUrl.searchParams.set('session', options.session);
    iframeUrl.searchParams.set('recordVerificationId', options.recordVerificationId);
    iframeUrl.searchParams.set('apiKey', this.apiKey);
    iframeUrl.searchParams.set('theme', options.theme ?? 'light');
    iframeUrl.searchParams.set('origin', window.location.origin);
    if (options.candidateName) iframeUrl.searchParams.set('candidateName', options.candidateName);

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
      // ─── Verification route ───
      if (!options.session) throw new Error('[RecordVerify] session is required for verification');
      if (!options.recordVerificationId) throw new Error('[RecordVerify] recordVerificationId is required for verification');

      const url = new URL(`${this.hostedUrl}/step1`);
      url.searchParams.set('session', options.session);
      url.searchParams.set('recordVerificationId', options.recordVerificationId);
      url.searchParams.set('apiKey', this.apiKey);
      url.searchParams.set('theme', options.theme ?? 'light');
      url.searchParams.set('origin', window.location.origin);
      if (options.candidateName) url.searchParams.set('candidateName', options.candidateName);
      iframeSrc = url.toString();

    } else if (options.type === 'skillActivity') {
      // ─── Skill activity route ───
      if (!options.skillId) throw new Error('[RecordVerify] skillId is required for skillActivity');
      if (!options.recordUserId) throw new Error('[RecordVerify] recordUserId is required for skillActivity');

      const url = new URL(`${this.hostedUrl}/skill-activity`);
      url.searchParams.set('skillId', options.skillId);
      url.searchParams.set('recordUserId', options.recordUserId);
      iframeSrc = url.toString();

    } else {
      throw new Error('[RecordVerify] invalid type — must be "verification" or "skillActivity"');
    }

    // ─── Shared modal shell ───
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

    // ─── postMessage listener ───
    this.msgHandler = (event: MessageEvent) => {
      // For verification — strict origin check
      if (options.type === 'verification' && event.origin !== this.hostedOrigin) return;

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

    // ─── Escape key ───
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
        options.onClose?.();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  close(): void {
    const overlay = document.getElementById(MODAL_ID);
    if (overlay) {
      const modal = overlay.querySelector('div') as HTMLElement;
      overlay.style.animation = 'recordFadeOut 0.2s ease forwards';
      if (modal) modal.style.animation = 'recordSlideDown 0.2s ease forwards';
      setTimeout(() => removeModal(), 200);
    }
    document.body.style.overflow = '';
    if (this.msgHandler) { window.removeEventListener('message', this.msgHandler); this.msgHandler = null; }
    if (this.keyHandler) { window.removeEventListener('keydown', this.keyHandler); this.keyHandler = null; }
  }
}

export default RecordVerify;