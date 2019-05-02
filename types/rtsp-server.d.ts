declare module 'rtsp-server' {
  import { EventEmitter } from 'events';
  import { Socket } from 'net';

  export type RtspRequestMethod = 'DESCRIBE' | 'ANNOUNCE' | 'GET_PARAMETER' | 'OPTIONS' | 'PAUSE' | 'PLAY' | 'RECORD' | 'REDIRECT' | 'SETUP' | 'SET_PARAMETER' | 'TEARDOWN';
  
  export interface RtspRequest {
    method: RtspRequestMethod;
    headers: {
      [key: string]: string | undefined;
      authorization?: string;
      session?: string;
    }
    url: string;
    uri: string;
    on(event: 'data', callback: (buffer: Buffer) => void): void;
    on(event: 'end', callback: () => void): void;
    socket: Socket;
  }

  export interface RtspResponse {
    setHeader(header: string, content: any): void;
    statusCode: number;
    end(): void;
    write(data: any): void;
  }

  export type RtspRequestFn = (req: RtspRequest, res: RtspResponse) => void;
  export type RtspErrorFn = (err: Error, socket?: Socket) => void;

  export interface RtspServer extends EventEmitter {
    on(event: 'request', listener: RtspRequestFn): this;
    on(event: 'error', listener: RtspErrorFn): this;
    on(event: 'clientError', listener: RtspErrorFn): this;
    on(event: 'data', listener: (buffer: Buffer) => void): this;
    listen(port: number, callback: () => void): void;
  }

  export function createServer(requestListener: RtspRequestFn): RtspServer;

}