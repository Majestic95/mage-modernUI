import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerImageCache } from './registerImageCache';

describe('registerImageCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('does nothing in dev (PROD=false)', () => {
    vi.stubEnv('PROD', false);
    const register = vi.fn();
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    registerImageCache();
    expect(register).not.toHaveBeenCalled();
  });

  it('does nothing when serviceWorker is unavailable', () => {
    vi.stubEnv('PROD', true);
    vi.stubGlobal('navigator', {});
    // Should not throw.
    expect(() => registerImageCache()).not.toThrow();
  });

  it('registers /sw.js in production', () => {
    vi.stubEnv('PROD', true);
    const register = vi.fn().mockResolvedValue({});
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    registerImageCache();
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('swallows registration rejections (no unhandled promise)', async () => {
    vi.stubEnv('PROD', true);
    const register = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    // Should not throw synchronously.
    expect(() => registerImageCache()).not.toThrow();
    // Give the rejection a tick to settle without crashing the test runner.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(register).toHaveBeenCalled();
  });
});
