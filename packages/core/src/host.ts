import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readlink } from "node:fs/promises";
import { homedir, hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { HerdrLocation } from "./protocol.ts";

const execute = promisify(execFile);

/** PiとClaude Codeが受信先の指定を共有するディレクトリ。 */
export function stateDirectory(): string {
  return join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
    "agent-photosync",
  );
}

async function herdrLocation(): Promise<HerdrLocation | null> {
  if (!process.env.HERDR_PANE_ID) return null;
  const { stdout } = await execute("herdr", [
    "workspace",
    "get",
    process.env.HERDR_WORKSPACE_ID!,
  ]);
  // JSON解析の失敗は元の例外のまま呼び出し元へ伝える。
  // ast-grep-ignore: unchecked-throwing-call
  const workspace = JSON.parse(stdout).result.workspace;
  return {
    workspaceId: process.env.HERDR_WORKSPACE_ID!,
    workspaceNumber: workspace.number,
    workspaceName: workspace.label,
    paneId: process.env.HERDR_PANE_ID,
    tabId: process.env.HERDR_TAB_ID!,
  };
}

export interface HostIdentity {
  hostId: string;
  host: string;
  pid: number;
  terminal: string;
  herdr: HerdrLocation | null;
}

/** エージェントのプロセスが属するPC・端末・Herdr上の位置を読む。 */
export async function readHostIdentity(pid: number): Promise<HostIdentity> {
  return {
    hostId: createHash("sha256")
      .update(await readFile("/etc/machine-id", "utf8"))
      .update(stateDirectory())
      .digest("hex"),
    host: hostname(),
    pid,
    terminal: await readlink(`/proc/${pid}/fd/0`),
    herdr: await herdrLocation(),
  };
}

/** スマホから接続できるLAN上の受信口URL。 */
export function lanUrls(port: number): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((address) => address?.family === "IPv4" && !address.internal)
    .map((address) => `http://${address!.address}:${port}`);
}
