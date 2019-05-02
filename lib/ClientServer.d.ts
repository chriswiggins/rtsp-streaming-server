import { RtspRequest, RtspResponse } from 'rtsp-server';
import { Mounts } from './Mounts';
/**
 *
 */
export declare class ClientServer {
    private mounts;
    private rtspPort;
    private server;
    private clients;
    /**
     *
     * @param rtspPort
     * @param mounts
     */
    constructor(rtspPort: number, mounts: Mounts);
    start(): Promise<void>;
    /**
     *
     * @param req
     * @param res
     */
    optionsRequest(req: RtspRequest, res: RtspResponse): void;
    /**
     *
     * @param req
     * @param res
     */
    describeRequest(req: RtspRequest, res: RtspResponse): void;
    /**
     *
     * @param req
     * @param res
     */
    setupRequest(req: RtspRequest, res: RtspResponse): Promise<void>;
    /**
     *
     * @param req
     * @param res
     */
    playRequest(req: RtspRequest, res: RtspResponse): void;
    /**
     *
     * @param req
     * @param res
     */
    teardownRequest(req: RtspRequest, res: RtspResponse): void;
}
