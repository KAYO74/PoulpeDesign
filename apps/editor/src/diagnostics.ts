import { isDesktop } from './io';
import {
  cpuName,
  cpuThreads,
  getPerf,
  memoryBudgetMb,
  readSystemMemory,
  threadCount,
  usedMemoryMb,
} from './preferences';

/*
 * Diagnostic (Préférences > Diagnostic, Aide > Diagnostic) : carte graphique vue par le moteur web,
 * prise en charge de WebGL et WebGPU, processeur et mémoire. Le rapport se copie pour être joint à
 * un signalement de problème.
 */

export interface GpuInfo {
  /** Fabricant et modèle de la carte graphique, tels que le moteur web les donne. */
  vendor: string | null;
  renderer: string | null;
  /** Version de WebGL et du langage de shaders (le pilote est souvent cité dans le modèle). */
  version: string | null;
  maxTextureSize: number | null;
  /** Rendu logiciel (sans carte graphique) détecté. */
  software: boolean;
  /**
   * Nom inventé par le moteur web pour ne pas révéler la carte : WebKit (Linux, macOS) répond
   * toujours « Apple GPU ». La vraie carte est alors celle que liste le moteur Rust.
   */
  masked: boolean;
}

export interface DiagnosticReport {
  app: string;
  platform: string;
  userAgent: string;
  webgl1: boolean;
  webgl2: boolean;
  /** Carte graphique choisie par défaut, pour les performances, pour l'économie d'énergie. */
  gpu: GpuInfo | null;
  gpuHighPerformance: GpuInfo | null;
  gpuLowPower: GpuInfo | null;
  webgpu: string | null;
  /** Modèle du processeur (appli de bureau), ou null. */
  cpu: string | null;
  cores: number;
  threads: number;
  multithreading: boolean;
  systemMemoryMb: number | null;
  availableMemoryMb: number | null;
  usedMemoryMb: number | null;
  memoryBudgetMb: number;
  screen: string;
}

const MASKED = /^Apple GPU$/;
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

function gpuInfo(kind: 'webgl2' | 'webgl', powerPreference: WebGLPowerPreference): GpuInfo | null {
  const canvas = document.createElement('canvas');
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext(kind, { powerPreference, failIfMajorPerformanceCaveat: false }) as
      WebGLRenderingContext | WebGL2RenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
  const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const info: GpuInfo = {
    vendor,
    renderer,
    version: `${gl.getParameter(gl.VERSION)} · ${gl.getParameter(gl.SHADING_LANGUAGE_VERSION)}`,
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || null,
    software: SOFTWARE.test(renderer),
    masked: MASKED.test(renderer) && !/Mac OS X/.test(navigator.userAgent),
  };
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return info;
}

async function webgpuInfo(): Promise<string | null> {
  type Adapter = { info?: { vendor?: string; architecture?: string; description?: string } };
  const gpu = (navigator as { gpu?: { requestAdapter(o?: object): Promise<Adapter | null> } }).gpu;
  if (!gpu) return null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const i = adapter.info ?? {};
    return [i.vendor, i.architecture, i.description].filter(Boolean).join(' · ') || '✓';
  } catch {
    return null;
  }
}

function platformName(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Linux/.test(ua)
        ? 'Linux'
        : '?';
  return `${os} · ${isDesktop() ? 'appli de bureau' : 'navigateur'}`;
}

export async function runDiagnostic(): Promise<DiagnosticReport> {
  const mem = await readSystemMemory();
  const kind = document.createElement('canvas').getContext('webgl2') ? 'webgl2' : 'webgl';
  const p = getPerf();
  return {
    app: `Poulpe Design ${__APP_VERSION__}`,
    platform: platformName(),
    userAgent: navigator.userAgent,
    webgl1: !!document.createElement('canvas').getContext('webgl'),
    webgl2: kind === 'webgl2',
    gpu: gpuInfo(kind, 'default'),
    gpuHighPerformance: gpuInfo(kind, 'high-performance'),
    gpuLowPower: gpuInfo(kind, 'low-power'),
    webgpu: await webgpuInfo(),
    cpu: cpuName(),
    cores: cpuThreads(),
    threads: self.crossOriginIsolated ? threadCount(p) : 1,
    multithreading: self.crossOriginIsolated,
    systemMemoryMb: mem.totalMb,
    availableMemoryMb: mem.availableMb,
    usedMemoryMb: usedMemoryMb(),
    memoryBudgetMb: memoryBudgetMb(p),
    screen: `${screen.width} × ${screen.height} · ×${window.devicePixelRatio || 1}`,
  };
}

/** Nombre de cartes graphiques différentes vues par le moteur web. */
export function distinctGpus(r: DiagnosticReport): number {
  return new Set([r.gpu, r.gpuHighPerformance, r.gpuLowPower].filter(Boolean).map((g) => g!.renderer)).size;
}

const mb = (v: number | null) =>
  v === null ? '—' : v >= 1024 ? `${(v / 1024).toFixed(1)} Go` : `${Math.round(v)} Mo`;

export function formatMb(v: number | null): string {
  return mb(v);
}

/** Rapport en texte brut, à coller dans un signalement de problème. */
export function reportText(r: DiagnosticReport): string {
  const g = (x: GpuInfo | null) =>
    x
      ? `${x.renderer} (${x.vendor}${x.masked ? ', nom masqué par le moteur web' : ''}) · ${x.version} · textures ${x.maxTextureSize}${x.software ? ' · LOGICIEL' : ''}`
      : '—';
  return [
    r.app,
    `Système : ${r.platform}`,
    `Moteur : ${r.userAgent}`,
    `Écran : ${r.screen}`,
    `WebGL 1 : ${r.webgl1 ? 'oui' : 'non'} · WebGL 2 : ${r.webgl2 ? 'oui' : 'non'} · WebGPU : ${r.webgpu ?? 'non'}`,
    `Carte graphique (défaut) : ${g(r.gpu)}`,
    `Carte graphique (performances) : ${g(r.gpuHighPerformance)}`,
    `Carte graphique (économie) : ${g(r.gpuLowPower)}`,
    `Processeur : ${r.cpu ? `${r.cpu} · ` : ''}${r.cores} cœurs · threads de calcul : ${r.threads}${r.multithreading ? '' : isDesktop() ? ' dans la page (le moteur Rust utilise tous les cœurs)' : ' (multi-thread indisponible)'}`,
    `Mémoire : ordinateur ${mb(r.systemMemoryMb)}, libre ${mb(r.availableMemoryMb)}, utilisée par Poulpe Design ${mb(r.usedMemoryMb)}, budget ${mb(r.memoryBudgetMb)}`,
  ].join('\n');
}
