/**
 * The mouse stays his (D115). If the pointer is not where Baton left it, he has moved it, and Baton
 * stops and says so rather than click where he now is. The first action of a turn has nowhere it
 * left it, so it is allowed: he had just asked for it.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A few pixels of rounding between the driver's physical points and Electron's DIPs. */
export const POINTER_TOLERANCE = 8;

export const pointerMoved = (
  left: Point | null,
  now: Point,
  tolerance = POINTER_TOLERANCE,
): boolean =>
  left !== null && (Math.abs(left.x - now.x) > tolerance || Math.abs(left.y - now.y) > tolerance);
