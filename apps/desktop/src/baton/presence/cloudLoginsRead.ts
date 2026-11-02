// @effect-diagnostics nodeBuiltinImport:off
/**
 * The cloud-login report the box writes, read as a file. Read only: no credential is opened, and a
 * missing or broken file is "unknown". BATON_CLOUD_LOGINS_FILE overrides the place.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { parseCloudLogins, type CloudLogins } from "@t3tools/baton-shared/cloudLogins";

export const cloudLoginsFile = (env: NodeJS.ProcessEnv): string =>
  env["BATON_CLOUD_LOGINS_FILE"] ?? NodePath.join(NodeOS.homedir(), ".t3", "baton", "cloud-logins.json");

export const readCloudLogins = (file: string): CloudLogins | null => {
  try {
    return parseCloudLogins(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
