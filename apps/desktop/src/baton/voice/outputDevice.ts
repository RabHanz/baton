// @effect-diagnostics nodeBuiltinImport:off
/**
 * Headphones or speakers, read from Windows' default playback device: its form factor, and whether it is
 * Bluetooth. With headphones the microphone cannot hear her, so talking over her is a cut-in.
 */
import * as NodeChildProcess from "node:child_process";

export type OutputDevice = "auto" | "headphones" | "speakers";

/** The default render endpoint's PKEY_AudioEndpoint_FormFactor, and its PKEY_Device_EnumeratorName. */
export const readScript = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit, Size = 24)] public struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public uint ui4; [FieldOffset(8)] public IntPtr p; }
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { int GetCount(out int count); int GetAt(int i, out PropertyKey key); int GetValue(ref PropertyKey key, out PropVariant value); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(); int OpenPropertyStore(int access, out IPropertyStore store); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-46C5-9B0E-3F2FD7D7C8E0")] class MMDeviceEnumeratorComObject { }
public class TessayaOutput {
  public static string Get() {
    var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator; IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d);
    IPropertyStore s; d.OpenPropertyStore(0, out s);
    var form = new PropertyKey { fmtid = new Guid("1da5d803-d492-4edd-8c23-e0c0ffee7f0e"), pid = 0 };
    var bus = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 24 };
    PropVariant f; s.GetValue(ref form, out f);
    PropVariant b; s.GetValue(ref bus, out b);
    return (f.vt == 19 ? f.ui4.ToString() : "") + ";" + (b.vt == 31 ? Marshal.PtrToStringUni(b.p) : "");
  }
}
'@
[TessayaOutput]::Get()`;

/** EndpointFormFactor values that are worn, and ones that fill the room. */
const WORN = new Set([3, 5, 6]); // Headphones, Headset, Handset
const ROOM = new Set([1, 2, 8, 9]); // Speakers, LineLevel, SPDIF, DigitalAudioDisplayDevice (a screen's speakers)

/** "3;HDAUDIO" → headphones. Bluetooth counts as headphones. Null when the device does not say. */
export const outputKindOf = (out: string): "headphones" | "speakers" | null => {
  const m = /^\s*(\d*);(.*?)\s*$/.exec(out);
  if (m === null) return null;
  if (/BTH/i.test(m[2] ?? "")) return "headphones";
  const form = m[1] === "" ? Number.NaN : Number(m[1]);
  return WORN.has(form) ? "headphones" : ROOM.has(form) ? "speakers" : null;
};

/** His choice, or what was detected; speakers when neither knows, so talking over her is never taken as a cut-in by guess. */
export const speakerModeOf = (
  chosen: OutputDevice,
  detected: "headphones" | "speakers" | null,
): "headphones" | "speakers" => (chosen === "auto" ? (detected ?? "speakers") : chosen);

const powershell = (script: string): Promise<string> =>
  new Promise((resolve, reject) =>
    NodeChildProcess.execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 8_000, windowsHide: true },
      (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
    ),
  );

/** Reads the device at most once in `everyMs`, in the background; `kind` is the last answer. Windows only. */
export const createOutputWatch = (input: {
  readonly platform: string;
  readonly run?: (script: string) => Promise<string>;
  readonly everyMs?: number;
  readonly now?: () => number;
}) => {
  const run = input.run ?? powershell;
  const now = input.now ?? Date.now;
  const everyMs = input.everyMs ?? 15_000;
  let kind: "headphones" | "speakers" | null = null;
  let lastAt = -Infinity;
  return {
    kind: () => kind,
    refresh: (): Promise<void> => {
      if (input.platform !== "win32" || now() - lastAt < everyMs) return Promise.resolve();
      lastAt = now();
      // A failed read keeps the last answer: the device rarely changes between two looks.
      return run(readScript)
        .then((out) => void (kind = outputKindOf(out)))
        .catch(() => undefined);
    },
  };
};
