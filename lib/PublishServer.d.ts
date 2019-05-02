import { RtspRequest, RtspResponse, RtspServer } from 'rtsp-server';
import { Mounts } from './Mounts';
/**
 *
 */
export declare class PublishServer {
    mounts: Mounts;
    rtspPort: number;
    server: RtspServer;
    /**
     *
     * @param rtspPort
     * @param mounts
     */
    constructor(rtspPort: number, mounts: Mounts);
    /**
     *
     */
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
    announceRequest(req: RtspRequest, res: RtspResponse): void;
    /**
     *
     * @param req
     * @param res
     */
    setupRequest(req: RtspRequest, res: RtspResponse): void;
    /**
     *
     * @param req
     * @param res
     */
    recordRequest(req: RtspRequest, res: RtspResponse): Promise<void>;
    /**
     *
     * @param req
     * @param res
     */
    teardownRequest(req: RtspRequest, res: RtspResponse): void;
}
