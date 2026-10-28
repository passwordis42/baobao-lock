'use strict';

const DEFAULT_MARGIN = 24;

function defaultWidgetPosition(workArea, size, margin) {
  const gap = margin == null ? DEFAULT_MARGIN : margin;
  return {
    x: Math.round(workArea.x + workArea.width - size.width - gap),
    y: Math.round(workArea.y + workArea.height - size.height - gap)
  };
}

function intersectionArea(pos, size, bounds) {
  const left = Math.max(pos.x, bounds.x);
  const top = Math.max(pos.y, bounds.y);
  const right = Math.min(pos.x + size.width, bounds.x + bounds.width);
  const bottom = Math.min(pos.y + size.height, bounds.y + bounds.height);
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

/** True when a meaningful part of the window still lies on a connected display. */
function isVisibleOnDisplays(pos, size, displays) {
  if (!pos || !size || !displays || !displays.length) return false;
  const minW = Math.min(48, size.width);
  const minH = Math.min(48, size.height);
  return displays.some(function (display) {
    const bounds = display.bounds || display;
    const left = Math.max(pos.x, bounds.x);
    const top = Math.max(pos.y, bounds.y);
    const right = Math.min(pos.x + size.width, bounds.x + bounds.width);
    const bottom = Math.min(pos.y + size.height, bounds.y + bounds.height);
    return (right - left) >= minW && (bottom - top) >= minH;
  });
}

function resolveWidgetPosition(saved, displays, primaryWorkArea, size) {
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      && isVisibleOnDisplays(saved, size, displays)) {
    return { x: Math.round(saved.x), y: Math.round(saved.y) };
  }
  return defaultWidgetPosition(primaryWorkArea, size, DEFAULT_MARGIN);
}

module.exports = {
  DEFAULT_MARGIN,
  defaultWidgetPosition,
  intersectionArea,
  isVisibleOnDisplays,
  resolveWidgetPosition
};
