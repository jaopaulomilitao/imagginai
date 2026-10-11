export interface CameraServiceOptions {
  facingMode: 'environment' | 'user';
  idealWidth: number;
  idealHeight: number;
}

export const DEFAULT_CAMERA_OPTIONS: CameraServiceOptions = {
  facingMode: 'environment',
  idealWidth: 1280,
  idealHeight: 720,
};

export interface CameraDependencies {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createVideoElement(): HTMLVideoElement;
}

const browserDependencies = (): CameraDependencies => ({
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createVideoElement: () => document.createElement('video'),
});

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });
}

// abre um único fluxo da câmera traseira e o compartilha entre passthrough e rastreamento de mãos
export class CameraService {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private starting: Promise<HTMLVideoElement> | null = null;

  constructor(
    private readonly options: CameraServiceOptions = DEFAULT_CAMERA_OPTIONS,
    private readonly dependencies: CameraDependencies = browserDependencies(),
  ) {}

  get video(): HTMLVideoElement | null {
    return this.videoElement;
  }

  get isRunning(): boolean {
    return this.videoElement !== null;
  }

  // chamadas concorrentes recebem a mesma promessa, garantindo um único getUserMedia
  start(): Promise<HTMLVideoElement> {
    this.starting ??= this.open().catch((error: unknown) => {
      this.starting = null;
      throw error;
    });
    return this.starting;
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.videoElement) this.videoElement.srcObject = null;
    this.stream = null;
    this.videoElement = null;
    this.starting = null;
  }

  private async open(): Promise<HTMLVideoElement> {
    const { facingMode, idealWidth, idealHeight } = this.options;
    const stream = await this.dependencies.getUserMedia({
      audio: false,
      video: { facingMode, width: { ideal: idealWidth }, height: { ideal: idealHeight } },
    });
    const video = this.dependencies.createVideoElement();
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    await waitForMetadata(video);
    await video.play();
    this.stream = stream;
    this.videoElement = video;
    return video;
  }
}
