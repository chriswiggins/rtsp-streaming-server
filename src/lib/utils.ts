import debug, { IDebugger } from 'debug';
import { URL } from 'url';

const mountRegex = /(\/\S+)(?:\/streamid=)(\d+)/;

export interface MountInfo {
  path: string;
  streamId: number;
}

export function getMountInfo (uri: string): MountInfo {
  let urlObj = new URL(uri);

  let mount = {
    path: urlObj.pathname,
    streamId: -1
  };

  if (urlObj.pathname.indexOf('streamid') > -1) {
    const match = urlObj.pathname.match(mountRegex);

    if (match) {
      mount.path = match[1];
      mount.streamId = parseInt(match[2], 10);
    }
  }

  return mount;
}

export function getDebugger (name: string): IDebugger {
  return debug(`rtsp-streaming-server:${name}`);
}
