export type ExpoMode = "bare" | "expo-go" | "dev-build";
export type Platform = "ios" | "android";
export type Arch = "new" | "legacy" | "unknown";

export interface DaemonState {
  metroUrl: string;
  expoMode: ExpoMode;
  platform: Platform;
  arch: Arch;
  targetUdid: string | null;
  bundleId: string | null;
  metroConnected: boolean;
  devtoolsConnected: boolean;
}

export const state: DaemonState = {
  metroUrl: "http://localhost:8081",
  expoMode: "bare",
  platform: "ios",
  arch: "unknown",
  targetUdid: null,
  bundleId: null,
  metroConnected: false,
  devtoolsConnected: false,
};
