import { Mount } from './Mount';
import { getMountInfo } from './utils';

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

  addMount (uri: string, sdp: string) {
    const info = getMountInfo(uri);
    this.mounts[info.path] = new Mount(this, info.path, sdp);
    return this.mounts[info.path];
  }

  getNextRtpPort (): number | undefined {
    return this.rtpPorts.shift();
  }

  returnRtpPortToPool (port: number): void {
    this.rtpPorts.push(port);
  }

  deleteMount (uri: string): boolean {
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
