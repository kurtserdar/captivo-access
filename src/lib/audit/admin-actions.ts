const LABELS: Record<string, string> = {
  "grant.create": "Grant created",
  "grant.update": "Grant updated",
  "grant.approve": "Grant approved",
  "grant.deny": "Grant denied",
  "grant.revoke": "Grant revoked",
  "session.terminate": "Session terminated",
  "authsession.revoke": "Auth session revoked",
  "user.update": "User updated",
  "user.delete": "User deleted",
  "invite.create": "Invite created",
  "invite.revoke": "Invite revoked",
  "connector.create": "Connector created",
  "connector.revoke": "Connector revoked",
  "connector.delete": "Connector deleted",
  "resource.create": "Resource created",
  "resource.update": "Resource updated",
  "resource.delete": "Resource deleted",
  "resource.vault_update": "Resource credential updated",
};

export function adminActionLabel(action: string): string {
  return LABELS[action] ?? action;
}
