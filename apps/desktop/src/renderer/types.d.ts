import type { ArgentBridge } from "../shared/ipc.js";

declare global {
  interface Window {
    argent: ArgentBridge;
  }
}

export {};
