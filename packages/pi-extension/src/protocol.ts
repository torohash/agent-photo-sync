export const SERVICE_TYPE = "pi-photosync";

export interface HerdrLocation {
  workspaceId: string;
  workspaceNumber: number;
  workspaceName: string;
  paneId: string;
  tabId: string;
}

export interface SessionIdentity {
  hostId: string;
  host: string;
  cwd: string;
  project: string;
  pid: number;
  terminal: string;
  sessionId: string;
  sessionName: string | null;
  model: string | null;
  herdr: HerdrLocation | null;
}

export interface SelectionSnapshot {
  receiverId: string;
  revision: string;
}

export interface ReceiverStatus extends SessionIdentity {
  id: string;
  shortId: string;
  preferred: boolean;
  selection: SelectionSnapshot;
  pending: number;
}

export interface PeerEndpoint {
  id: string;
  url: string;
}

export type PeerChange =
  | { type: "peer-up"; peer: PeerEndpoint }
  | { type: "peer-down"; id: string };
