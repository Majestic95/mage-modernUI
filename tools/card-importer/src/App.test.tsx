import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import type { NativeRuntimeWindow } from './nativeRepoScanner';

describe('App checkout picker', () => {
  afterEach(() => {
    delete (window as NativeRuntimeWindow).__TAURI_INTERNALS__;
  });

  it('shows the browser fallback outside Tauri', () => {
    render(<App />);

    expect(screen.getByText(/Browser fallback:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose repo folder' })).not.toBeInTheDocument();
  });

  it('hides the browser fallback in Tauri and shows the native picker', () => {
    (window as NativeRuntimeWindow).__TAURI_INTERNALS__ = {};

    render(<App />);

    expect(screen.getByRole('button', { name: 'Choose repo folder' })).toBeInTheDocument();
    expect(screen.queryByText(/Browser fallback:/)).not.toBeInTheDocument();
  });
});
