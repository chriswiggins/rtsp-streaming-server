import { Mounts } from './Mounts';
import { RtpUdp } from './RtpUdp';
export declare type RtspStream = {
    id: number;
    mount: Mount;
    clients: any;
    listenerRtp?: RtpUdp;
    listenerRtcp?: RtpUdp;
    rtpStartPort: number;
    rtpEndPort: number;
};
export declare class Mount {
    id: string;
    mounts: Mounts;
    path: string;
    streams: {
        [streamId: string]: RtspStream;
    };
    sdp: string;
    range?: string;
    constructor(mounts: Mounts, path: string, sdpBody: string);
    createStream(uri: string): RtspStream;
    setup(): Promise<void>;
    close(): number[];
}
