// Data types used across the application
export interface RunData {
    name: string;
    creationTime: Date;
    lastModified: Date;
    etag: string;
    contentLength: number;
    metadata: RunMetadata;
}

export interface RunMetadata {
    petriFailed: number;
    petriPassed: number;
    ghBranch: string;
    ghPr?: string;
    prTitle?: string;
}

export interface TestResult {
    name: string;
    status: 'passed' | 'failed' | 'unknown';
    path: string;
    duration?: number;
}

export interface RunDetailsData {
    runNumber: string;
    tests: TestResult[];
}

export interface ParsedRunResult {
    serviceEndpoint: string;
    containerName: string;
    prefix: string;
    runs: RunData[];
}
