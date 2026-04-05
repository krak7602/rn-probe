export type ExpoMode = "bare" | "expo-go" | "dev-build";
export type Platform = "ios" | "android";

export interface DaemonState {
  metroUrl: string;
  expoMode: ExpoMode;
  platform: Platform;
  targetUdid: string | null;
  bundleId: string | null;
  metroConnected: boolean;
  devtoolsConnected: boolean;
}

export const state: DaemonState = {
  metroUrl: "http://localhost:8081",
  expoMode: "bare",
  platform: "ios",
  targetUdid: null,
  bundleId: null,
  metroConnected: false,
  devtoolsConnected: false,
};
