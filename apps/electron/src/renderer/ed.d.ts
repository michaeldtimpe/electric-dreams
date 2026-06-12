/** Bridge exposed by the preload script. */
interface EdBridge {
  send(channel: string, payload: unknown): void;
  on(channel: string, cb: (payload: unknown) => void): void;
  getPathForFile(file: File): string;
}

interface Window {
  ed: EdBridge;
}
