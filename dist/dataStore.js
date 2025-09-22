import { fetchRunData, fetchRunDetails } from './fetch';
// Global singleton data store
let dataStore = {
    allRuns: [],
    runDetailsMap: new Map(),
    isInitialized: false,
    analysisState: {
        loadAllRuns: false,
        isLoading: false,
        targetRunCount: 0,
    },
};
const listeners = [];
function notifyListeners() {
    listeners.forEach(listener => listener());
}
export function addDataStoreListener(listener) {
    listeners.push(listener);
    return () => {
        const index = listeners.indexOf(listener);
        if (index > -1) {
            listeners.splice(index, 1);
        }
    };
}
// Initialize the all runs list
export async function initializeAllRuns() {
    if (dataStore.isInitialized) {
        return dataStore.allRuns;
    }
    try {
        console.log('🚀 Initializing global data store with all runs...');
        const runs = await fetchRunData();
        dataStore.allRuns = runs;
        dataStore.isInitialized = true;
        console.log(`✅ Initialized data store with ${runs.length} runs`);
        notifyListeners();
        return runs;
    }
    catch (error) {
        console.error('❌ Failed to initialize all runs:', error);
        throw error;
    }
}
// Get all runs (initialize if not already done)
export async function getAllRuns() {
    if (!dataStore.isInitialized) {
        return await initializeAllRuns();
    }
    return dataStore.allRuns;
}
// Get run details from cache or fetch if not available
export async function getRunDetails(runNumber) {
    // Check if we already have the data
    if (dataStore.runDetailsMap.has(runNumber)) {
        console.log(`🎯 Found cached run details for run ${runNumber}`);
        return dataStore.runDetailsMap.get(runNumber);
    }
    try {
        console.log(`🔍 Fetching run details for run ${runNumber} (not in cache)...`);
        const details = await fetchRunDetails(runNumber);
        // Store in cache
        dataStore.runDetailsMap.set(runNumber, details);
        console.log(`💾 Cached run details for run ${runNumber}`);
        notifyListeners();
        return details;
    }
    catch (error) {
        console.error(`❌ Failed to fetch run details for run ${runNumber}:`, error);
        throw error;
    }
}
// Check if run details are cached
export function hasRunDetails(runNumber) {
    return dataStore.runDetailsMap.has(runNumber);
}
// Get cached run details (returns undefined if not cached)
export function getCachedRunDetails(runNumber) {
    return dataStore.runDetailsMap.get(runNumber);
}
// Get all cached run details
export function getAllCachedRunDetails() {
    return new Map(dataStore.runDetailsMap);
}
// Get cached run details for multiple runs (useful for tests overview)
export function getCachedRunDetailsForRuns(runNumbers) {
    const result = new Map();
    runNumbers.forEach(runNumber => {
        const details = dataStore.runDetailsMap.get(runNumber);
        if (details) {
            result.set(runNumber, details);
        }
    });
    return result;
}
// Fetch and cache run details for multiple runs (with progress callback)
export async function fetchAndCacheRunDetails(runNumbers, onProgress, loadAllRuns = false) {
    const result = new Map();
    let completed = 0;
    // Update analysis state to indicate loading
    setAnalysisState(loadAllRuns, true, runNumbers.length);
    // Filter out runs that are already cached
    const uncachedRuns = runNumbers.filter(runNumber => !dataStore.runDetailsMap.has(runNumber));
    const cachedRuns = runNumbers.filter(runNumber => dataStore.runDetailsMap.has(runNumber));
    // Add cached runs to result
    cachedRuns.forEach(runNumber => {
        const details = dataStore.runDetailsMap.get(runNumber);
        result.set(runNumber, details);
    });
    console.log(`📊 Loading run details: ${cachedRuns.length} cached, ${uncachedRuns.length} to fetch`);
    if (uncachedRuns.length === 0) {
        onProgress?.(runNumbers.length, runNumbers.length);
        setAnalysisState(undefined, false); // Mark as not loading
        return result;
    }
    // Process uncached runs with rolling batch system - maintain constant concurrency of 25
    const maxConcurrency = 25;
    let runIndex = 0;
    const activePromises = new Set();
    // Helper function to process a single run
    const processRun = async (runNumber) => {
        try {
            const details = await fetchRunDetails(runNumber);
            dataStore.runDetailsMap.set(runNumber, details);
            result.set(runNumber, details);
            completed++;
            onProgress?.(cachedRuns.length + completed, runNumbers.length);
            // Notify listeners for real-time updates during batching
            notifyListeners();
        }
        catch (error) {
            console.error(`Failed to fetch details for run ${runNumber}:`, error);
            completed++;
            onProgress?.(cachedRuns.length + completed, runNumbers.length);
        }
    };
    // Start initial batch of requests up to maxConcurrency
    while (runIndex < uncachedRuns.length && activePromises.size < maxConcurrency) {
        const runNumber = uncachedRuns[runIndex++];
        const promise = processRun(runNumber).finally(() => {
            activePromises.delete(promise);
        });
        activePromises.add(promise);
    }
    // Continue processing as requests complete
    while (activePromises.size > 0) {
        // Wait for any request to complete
        await Promise.race(activePromises);
        // Start new requests to maintain concurrency level
        while (runIndex < uncachedRuns.length && activePromises.size < maxConcurrency) {
            const runNumber = uncachedRuns[runIndex++];
            const promise = processRun(runNumber).finally(() => {
                activePromises.delete(promise);
            });
            activePromises.add(promise);
        }
    }
    notifyListeners();
    setAnalysisState(undefined, false); // Mark as not loading
    return result;
}
// Clear cache (useful for debugging or manual refresh)
export function clearCache() {
    dataStore.runDetailsMap.clear();
    console.log('🗑️ Cleared run details cache');
    notifyListeners();
}
// Get cache statistics
export function getCacheStats() {
    return {
        totalRuns: dataStore.allRuns.length,
        cachedRunDetails: dataStore.runDetailsMap.size,
    };
}
// Get test results for a specific test from cached data
export function getTestResultsFromCache(testName) {
    const results = [];
    // Create a map of run number to run data for quick lookup
    const runDataMap = new Map();
    dataStore.allRuns.forEach(run => {
        const runNumber = run.name.replace('runs/', '');
        runDataMap.set(runNumber, run);
    });
    // Go through cached run details and find runs containing this test
    dataStore.runDetailsMap.forEach((runDetails, runNumber) => {
        const testResult = runDetails.tests.find(test => test.name === testName);
        if (testResult) {
            const runData = runDataMap.get(runNumber);
            if (runData) {
                results.push({
                    runNumber,
                    runId: runNumber, // Use just the run number, not the full "runs/number" format
                    createdOn: runData.creationTime,
                    branchName: runData.metadata.ghBranch,
                    status: testResult.status,
                    githubUrl: `https://github.com/microsoft/openvmm/actions/runs/${runNumber}`
                });
            }
        }
    });
    // Sort by creation time, newest first
    results.sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime());
    return results;
}
// Get runs that need to be processed for a specific test (runs not in cache)
export function getUncachedRunsForTest() {
    const uncachedRuns = [];
    dataStore.allRuns.forEach(run => {
        const runNumber = run.name.replace('runs/', '');
        if (!dataStore.runDetailsMap.has(runNumber)) {
            uncachedRuns.push(runNumber);
        }
    });
    return uncachedRuns;
}
// Calculate test statistics from cached run details
export function getTestStatsFromCache() {
    const statsMap = new Map();
    // Process all cached run details to build test statistics
    dataStore.runDetailsMap.forEach((runDetails) => {
        runDetails.tests.forEach(test => {
            const existing = statsMap.get(test.name) || {
                testName: test.name,
                passed: 0,
                failed: 0,
                total: 0,
                passRate: 0
            };
            if (test.status === 'passed') {
                existing.passed++;
            }
            else if (test.status === 'failed') {
                existing.failed++;
            }
            existing.total = existing.passed + existing.failed;
            existing.passRate = existing.total > 0 ? (existing.passed / existing.total) * 100 : 0;
            statsMap.set(test.name, existing);
        });
    });
    return statsMap;
}
// Get the count of cached run details
export function getCachedRunCount() {
    return dataStore.runDetailsMap.size;
}
// Analysis state management functions
export function getAnalysisState() {
    return { ...dataStore.analysisState };
}
export function setAnalysisState(loadAllRuns, isLoading, targetRunCount) {
    if (loadAllRuns !== undefined) {
        dataStore.analysisState.loadAllRuns = loadAllRuns;
    }
    if (isLoading !== undefined) {
        dataStore.analysisState.isLoading = isLoading;
    }
    if (targetRunCount !== undefined) {
        dataStore.analysisState.targetRunCount = targetRunCount;
    }
    notifyListeners();
}
export function isAnalysisComplete() {
    return dataStore.analysisState.loadAllRuns &&
        dataStore.runDetailsMap.size >= dataStore.allRuns.length;
}
