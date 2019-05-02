import { Mount } from './Mount';
export interface MountsConfig {
    rtpPortCount: number;
    rtpPortStart: number;
}
export declare class Mounts {
    mounts: {
        [path: string]: Mount | undefined;
    };
    rtpPorts: number[];
    constructor(config: MountsConfig);
    getMount(uri: string): Mount | undefined;
    addMount(uri: string, sdp: string): Mount | undefined;
    getNextRtpPort(): number | undefined;
    returnRtpPortToPool(port: number): void;
    deleteMount(uri: string): boolean;
}
