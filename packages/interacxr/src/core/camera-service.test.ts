import { describe, expect, it, vi } from 'vitest';

import { CameraService, type CameraDependencies, DEFAULT_CAMERA_OPTIONS } from './camera-service';

function createFakes() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const video = {
    videoWidth: 1280,
    videoHeight: 720,
    srcObject: null as MediaStream | null,
    autoplay: false,
    playsInline: false,
    muted: false,
    play: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(),
  };
  const dependencies: CameraDependencies = {
    getUserMedia: vi.fn(() => Promise.resolve(stream)),
    createVideoElement: () => video as unknown as HTMLVideoElement,
  };
  return { track, stream, video, dependencies };
}

describe('CameraService', () => {
  it('opens a single rear-camera stream for concurrent consumers', async () => {
    const { dependencies } = createFakes();
    const camera = new CameraService(DEFAULT_CAMERA_OPTIONS, dependencies);

    const [first, second] = await Promise.all([camera.start(), camera.start()]);

    expect(first).toBe(second);
    expect(dependencies.getUserMedia).toHaveBeenCalledTimes(1);
    expect(dependencies.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: 'environment' }) as unknown,
      }),
    );
  });

  it('exposes one muted inline video bound to the stream', async () => {
    const { dependencies, stream } = createFakes();
    const camera = new CameraService(DEFAULT_CAMERA_OPTIONS, dependencies);

    const video = await camera.start();

    expect(video.srcObject).toBe(stream);
    expect(video.muted && video.playsInline).toBe(true);
    expect(camera.video).toBe(video);
  });

  it('stops every track and allows a fresh start afterwards', async () => {
    const { dependencies, track } = createFakes();
    const camera = new CameraService(DEFAULT_CAMERA_OPTIONS, dependencies);
    await camera.start();

    camera.stop();
    await camera.start();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(dependencies.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed permission request', async () => {
    const { dependencies } = createFakes();
    const getUserMedia = vi.mocked(dependencies.getUserMedia);
    getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'));
    const camera = new CameraService(DEFAULT_CAMERA_OPTIONS, dependencies);

    await expect(camera.start()).rejects.toThrow('NotAllowedError');
    await expect(camera.start()).resolves.toBeDefined();
  });
});
