/// <reference types="node" />
import { Socket } from 'dgram';
import { RtspStream } from './Mount';
export declare class RtpUdp {
    port: number;
    stream: RtspStream;
    server: Socket;
    type: 'rtp' | 'rtcp';
    constructor(port: number, stream: RtspStream);
    listen(): Promise<void>;
    close(): Promise<{}>;
}
