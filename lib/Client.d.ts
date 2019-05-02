/// <reference types="node" />
import { Socket } from 'dgram';
import { RtspRequest } from 'rtsp-server';
import { Mount, RtspStream } from './Mount';
import { Mounts } from './Mounts';
import { MountInfo } from './utils';
export declare class Client {
    id: string;
    info: MountInfo;
    keepaliveTimeout?: NodeJS.Timeout;
    mount: Mount;
    mounts: Mounts;
    stream: RtspStream;
    remoteAddress: string;
    remoteRtcpPort: number;
    remoteRtpPort: number;
    rtpServer: Socket;
    rtcpServer: Socket;
    rtpServerPort?: number;
    rtcpServerPort?: number;
    constructor(mounts: Mounts, req: RtspRequest);
    /**
     *
     */
    listen(): Promise<void>;
    /**
     *
     * @param req
     */
    setup(req: RtspRequest): Promise<void>;
    /**
     *
     */
    play(): void;
    /**
     *
     */
    close(): Promise<void>;
    /**
     *
     * @param buf
     */
    send_rtp(buf: Buffer): void;
    /**
     *
     * @param buf
     */
    send_rtcp(buf: Buffer): void;
    keepalive(): void;
    private setupServerPorts;
}
