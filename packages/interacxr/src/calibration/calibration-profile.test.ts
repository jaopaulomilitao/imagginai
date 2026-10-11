import { describe, expect, it } from 'vitest';

import { CalibrationProfile, DEFAULT_CALIBRATION } from './calibration-profile';

describe('CalibrationProfile', () => {
  it('defaults to a 50° vertical FOV and a 1.0 m plane', () => {
    expect(new CalibrationProfile().toJSON()).toEqual(DEFAULT_CALIBRATION);
  });

  it('sizes the plane from the real camera FOV (h = 2·d·tan(fov/2), w = h·aspect)', () => {
    const plane = new CalibrationProfile().projectionPlane(1280, 720);

    expect(plane.distanceM).toBe(1);
    expect(plane.heightM).toBeCloseTo(2 * Math.tan((25 * Math.PI) / 180), 10);
    expect(plane.widthM).toBeCloseTo(plane.heightM * (1280 / 720), 10);
  });

  it('keeps the same angular size at any distance', () => {
    const profile = new CalibrationProfile({ camVFovDeg: 60 });
    const near = profile.projectionPlane(1280, 720, 1);
    const far = profile.projectionPlane(1280, 720, 50);

    expect(far.heightM / far.distanceM).toBeCloseTo(near.heightM / near.distanceM, 10);
  });

  it('maps landmarks onto the same plane used by the video', () => {
    const profile = new CalibrationProfile();
    const plane = profile.projectionPlane(1280, 720);

    expect(profile.mapLandmark({ x: 0.5, y: 0.5, z: 0 }, plane)).toEqual({ x: 0, y: -0, z: -1 });
    const corner = profile.mapLandmark({ x: 1, y: 0, z: 0 }, plane);
    expect(corner.x).toBeCloseTo(plane.widthM / 2, 10);
    expect(corner.y).toBeCloseTo(plane.heightM / 2, 10);
  });

  it('rejects implausible settings', () => {
    expect(() => new CalibrationProfile({ camVFovDeg: 5 })).toThrow(RangeError);
    expect(() => new CalibrationProfile({ planeDistanceM: 0 })).toThrow(RangeError);
    expect(() => new CalibrationProfile().projectionPlane(0, 720)).toThrow(RangeError);
  });
});
