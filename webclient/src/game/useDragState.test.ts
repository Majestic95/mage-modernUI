import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDragState } from './useDragState';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * Slice 70-F — the drag-state machine extracted from Battlefield
 * ahead of the MyHand region split. This test pins the contract
 * the hook owes its consumers: a press anchors but doesn't yet
 * commit; a 5px movement crosses the threshold + commits drag
 * state; pointerup clears.
 */
describe('useDragState', () => {
  function fakePointerEvent(opts: {
    button?: number;
    pointerId?: number;
    clientX: number;
    clientY: number;
  }): ReactPointerEvent {
    return {
      button: opts.button ?? 0,
      pointerId: opts.pointerId ?? 1,
      clientX: opts.clientX,
      clientY: opts.clientY,
    } as unknown as ReactPointerEvent;
  }

  it('initial state — drag is null', () => {
    const { result } = renderHook(() => useDragState());
    expect(result.current.drag).toBeNull();
  });

  it('press anchors but does NOT yet enter drag state (sub-threshold movement keeps it a click)', () => {
    const { result } = renderHook(() => useDragState());
    act(() => {
      result.current.beginHandPress(
        'card-1',
        fakePointerEvent({ clientX: 100, clientY: 100 }),
      );
    });
    // No movement → drag still null. Anchor exists in the ref
    // (internal state); drag state only commits when movement
    // crosses the 5px threshold.
    expect(result.current.drag).toBeNull();
  });

  it('movement past 5px threshold transitions to drag state', () => {
    const { result } = renderHook(() => useDragState());
    act(() => {
      result.current.beginHandPress(
        'card-1',
        fakePointerEvent({ clientX: 100, clientY: 100 }),
      );
    });
    act(() => {
      // 10px right — past threshold.
      const ev = new PointerEvent('pointermove', {
        clientX: 110,
        clientY: 100,
        pointerId: 1,
      });
      document.dispatchEvent(ev);
    });
    expect(result.current.drag).toEqual({
      cardId: 'card-1',
      x: 110,
      y: 100,
    });
  });

  it('pointerup clears drag state', () => {
    const { result } = renderHook(() => useDragState());
    act(() => {
      result.current.beginHandPress(
        'card-1',
        fakePointerEvent({ clientX: 100, clientY: 100 }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 200,
          clientY: 200,
          pointerId: 1,
        }),
      );
    });
    expect(result.current.drag).not.toBeNull();
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup'));
    });
    expect(result.current.drag).toBeNull();
  });

  it('non-primary button (right-click) is ignored', () => {
    const { result } = renderHook(() => useDragState());
    act(() => {
      result.current.beginHandPress(
        'card-1',
        fakePointerEvent({ button: 2, clientX: 100, clientY: 100 }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 200,
          clientY: 200,
          pointerId: 1,
        }),
      );
    });
    // Press never anchored; movement does nothing.
    expect(result.current.drag).toBeNull();
  });

  it('pointercancel also clears drag state (touch-cancel safety)', () => {
    const { result } = renderHook(() => useDragState());
    act(() => {
      result.current.beginHandPress(
        'card-1',
        fakePointerEvent({ clientX: 100, clientY: 100 }),
      );
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 200,
          clientY: 200,
          pointerId: 1,
        }),
      );
    });
    expect(result.current.drag).not.toBeNull();
    act(() => {
      document.dispatchEvent(new PointerEvent('pointercancel'));
    });
    expect(result.current.drag).toBeNull();
  });
});
