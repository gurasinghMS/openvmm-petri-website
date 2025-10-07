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
    creationTime?: Date;
    runNumber: string;
    tests: TestResult[];
}

export interface TestRunInfo {
    runNumber: string;
    creationTime?: Date;
    status: 'passed' | 'failed' | 'unknown';
}

export interface TestData {
    architecture: string;
    name: string;
    failedCount: number;
    totalCount: number;
}
