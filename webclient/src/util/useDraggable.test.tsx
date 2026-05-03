import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDraggable } from './useDraggable';

// jsdom doesn't lay elements out, so getBoundingClientRect returns
// zeros by default. Patch it to derive width/height from inline
// style so the hook's positioning math sees the dimensions the
// harness component declared.
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const w = parseInt(this.style.width, 10) || 0;
    const h = parseInt(this.style.height, 10) || 0;
    const left = parseInt(this.style.left, 10) || 0;
    const top = parseInt(this.style.top, 10) || 0;
    return {
      width: w,
      height: h,
      left,
      top,
      right: left + w,
      bottom: top + h,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

function CenteredHarness() {
  const { ref, containerProps, style } = useDraggable({
    placement: { kind: 'center' },
  });
  return (
    <div
      ref={ref}
      data-testid="harness"
      style={{ ...style, width: 200, height: 100 }}
      {...containerProps}
    >
      <header data-drag-handle data-testid="handle" style={{ height: 20 }}>
        drag me
      </header>
      <button data-testid="inner-button" type="button">
        click
      </button>
    </div>
  );
}

function BottomCenterHarness() {
  const { ref, containerProps, style } = useDraggable({
    placement: { kind: 'bottom-center', bottomMargin: 50 },
  });
  return (
    <div
      ref={ref}
      data-testid="harness"
      data-drag-handle
      style={{ ...style, width: 300, height: 60 }}
      {...containerProps}
    />
  );
}

describe('useDraggable', () => {
  it('positions a centered dialog using viewport dimensions', () => {
    render(<CenteredHarness />);
    const el = screen.getByTestId('harness');
    // jsdom's default viewport is 1024x768. Dialog is 200x100 so
    // centered position is left=412 / top=334.
    expect(el.style.position).toBe('fixed');
    expect(el.style.left).toBe('412px');
    expect(el.style.top).toBe('334px');
    expect(el.style.visibility).toBe('visible');
  });

  it('positions a bottom-centered banner against the viewport bottom', () => {
    render(<BottomCenterHarness />);
    const el = screen.getByTestId('harness');
    // 1024x768 viewport, 300x60 banner, bottomMargin=50 → top = 768 - 60 - 50 = 658.
    expect(el.style.left).toBe('362px');
    expect(el.style.top).toBe('658px');
  });

  it('drags via pointerdown on the drag handle', () => {
    render(<CenteredHarness />);
    const el = screen.getByTestId('harness');
    const handle = screen.getByTestId('handle');
    expect(el.style.left).toBe('412px');
    expect(el.style.top).toBe('334px');

    fireEvent.pointerDown(handle, {
      pointerId: 1,
      clientX: 500,
      clientY: 350,
      button: 0,
    });
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: 540,
      clientY: 380,
    });
    expect(el.style.left).toBe('452px');
    expect(el.style.top).toBe('364px');
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 540, clientY: 380 });
  });

  it('ignores pointerdown originating on an interactive descendant of the handle', () => {
    function Harness() {
      const { ref, containerProps, style } = useDraggable({
        placement: { kind: 'center' },
      });
      return (
        <div
          ref={ref}
          data-testid="harness"
          style={{ ...style, width: 200, height: 100 }}
          {...containerProps}
        >
          <header data-drag-handle style={{ height: 20 }}>
            <button data-testid="inner-button" type="button">
              click
            </button>
          </header>
        </div>
      );
    }
    render(<Harness />);
    const el = screen.getByTestId('harness');
    const button = screen.getByTestId('inner-button');
    const beforeLeft = el.style.left;
    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 500,
      clientY: 350,
      button: 0,
    });
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: 540,
      clientY: 380,
    });
    // No drag was initiated → position unchanged.
    expect(el.style.left).toBe(beforeLeft);
  });

  it('ignores non-left mouse buttons', () => {
    render(<CenteredHarness />);
    const el = screen.getByTestId('harness');
    const handle = screen.getByTestId('handle');
    const beforeLeft = el.style.left;
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      clientX: 500,
      clientY: 350,
      button: 2, // right click
    });
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: 600,
      clientY: 400,
    });
    expect(el.style.left).toBe(beforeLeft);
  });

  it('clamps the dialog inside the viewport when dragged off-edge', () => {
    render(<CenteredHarness />);
    const el = screen.getByTestId('harness');
    const handle = screen.getByTestId('handle');
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      clientX: 500,
      clientY: 350,
      button: 0,
    });
    // Try to drag wildly off the left/top edge.
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: -2000,
      clientY: -2000,
    });
    expect(el.style.left).toBe('0px');
    expect(el.style.top).toBe('0px');
    // Drag wildly off the right/bottom edge — viewport 1024x768,
    // dialog 200x100 → max left = 824, max top = 668.
    fireEvent.pointerMove(el, {
      pointerId: 1,
      clientX: 5000,
      clientY: 5000,
    });
    expect(el.style.left).toBe('824px');
    expect(el.style.top).toBe('668px');
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 0, clientY: 0 });
  });
});
