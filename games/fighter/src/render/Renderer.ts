import * as THREE from 'three';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  maxPixelRatio?: number;
}

/** Owns the WebGLRenderer and keeps it sized to the window. */
export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  private readonly cameras = new Set<THREE.PerspectiveCamera>();
  private pixelRatio: number;
  private readonly minPixelRatio = 1;
  private slowTime = 0;
  private sampleTime = 0;
  private sampleFrames = 0;

  constructor({ canvas, maxPixelRatio = 2 }: RendererOptions) {
    this.pixelRatio = Math.min(window.devicePixelRatio, maxPixelRatio);
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.webgl.setPixelRatio(this.pixelRatio);
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.05;
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  attachCamera(camera: THREE.PerspectiveCamera): void {
    this.cameras.add(camera);
    this.resize();
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.webgl.render(scene, camera);
  }

  /**
   * Adaptive resolution: if the frame rate stays under ~50 FPS for two
   * seconds, lower the pixel ratio a step (never below 1).
   */
  adapt(frameDt: number): void {
    this.sampleTime += frameDt;
    this.sampleFrames++;
    if (this.sampleTime < 0.5) return;
    const fps = this.sampleFrames / this.sampleTime;
    this.sampleTime = 0;
    this.sampleFrames = 0;
    this.slowTime = fps < 50 ? this.slowTime + 0.5 : 0;
    if (this.slowTime >= 2 && this.pixelRatio > this.minPixelRatio) {
      this.pixelRatio = Math.max(this.minPixelRatio, this.pixelRatio - 0.25);
      this.webgl.setPixelRatio(this.pixelRatio);
      this.resize();
      this.slowTime = 0;
    }
  }

  private readonly resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.webgl.setSize(w, h, false);
    for (const cam of this.cameras) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
  };

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.webgl.dispose();
  }
}
