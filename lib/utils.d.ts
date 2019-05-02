export interface MountInfo {
    path: string;
    streamId: number;
}
export declare function getMountInfo(uri: string): MountInfo;
