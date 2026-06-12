import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';

/**
 * media://file/<encodeURIComponent(absolutePath)> — lets the renderers fetch
 * local audio/video/stem files with full streaming support.
 * Must be called before app.whenReady().
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: { stream: true, supportFetchAPI: true, bypassCSP: true },
    },
  ]);
}

export function mediaUrl(absPath: string): string {
  return `media://file/${encodeURIComponent(absPath)}`;
}

/** Call after app.whenReady(). */
export function handleMediaProtocol(): void {
  protocol.handle('media', (request) => {
    const url = new URL(request.url);
    const absPath = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return net.fetch(pathToFileURL(absPath).toString());
  });
}
