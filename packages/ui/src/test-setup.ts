import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver (used by resizable panels, graphs).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver =
    ResizeObserverStub as typeof globalThis.ResizeObserver;
}

class DOMMatrixReadOnlyStub {
  readonly m11 = 1;
  readonly m12 = 0;
  readonly m13 = 0;
  readonly m14 = 0;
  readonly m21 = 0;
  readonly m22 = 1;
  readonly m23 = 0;
  readonly m24 = 0;
  readonly m31 = 0;
  readonly m32 = 0;
  readonly m33 = 1;
  readonly m34 = 0;
  readonly m41 = 0;
  readonly m42 = 0;
  readonly m43 = 0;
  readonly m44 = 1;
  constructor(_init?: string | number[]) {}
}

if (
  typeof window !== 'undefined' &&
  typeof window.DOMMatrixReadOnly !== 'function'
) {
  window.DOMMatrixReadOnly =
    DOMMatrixReadOnlyStub as typeof window.DOMMatrixReadOnly;
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
