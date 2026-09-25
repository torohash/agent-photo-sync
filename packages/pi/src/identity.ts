import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readHostIdentity } from "../../core/src/host.ts";
import type { SessionIdentity } from "../../core/src/protocol.ts";

export async function readIdentity(
  ctx: ExtensionContext,
): Promise<SessionIdentity> {
  return {
    ...(await readHostIdentity(process.pid)),
    agent: "pi",
    cwd: ctx.cwd,
    project: basename(ctx.cwd),
    sessionId: ctx.sessionManager.getSessionId(),
    sessionName: ctx.sessionManager.getSessionName() ?? null,
    model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
  };
}
