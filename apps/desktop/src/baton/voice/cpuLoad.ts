import * as NodeOS from "node:os";

type Cpus = () => ReadonlyArray<{ readonly times: Readonly<Record<string, number>> }>;

/**
 * How busy the whole machine was since the last call, in percent of every core. For the turn log's slow
 * recognition lines: Windows has no load average (os.loadavg is always 0 there), so it is read from core times.
 */
export const createCpuLoad = (cpus: Cpus = NodeOS.cpus) => {
  const total = () => {
    let busy = 0;
    let all = 0;
    for (const { times } of cpus()) {
      for (const [kind, ms] of Object.entries(times)) {
        all += ms;
        if (kind !== "idle") busy += ms;
      }
    }
    return { busy, all };
  };
  let last = total();
  return (): number | null => {
    const now = total();
    const all = now.all - last.all;
    const busy = now.busy - last.busy;
    last = now;
    return all <= 0 ? null : Math.round((busy / all) * 100);
  };
};
