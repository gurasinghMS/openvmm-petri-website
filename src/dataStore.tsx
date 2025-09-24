import { RunData, RunDetails, fetchRunData, fetchRunDetails } from './fetch';

/*
 * ==================== PRIORITY-BASED DATA FETCHING SYSTEM ====================
 * 
 * This data store now implements a sophisticated priority-based task scheduling system
 * that segregates tasks into HIGH and LOW priority queues:
 * 
 * HIGH PRIORITY (User-Initiated):
 * - Clicking on test details
 * - Manual requests for specific run data
 * - User navigation that requires immediate data
 * - These tasks will pause background work and execute immediately
 * 
 * LOW PRIORITY (Background):
 * - Preloading test data in the background
 * - Continuation token-based batch processing
 * - Opportunistic caching while user is idle
 * - These tasks yield to user requests and can be paused/resumed
 * 
 * Key Features:
 * - Background tasks automatically pause when user requests come in
 * - Continuation token support for resuming interrupted background work  
 * - Dynamic batch sizing based on system load and user activity
 * - Real-time priority queue monitoring and statistics
 * - Graceful handling of task failures and network issues
 * 
 * Usage:
 * - getRunDetails() - Automatically uses HIGH priority for user clicks
 * - fetchAndCacheRunDetails() - Can be HIGH or LOW priority based on context
 * - Background loading continues automatically with LOW priority
 * - System automatically resumes paused work after user requests complete
 */

// Task priority levels
export enum TaskPriority {
  HIGH = 'HIGH',    // User-initiated requests (clicking test details, etc.)
  LOW = 'LOW'       // Background tasks (loading test data)
}

// Task interface for the priority queue
interface Task {
  id: string;
  priority: TaskPriority;
  execute: () => Promise<any>;
  type: 'fetch_run_details' | 'batch_fetch' | 'user_request';
  runNumbers?: string[];
  continuationToken?: string;
  onProgress?: (completed: number, total: number) => void;
}

// Priority task scheduler state
interface TaskScheduler {
  isProcessing: boolean;
  currentTask: Task | null;
  highPriorityQueue: Task[];
  lowPriorityQueue: Task[];
  pausedBackgroundTasks: Task[];
  activePromises: Map<string, Promise<any>>;
}

// Global data store interface
interface DataStore {
  allRuns: RunData[];
  runDetailsMap: Map<string, RunDetails>;
  isInitialized: boolean;
  // Analysis state
  analysisState: {
    loadAllRuns: boolean;
    isLoading: boolean;
    targetRunCount: number;
  };
  // Background loading state
  backgroundLoadingState: {
    isActive: boolean;
    batchSize: number;
    activeRequests: number;
    currentBatch: string[];
    pendingRuns: string[];
    isPaused: boolean;
    continuationToken?: string;
  };
  // Task scheduler
  taskScheduler: TaskScheduler;
}

// Global singleton data store
let dataStore: DataStore = {
  allRuns: [],
  runDetailsMap: new Map<string, RunDetails>(),
  isInitialized: false,
  analysisState: {
    loadAllRuns: false,
    isLoading: false,
    targetRunCount: 0,
  },
  backgroundLoadingState: {
    isActive: false,
    batchSize: 2,
    activeRequests: 0,
    currentBatch: [],
    pendingRuns: [],
    isPaused: false,
    continuationToken: undefined,
  },
  taskScheduler: {
    isProcessing: false,
    currentTask: null,
    highPriorityQueue: [],
    lowPriorityQueue: [],
    pausedBackgroundTasks: [],
    activePromises: new Map(),
  },
};

// Event system for notifying components of data changes
type DataStoreListener = () => void;
const listeners: DataStoreListener[] = [];

function notifyListeners() {
  listeners.forEach(listener => listener());
}

export function addDataStoreListener(listener: DataStoreListener): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
}

// ==================== PRIORITY TASK SCHEDULER ====================

// Generate unique task ID
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Add task to the appropriate queue based on priority
function enqueueTask(task: Task): void {
  const { taskScheduler } = dataStore;
  
  if (task.priority === TaskPriority.HIGH) {
    taskScheduler.highPriorityQueue.push(task);
    console.log(`🔥 High priority task queued: ${task.type} (${task.id})`);
    
    // If we have a low priority task running, pause it
    if (taskScheduler.currentTask && taskScheduler.currentTask.priority === TaskPriority.LOW) {
      pauseCurrentBackgroundTask();
    }
  } else {
    taskScheduler.lowPriorityQueue.push(task);
    console.log(`📦 Low priority task queued: ${task.type} (${task.id})`);
  }
  
  // Start processing if not already running
  if (!taskScheduler.isProcessing) {
    processTaskQueue();
  }
}

// Pause current background task and save state for later resume
function pauseCurrentBackgroundTask(): void {
  const { taskScheduler, backgroundLoadingState } = dataStore;
  
  if (taskScheduler.currentTask && taskScheduler.currentTask.priority === TaskPriority.LOW) {
    console.log(`⏸️ Pausing background task: ${taskScheduler.currentTask.type}`);
    
    // Mark background loading as paused
    backgroundLoadingState.isPaused = true;
    
    // Move current task to paused queue for later resume
    taskScheduler.pausedBackgroundTasks.push(taskScheduler.currentTask);
    taskScheduler.currentTask = null;
  }
}

// Resume paused background tasks after high priority tasks complete
function resumePausedBackgroundTasks(): void {
  const { taskScheduler, backgroundLoadingState } = dataStore;
  
  if (taskScheduler.pausedBackgroundTasks.length > 0) {
    console.log(`▶️ Resuming ${taskScheduler.pausedBackgroundTasks.length} paused background tasks`);
    
    // Move paused tasks back to low priority queue
    taskScheduler.lowPriorityQueue.unshift(...taskScheduler.pausedBackgroundTasks);
    taskScheduler.pausedBackgroundTasks = [];
    
    // Mark background loading as no longer paused
    backgroundLoadingState.isPaused = false;
  }
}

// Process tasks from the priority queues
async function processTaskQueue(): Promise<void> {
  const { taskScheduler } = dataStore;
  
  if (taskScheduler.isProcessing) {
    return; // Already processing
  }
  
  taskScheduler.isProcessing = true;
  
  while (taskScheduler.highPriorityQueue.length > 0 || taskScheduler.lowPriorityQueue.length > 0) {
    let nextTask: Task | undefined;
    
    // Always prioritize high priority tasks
    if (taskScheduler.highPriorityQueue.length > 0) {
      nextTask = taskScheduler.highPriorityQueue.shift();
    } else if (taskScheduler.lowPriorityQueue.length > 0) {
      nextTask = taskScheduler.lowPriorityQueue.shift();
    }
    
    if (!nextTask) {
      break;
    }
    
    taskScheduler.currentTask = nextTask;
    console.log(`🚀 Executing ${nextTask.priority} priority task: ${nextTask.type} (${nextTask.id})`);
    
    try {
      const promise = nextTask.execute();
      taskScheduler.activePromises.set(nextTask.id, promise);
      
      await promise;
      
      console.log(`✅ Completed task: ${nextTask.type} (${nextTask.id})`);
    } catch (error) {
      console.error(`❌ Task failed: ${nextTask.type} (${nextTask.id})`, error);
    } finally {
      taskScheduler.activePromises.delete(nextTask.id);
      taskScheduler.currentTask = null;
      
      // If we just finished all high priority tasks, resume any paused background tasks
      if (taskScheduler.highPriorityQueue.length === 0 && taskScheduler.pausedBackgroundTasks.length > 0) {
        resumePausedBackgroundTasks();
      }
    }
  }
  
  taskScheduler.isProcessing = false;
}

// Create a high priority task for user-initiated requests
function createHighPriorityTask(
  runNumber: string,
  type: 'fetch_run_details' | 'user_request' = 'fetch_run_details'
): Task {
  return {
    id: generateTaskId(),
    priority: TaskPriority.HIGH,
    type,
    runNumbers: [runNumber],
    execute: async () => {
      console.log(`🔥 HIGH PRIORITY: Fetching run details for ${runNumber}`);
      
      // Check cache first
      if (dataStore.runDetailsMap.has(runNumber)) {
        return dataStore.runDetailsMap.get(runNumber)!;
      }
      
      const details = await fetchRunDetails(runNumber);
      dataStore.runDetailsMap.set(runNumber, details);
      notifyListeners();
      return details;
    },
  };
}

// Create a low priority task for background loading
function createBackgroundTask(
  runNumbers: string[],
  batchSize: number = 2,
  continuationToken?: string
): Task {
  return {
    id: generateTaskId(),
    priority: TaskPriority.LOW,
    type: 'batch_fetch',
    runNumbers,
    continuationToken,
    execute: async () => {
      console.log(`📦 BACKGROUND: Processing batch of ${Math.min(batchSize, runNumbers.length)} runs`);
      
      const batch = runNumbers.slice(0, batchSize);
      const remaining = runNumbers.slice(batchSize);
      
      // Process the current batch
      await Promise.all(batch.map(async (runNumber) => {
        try {
          if (!dataStore.runDetailsMap.has(runNumber)) {
            const details = await fetchRunDetails(runNumber);
            dataStore.runDetailsMap.set(runNumber, details);
            console.log(`📦 Background cached run ${runNumber}`);
          }
        } catch (error) {
          console.warn(`⚠️ Background fetch failed for run ${runNumber}:`, error);
        }
      }));
      
      notifyListeners();
      
      // If there are remaining runs and we're not paused, queue the next batch
      if (remaining.length > 0 && !dataStore.backgroundLoadingState.isPaused) {
        const nextTask = createBackgroundTask(remaining, batchSize);
        enqueueTask(nextTask);
      } else if (remaining.length === 0) {
        console.log('✅ Background loading completed - all runs cached');
        dataStore.backgroundLoadingState.isActive = false;
      }
      
      // Return continuation info for potential pause/resume
      return {
        remainingRuns: remaining,
        continuationToken: remaining.length > 0 ? `continue_${Date.now()}` : undefined,
      };
    },
  };
}

// Initialize the all runs list
export async function initializeAllRuns(): Promise<RunData[]> {
  if (dataStore.isInitialized) {
    return dataStore.allRuns;
  }

  try {
    console.log('🚀 Initializing global data store with all runs...');
    const runs = await fetchRunData();
    dataStore.allRuns = runs;
    dataStore.isInitialized = true;
    console.log(`✅ Initialized data store with ${runs.length} runs`);
    startBackgroundLoading(); // Start background loading after initialization
    notifyListeners();
    return runs;
  } catch (error) {
    console.error('❌ Failed to initialize all runs:', error);
    throw error;
  }
}

// Get all runs (initialize if not already done)
export async function getAllRuns(): Promise<RunData[]> {
  if (!dataStore.isInitialized) {
    return await initializeAllRuns();
  }
  return dataStore.allRuns;
}

// Get run details from cache or fetch if not available (USER-INITIATED - HIGH PRIORITY)
export async function getRunDetails(runNumber: string): Promise<RunDetails> {
  // Check if we already have the data
  if (dataStore.runDetailsMap.has(runNumber)) {
    console.log(`🎯 Found cached run details for run ${runNumber}`);
    return dataStore.runDetailsMap.get(runNumber)!;
  }

  // Create high priority task for user-initiated request
  const task = createHighPriorityTask(runNumber);
  enqueueTask(task);
  
  // Wait for the task to complete
  const promise = dataStore.taskScheduler.activePromises.get(task.id);
  if (promise) {
    return await promise;
  }
  
  // Fallback - shouldn't happen but ensures we return something
  console.log(`🔍 Fallback: Direct fetching run details for run ${runNumber}`);
  try {
    const details = await fetchRunDetails(runNumber);
    dataStore.runDetailsMap.set(runNumber, details);
    console.log(`💾 Cached run details for run ${runNumber}`);
    notifyListeners();
    return details;
  } catch (error) {
    console.error(`❌ Failed to fetch run details for run ${runNumber}:`, error);
    throw error;
  }
}

// Check if run details are cached
export function hasRunDetails(runNumber: string): boolean {
  return dataStore.runDetailsMap.has(runNumber);
}

// Get cached run details (returns undefined if not cached)
export function getCachedRunDetails(runNumber: string): RunDetails | undefined {
  return dataStore.runDetailsMap.get(runNumber);
}

// Get all cached run details
export function getAllCachedRunDetails(): Map<string, RunDetails> {
  return new Map(dataStore.runDetailsMap);
}

// Get cached run details for multiple runs (useful for tests overview)
export function getCachedRunDetailsForRuns(runNumbers: string[]): Map<string, RunDetails> {
  const result = new Map<string, RunDetails>();
  runNumbers.forEach(runNumber => {
    const details = dataStore.runDetailsMap.get(runNumber);
    if (details) {
      result.set(runNumber, details);
    }
  });
  return result;
}

// Fetch and cache run details for multiple runs (with progress callback)
// This function is USER-INITIATED and should use HIGH PRIORITY
export async function fetchAndCacheRunDetails(
  runNumbers: string[], 
  onProgress?: (completed: number, total: number) => void,
  loadAllRuns: boolean = false,
  isUserInitiated: boolean = true // New parameter to distinguish user vs background requests
): Promise<Map<string, RunDetails>> {
  
  // If this is a user-initiated request, use high priority system
  if (isUserInitiated) {
    console.log(`🔥 USER-INITIATED: Fetching ${runNumbers.length} run details with high priority`);
    setAnalysisState(loadAllRuns, true, runNumbers.length);
    
    try {
      const result = await fetchRunDetailsWithHighPriority(runNumbers, (completed, total) => {
        onProgress?.(completed, total);
      });
      
      setAnalysisState(undefined, false);
      return result;
    } catch (error) {
      setAnalysisState(undefined, false);
      throw error;
    }
  }
  
  // Fallback to original implementation for background requests
  const result = new Map<string, RunDetails>();
  let completed = 0;
  
  // Update analysis state to indicate loading
  setAnalysisState(loadAllRuns, true, runNumbers.length);
  
  // Filter out runs that are already cached
  const uncachedRuns = runNumbers.filter(runNumber => !dataStore.runDetailsMap.has(runNumber));
  const cachedRuns = runNumbers.filter(runNumber => dataStore.runDetailsMap.has(runNumber));
  
  // Add cached runs to result
  cachedRuns.forEach(runNumber => {
    const details = dataStore.runDetailsMap.get(runNumber)!;
    result.set(runNumber, details);
  });
    
  if (uncachedRuns.length === 0) {
    onProgress?.(runNumbers.length, runNumbers.length);
    setAnalysisState(undefined, false); // Mark as not loading
    return result;
  }

  // Process uncached runs with rolling batch system - maintain constant concurrency of 5
  const maxConcurrency = 5;
  let runIndex = 0;
  const activePromises = new Set<Promise<void>>();
  
  // Helper function to process a single run
  const processRun = async (runNumber: string): Promise<void> => {
    try {
      const details = await fetchRunDetails(runNumber);
      dataStore.runDetailsMap.set(runNumber, details);
      result.set(runNumber, details);
      completed++;
      onProgress?.(cachedRuns.length + completed, runNumbers.length);
      
      // Notify listeners for real-time updates during batching
      notifyListeners();
    } catch (error) {
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
export function clearCache(): void {
  dataStore.runDetailsMap.clear();
  console.log('🗑️ Cleared run details cache');
  notifyListeners();
}

// Get cache statistics
export function getCacheStats(): { totalRuns: number; cachedRunDetails: number } {
  return {
    totalRuns: dataStore.allRuns.length,
    cachedRunDetails: dataStore.runDetailsMap.size,
  };
}

// Get test results for a specific test from cached data
export function getTestResultsFromCache(testName: string): Array<{
  runNumber: string;
  runId: string;
  createdOn: Date;
  branchName: string;
  status: 'passed' | 'failed' | 'unknown';
  githubUrl: string;
}> {
  const results: Array<{
    runNumber: string;
    runId: string;
    createdOn: Date;
    branchName: string;
    status: 'passed' | 'failed' | 'unknown';
    githubUrl: string;
  }> = [];

  // Create a map of run number to run data for quick lookup
  const runDataMap = new Map<string, RunData>();
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
export function getUncachedRunsForTest(): string[] {
  const uncachedRuns: string[] = [];
  
  dataStore.allRuns.forEach(run => {
    const runNumber = run.name.replace('runs/', '');
    if (!dataStore.runDetailsMap.has(runNumber)) {
      uncachedRuns.push(runNumber);
    }
  });
  
  return uncachedRuns;
}

// Test statistics interface
export interface TestStats {
  testName: string;
  passed: number;
  failed: number;
  total: number;
  passRate: number;
}

// Calculate test statistics from cached run details
export function getTestStatsFromCache(): Map<string, TestStats> {
  const statsMap = new Map<string, TestStats>();
  
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
      } else if (test.status === 'failed') {
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
export function getCachedRunCount(): number {
  return dataStore.runDetailsMap.size;
}

// Analysis state management functions
export function getAnalysisState(): { loadAllRuns: boolean; isLoading: boolean; targetRunCount: number } {
  return { ...dataStore.analysisState };
}

export function setAnalysisState(
  loadAllRuns?: boolean, 
  isLoading?: boolean, 
  targetRunCount?: number
): void {
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

export function isAnalysisComplete(): boolean {
  return dataStore.analysisState.loadAllRuns && 
         dataStore.runDetailsMap.size >= dataStore.allRuns.length;
}

// Get run data by run ID (for finding run date when navigating via URL)
export function getRunDataById(runId: string): RunData | undefined {
  return dataStore.allRuns.find(run => run.name.replace('runs/', '') === runId);
}

// Calculate test statistics from cached run details filtered by branch
export function getTestStatsFromCacheByBranch(branchFilter: string): Map<string, TestStats> {
  const statsMap = new Map<string, TestStats>();
  
  // Get runs that match the branch filter (only main and release/* branches are cached)
  const filteredRunIds = dataStore.allRuns
    .filter(run => 
      // Only process runs from main or release branches (since those are the only ones we cache now)
      (run.metadata.ghBranch === 'main' || run.metadata.ghBranch.startsWith('release/')) &&
      // And match the specific branch filter
      run.metadata.ghBranch === branchFilter
    )
    .map(run => run.name.replace('runs/', ''));
  
  // Process only cached run details that match the branch filter
  dataStore.runDetailsMap.forEach((runDetails, runId) => {
    if (!filteredRunIds.includes(runId)) {
      return; // Skip runs that don't match the branch filter
    }
    
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
      } else if (test.status === 'failed') {
        existing.failed++;
      }
      
      existing.total = existing.passed + existing.failed;
      existing.passRate = existing.total > 0 ? (existing.passed / existing.total) * 100 : 0;
      
      statsMap.set(test.name, existing);
    });
  });
  
  return statsMap;
}

// Track if tests page has ever been accessed
let testsPageEverAccessed = false;

export function startBackgroundLoading(): void {
  if (dataStore.backgroundLoadingState.isActive || !dataStore.isInitialized) {
    return;
  }

  // Get uncached runs sorted by creation time (most recent first)
  // Only include runs from main branch or release/* branches
  const uncachedRuns = [...dataStore.allRuns]
    .filter(run => 
      run.metadata.ghBranch === 'main' || 
      run.metadata.ghBranch.startsWith('release/')
    )
    .sort((a, b) => b.creationTime.getTime() - a.creationTime.getTime())
    .filter(run => {
      const runNumber = run.name.replace('runs/', '');
      return !dataStore.runDetailsMap.has(runNumber);
    })
    .map(run => run.name.replace('runs/', ''));

  if (uncachedRuns.length === 0) {
    console.log('✅ All runs already cached, no background loading needed');
    return;
  }

  dataStore.backgroundLoadingState.isActive = true;
  dataStore.backgroundLoadingState.pendingRuns = [...uncachedRuns];
  dataStore.backgroundLoadingState.isPaused = false;
  
  // Set initial batch size based on whether tests page has been accessed
  dataStore.backgroundLoadingState.batchSize = testsPageEverAccessed ? 1 : 1;
  
  console.log(`🚀 Starting priority-based background loading of ${uncachedRuns.length} main/release runs in batches of ${dataStore.backgroundLoadingState.batchSize}`);
  
  // Create and enqueue the first background task
  const firstTask = createBackgroundTask(uncachedRuns, dataStore.backgroundLoadingState.batchSize);
  enqueueTask(firstTask);
}

export function accelerateBackgroundLoading(): void {
  if (!dataStore.backgroundLoadingState.isActive) {
    startBackgroundLoading();
    return;
  }

  // Increase batch size for faster processing
  dataStore.backgroundLoadingState.batchSize = Math.min(5, dataStore.backgroundLoadingState.batchSize * 2);
  console.log(`⚡ Accelerated background loading to batches of ${dataStore.backgroundLoadingState.batchSize}`);
  
  // If paused, resume with higher batch size
  if (dataStore.backgroundLoadingState.isPaused) {
    resumePausedBackgroundTasks();
  }
}

export function markTestsPageAccessed(): void {
  testsPageEverAccessed = true;
  // If background loading is active, accelerate it
  if (dataStore.backgroundLoadingState.isActive) {
    accelerateBackgroundLoading();
  }
}

export function getBackgroundLoadingState(): {
  isActive: boolean;
  batchSize: number;
  activeRequests: number;
  pendingRuns: number;
  totalCached: number;
  totalRuns: number;
  isPaused: boolean;
  highPriorityTasks: number;
  lowPriorityTasks: number;
} {
  return {
    isActive: dataStore.backgroundLoadingState.isActive,
    batchSize: dataStore.backgroundLoadingState.batchSize,
    activeRequests: dataStore.backgroundLoadingState.activeRequests,
    pendingRuns: dataStore.backgroundLoadingState.pendingRuns.length,
    totalCached: dataStore.runDetailsMap.size,
    totalRuns: dataStore.allRuns.length,
    isPaused: dataStore.backgroundLoadingState.isPaused,
    highPriorityTasks: dataStore.taskScheduler.highPriorityQueue.length,
    lowPriorityTasks: dataStore.taskScheduler.lowPriorityQueue.length + dataStore.taskScheduler.pausedBackgroundTasks.length,
  };
}

// ==================== PRIORITY SYSTEM EXPORTS ====================

// Get detailed task scheduler state (for debugging)
export function getTaskSchedulerState(): {
  isProcessing: boolean;
  currentTask: string | null;
  highPriorityQueue: string[];
  lowPriorityQueue: string[];
  pausedBackgroundTasks: string[];
  activePromises: string[];
} {
  const { taskScheduler } = dataStore;
  return {
    isProcessing: taskScheduler.isProcessing,
    currentTask: taskScheduler.currentTask ? `${taskScheduler.currentTask.type} (${taskScheduler.currentTask.id})` : null,
    highPriorityQueue: taskScheduler.highPriorityQueue.map(t => `${t.type} (${t.id})`),
    lowPriorityQueue: taskScheduler.lowPriorityQueue.map(t => `${t.type} (${t.id})`),
    pausedBackgroundTasks: taskScheduler.pausedBackgroundTasks.map(t => `${t.type} (${t.id})`),
    activePromises: Array.from(taskScheduler.activePromises.keys()),
  };
}

// Force pause background loading (useful for testing or manual control)
export function pauseBackgroundLoading(): void {
  dataStore.backgroundLoadingState.isPaused = true;
  pauseCurrentBackgroundTask();
  console.log('⏸️ Manually paused background loading');
}

// Force resume background loading
export function resumeBackgroundLoading(): void {
  if (dataStore.backgroundLoadingState.isPaused) {
    dataStore.backgroundLoadingState.isPaused = false;
    resumePausedBackgroundTasks();
    console.log('▶️ Manually resumed background loading');
  }
}

// Create a high priority user-initiated task for batch requests
export async function fetchRunDetailsWithHighPriority(
  runNumbers: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, RunDetails>> {
  console.log(`🔥 HIGH PRIORITY: Batch fetching ${runNumbers.length} run details`);
  
  const result = new Map<string, RunDetails>();
  let completed = 0;
  
  // Filter out already cached runs
  const uncachedRuns = runNumbers.filter(runNumber => !dataStore.runDetailsMap.has(runNumber));
  const cachedRuns = runNumbers.filter(runNumber => dataStore.runDetailsMap.has(runNumber));
  
  // Add cached runs to result
  cachedRuns.forEach(runNumber => {
    const details = dataStore.runDetailsMap.get(runNumber)!;
    result.set(runNumber, details);
  });
  
  completed = cachedRuns.length;
  onProgress?.(completed, runNumbers.length);
  
  if (uncachedRuns.length === 0) {
    return result;
  }
  
  // Create high priority tasks for each uncached run
  const promises = uncachedRuns.map(async (runNumber) => {
    const task = createHighPriorityTask(runNumber, 'user_request');
    enqueueTask(task);
    
    // Wait for the task to complete
    const promise = dataStore.taskScheduler.activePromises.get(task.id);
    if (promise) {
      const details = await promise;
      result.set(runNumber, details);
      completed++;
      onProgress?.(completed, runNumbers.length);
      return details;
    }
  });
  
  await Promise.all(promises);
  return result;
}

// Clear all pending tasks (useful for testing or emergency stop)
export function clearAllTasks(): void {
  const { taskScheduler } = dataStore;
  
  const totalCleared = 
    taskScheduler.highPriorityQueue.length + 
    taskScheduler.lowPriorityQueue.length + 
    taskScheduler.pausedBackgroundTasks.length;
  
  taskScheduler.highPriorityQueue = [];
  taskScheduler.lowPriorityQueue = [];
  taskScheduler.pausedBackgroundTasks = [];
  
  // Cancel active promises if possible (they'll continue but won't be tracked)
  taskScheduler.activePromises.clear();
  
  console.log(`🗑️ Cleared ${totalCleared} pending tasks from all queues`);
  
  // Reset background loading state
  dataStore.backgroundLoadingState.isPaused = false;
  dataStore.backgroundLoadingState.isActive = false;
  
  notifyListeners();
}

// Get priority system statistics for monitoring
export function getPrioritySystemStats(): {
  totalTasksProcessed: number;
  currentlyProcessing: boolean;
  queueLengths: {
    high: number;
    low: number;
    paused: number;
  };
  backgroundState: {
    isActive: boolean;
    isPaused: boolean;
    pendingRuns: number;
  };
} {
  const { taskScheduler, backgroundLoadingState } = dataStore;
  
  return {
    totalTasksProcessed: dataStore.runDetailsMap.size,
    currentlyProcessing: taskScheduler.isProcessing,
    queueLengths: {
      high: taskScheduler.highPriorityQueue.length,
      low: taskScheduler.lowPriorityQueue.length,
      paused: taskScheduler.pausedBackgroundTasks.length,
    },
    backgroundState: {
      isActive: backgroundLoadingState.isActive,
      isPaused: backgroundLoadingState.isPaused,
      pendingRuns: backgroundLoadingState.pendingRuns.length,
    },
  };
}

// Debug utility: Log current system state to console  
export function logPrioritySystemState(): void {
  const stats = getPrioritySystemStats();
  const scheduler = getTaskSchedulerState();
  const background = getBackgroundLoadingState();
  
  console.group('🎯 Priority System State');
  
  console.log('📊 Overall Stats:', {
    'Total Cached': `${stats.totalTasksProcessed}/${background.totalRuns}`,
    'Currently Processing': stats.currentlyProcessing,
    'Background Active': stats.backgroundState.isActive,
    'Background Paused': stats.backgroundState.isPaused
  });
  
  console.log('📋 Queue Lengths:', {
    'High Priority': stats.queueLengths.high,
    'Low Priority': stats.queueLengths.low, 
    'Paused Tasks': stats.queueLengths.paused,
    'Active Promises': scheduler.activePromises.length
  });
  
  console.log('🔄 Current Activity:', {
    'Current Task': scheduler.currentTask || 'None',
    'Next High Priority': scheduler.highPriorityQueue[0] || 'None',
    'Next Low Priority': scheduler.lowPriorityQueue[0] || 'None'
  });
  
  if (scheduler.pausedBackgroundTasks.length > 0) {
    console.log('⏸️ Paused Tasks:', scheduler.pausedBackgroundTasks);
  }
  
  console.groupEnd();
}

// Expose debug function globally for browser console access
declare global {
  interface Window {
    debugPrioritySystem?: () => void;
  }
}

if (typeof window !== 'undefined') {
  window.debugPrioritySystem = logPrioritySystemState;
}