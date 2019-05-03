import { Mount } from './Mount';
import { getDebugger, getMountInfo } from './utils';

const debug = getDebugger('Mounts');

export interface MountsConfig {
  rtpPortCount: number;
  rtpPortStart: number;
}

export class Mounts {
  mounts: { [path: string]: Mount | undefined };
  rtpPorts: number[];

  constructor (config: MountsConfig) {
    this.mounts = {};

    this.rtpPorts = []; // It is assumed that each start port has a correlating end port of start+1

    for (let i = config.rtpPortStart; i < config.rtpPortStart + config.rtpPortCount; i = i + 2) {
      this.rtpPorts.push(i);
    }
  }

  getMount (uri: string) {
    let info = getMountInfo(uri);

    return this.mounts[info.path];
  }

  addMount (uri: string, sdp: string): Mount {
    debug('Adding mount with path %s and SDP %O', uri, sdp);
    const info = getMountInfo(uri);
    const mount = new Mount(this, info.path, sdp);
    this.mounts[info.path] = mount;
    return mount;
  }

  getNextRtpPort (): number | undefined {
    debug('%d rtp ports remaining', this.rtpPorts.length - 1);
    return this.rtpPorts.shift();
  }

  returnRtpPortToPool (port: number): void {
    debug('%d rtp ports remaining', this.rtpPorts.length + 1);
    this.rtpPorts.push(port);
  }

  deleteMount (uri: string): boolean {
    debug('Removing mount with path %s', uri);
    let info = getMountInfo(uri);

    const mount = this.mounts[info.path];
    if (mount) {
      const portsFreed = mount.close();

      this.rtpPorts = this.rtpPorts.concat(portsFreed);
      this.mounts[info.path] = undefined;
      delete this.mounts[info.path];
      return true;
    }

    return false;
  }

}
