import debug, { IDebugger } from 'debug';

const mountRegex = /(\/\S+)(?:\/streamid=)(\d+)/;

export interface MountInfo {
  path: string;
  streamId: number;
}

export function getMountInfo (uri: string): MountInfo {
  // Default mount info
  const mount: MountInfo = {
    path: '',
    streamId: 0
  };

  // Strip protocol and host if present
  const pathMatch = uri.match(/(?:rtsp:\/\/[^\/]+)?(\/.+)/);
  if (pathMatch) {
    mount.path = pathMatch[1];
  } else {
    mount.path = uri;
  }

  // Check for streamid in the path
  const streamMatch = mount.path.match(mountRegex);
  if (streamMatch) {
    mount.path = streamMatch[1];
    mount.streamId = parseInt(streamMatch[2], 10);
  }

  debug('Parsed mount info from %s: path=%s, streamId=%d', uri, mount.path, mount.streamId);
  return mount;
}

export function getDebugger (name: string): IDebugger {
  return debug(`rtsp-streaming-server:${name}`);
}
