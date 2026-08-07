// The manager's build version, injected as APP_VERSION from the git tag at
// image build time (see Dockerfile / publish.yml). "dev" for local runs.
export function managerVersion(): string {
  return process.env.APP_VERSION || "dev";
}
