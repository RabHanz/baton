/**
 * One-shot screen captures through Electron's own `desktopCapturer`: every display, the cursor's
 * first, each scaled so its long edge is at most 1280 px (farzaa/clicky's size), as JPEG.
 * Nothing is captured unless the companion asks, and the companion asks only after his approval.
 */
import { captureSize, type ScreenShot } from "@t3tools/baton-shared/screenCompanion";
import * as Electron from "electron";

export interface CapturedScreen {
  readonly shot: ScreenShot;
  readonly jpeg: Buffer;
}

/** The display he means: the one with the window he is using, else the cursor's. */
const orderedDisplays = (
  anchor?: { readonly x: number; readonly y: number } | null,
): ReadonlyArray<{ display: Electron.Display; cursorHere: boolean }> => {
  const point = anchor ?? Electron.screen.getCursorScreenPoint();
  const here = Electron.screen.getDisplayNearestPoint(point).id;
  return Electron.screen
    .getAllDisplays()
    .map((display) => ({ display, cursorHere: display.id === here }))
    .sort((a, b) => Number(b.cursorHere) - Number(a.cursorHere));
};

// Linux X11 reports no display_id; there the sources come in display order.
const sourceFor = (
  sources: ReadonlyArray<Electron.DesktopCapturerSource>,
  display: Electron.Display,
  index: number,
): Electron.DesktopCapturerSource | undefined =>
  sources.find((s) => s.display_id === String(display.id)) ??
  (sources.every((s) => s.display_id === "") ? sources[index] : undefined);

export const captureScreens = async (
  anchor?: { readonly x: number; readonly y: number } | null,
): Promise<ReadonlyArray<CapturedScreen>> => {
  const ordered = orderedDisplays(anchor);
  const all = Electron.screen.getAllDisplays();
  const largest = Math.max(
    ...all.map((d) => Math.max(d.size.width, d.size.height) * d.scaleFactor),
  );
  const box = captureSize(largest, largest).width;
  const sources = await Electron.desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: box, height: box },
  });
  const out: CapturedScreen[] = [];
  ordered.forEach(({ display, cursorHere }, i) => {
    const source = sourceFor(sources, display, all.indexOf(display));
    if (source === undefined || source.thumbnail.isEmpty()) return;
    const physical = captureSize(
      display.size.width * display.scaleFactor,
      display.size.height * display.scaleFactor,
    );
    const image =
      source.thumbnail.getSize().width > physical.width
        ? source.thumbnail.resize(physical)
        : source.thumbnail;
    const size = image.getSize();
    out.push({
      shot: {
        screen: i + 1,
        width: size.width,
        height: size.height,
        cursorHere,
        bounds: display.bounds,
      },
      jpeg: image.toJPEG(80),
    });
  });
  if (out.length === 0) {
    throw new Error(
      "Baton could not capture the screen. On macOS allow Screen Recording; on Linux Wayland, X11 is needed.",
    );
  }
  return out;
};

/** A tiny grayscale picture of the cursor's display, for noticing that the screen changed. */
export const screenFingerprint = async (): Promise<ReadonlyArray<Uint8Array>> => {
  const sources = await Electron.desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 320, height: 320 },
  });
  // Every display, in a fixed order: the cursor moving must not read as the screen changing, and
  // his step may land on the display the cursor is not on.
  return Electron.screen.getAllDisplays().flatMap((display, index) => {
    const source = sourceFor(sources, display, index);
    if (source === undefined) return [];
    const bitmap = source.thumbnail.toBitmap(); // BGRA
    const gray = new Uint8Array(bitmap.length / 4);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = (bitmap[i * 4]! + bitmap[i * 4 + 1]! * 2 + bitmap[i * 4 + 2]!) >> 2;
    }
    return [gray];
  });
};
