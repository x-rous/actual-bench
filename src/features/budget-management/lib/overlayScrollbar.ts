/**
 * Geometry for an overlay scrollbar thumb.
 *
 * The native scrollbar reserves layout width on Windows and Linux, so opening a
 * category group used to shove the whole grid sideways. Drawing the thumb
 * ourselves, over the content, keeps the grid exactly as wide whether it
 * scrolls or not.
 *
 * Pure so the arithmetic can be tested without a layout engine - jsdom reports
 * every element as zero-sized, which is precisely the case this has to survive.
 */
export type ThumbGeometry = { offset: number; size: number } | null;

/** Smallest thumb worth drawing; below this it stops being grabbable. */
export const MIN_THUMB_PX = 24;

export function computeThumb(
  scrollPos: number,
  clientSize: number,
  scrollSize: number,
  trackSize: number,
  minThumb = MIN_THUMB_PX
): ThumbGeometry {
  // Nothing to scroll, or nothing measured yet (jsdom, or before first layout).
  if (scrollSize <= clientSize || clientSize <= 0 || trackSize <= 0) return null;

  const ratio = clientSize / scrollSize;
  // A minimum keeps a short thumb grabbable, but never past the track it sits
  // in - a narrow pane would otherwise draw a thumb longer than its own track.
  const size = Math.min(trackSize, Math.max(minThumb, Math.round(trackSize * ratio)));
  // The thumb travels the track minus its own length, so a full scroll lands it
  // flush with the end rather than overhanging it.
  const travel = trackSize - size;
  const maxScroll = scrollSize - clientSize;
  const offset = maxScroll <= 0 ? 0 : Math.round((scrollPos / maxScroll) * travel);
  return { offset: Math.max(0, Math.min(travel, offset)), size };
}

/**
 * Where to scroll to when the thumb is dragged by `deltaPx` along the track.
 * The inverse of `computeThumb`, so a drag tracks the pointer exactly.
 */
export function scrollPosFromThumbDelta(
  startScroll: number,
  deltaPx: number,
  clientSize: number,
  scrollSize: number,
  trackSize: number,
  minThumb = MIN_THUMB_PX
): number {
  if (scrollSize <= clientSize || trackSize <= 0) return startScroll;
  const ratio = clientSize / scrollSize;
  const size = Math.min(trackSize, Math.max(minThumb, Math.round(trackSize * ratio)));
  const travel = trackSize - size;
  if (travel <= 0) return startScroll;
  const maxScroll = scrollSize - clientSize;
  return Math.max(0, Math.min(maxScroll, startScroll + (deltaPx / travel) * maxScroll));
}
