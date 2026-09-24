import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readlink } from "node:fs/promises";
import { hostname } from "node:os";
import { basename } from "node:path";
import { promisify } from "node:util";
import {
  getAgentDir,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { HerdrLocation, SessionIdentity } from "./protocol.ts";

const execute = promisify(execFile);

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

export async function readIdentity(
  ctx: ExtensionContext,
): Promise<SessionIdentity> {
  return {
    hostId: createHash("sha256")
      .update(await readFile("/etc/machine-id", "utf8"))
      .update(getAgentDir())
      .digest("hex"),
    host: hostname(),
    cwd: ctx.cwd,
    project: basename(ctx.cwd),
    pid: process.pid,
    terminal: await readlink("/proc/self/fd/0"),
    sessionId: ctx.sessionManager.getSessionId(),
    sessionName: ctx.sessionManager.getSessionName() ?? null,
    model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
    herdr: await herdrLocation(),
  };
}
