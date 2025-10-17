import { QueryClient } from "@tanstack/react-query";
import type {
  RunData,
  RunMetadata,
  TestResult,
  RunDetailsData,
  TestRunInfo,
  TestData,
} from "./data_defs";

// --------------------------------------------
// GitHub Pull Requests Prefetching
// --------------------------------------------
// Mapping of PR number (as string) -> PR title
export type PullRequestAuthorMap = Record<string, string>;

export async function getGithubPullRequests(): Promise<PullRequestAuthorMap> {
  try {
    // Fetch first three pages in parallel. Each page returns up to 25 PRs.
    const pagePromises = [1, 2, 3, 4].map((p) =>
      getGithubPullRequestsPage(p).catch(() => ({}) as PullRequestAuthorMap)
    );
    const pageMaps = await Promise.all(pagePromises);
    // Merge (later pages won't overwrite earlier ones if duplicate numbers appear, but duplicates are unlikely)
    const merged: PullRequestAuthorMap = {};
    for (const m of pageMaps) {
      for (const k in m) {
        if (!Object.prototype.hasOwnProperty.call(merged, k)) {
          merged[k] = m[k];
        }
      }
    }
    console.log("[getGithubPullRequests] Fetched PR titles for", merged);
    return merged;
  } catch (e) {
    console.warn("[getGithubPullRequests] Failed to aggregate pages", e);
    return {};
  }
}

/**
 * Fetch latest open pull requests from microsoft/openvmm and build a mapping
 * from PR title -> author login. Returns an empty object on any failure so that
 * prefetch errors never block the UI.
 */
export async function getGithubPullRequestsPage(
  number: number
): Promise<PullRequestAuthorMap> {
  const url = `https://api.github.com/repos/microsoft/openvmm/pulls?state=all&sort=updated&direction=desc&per_page=50&page=${number}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) {
      console.warn(
        "[getGithubPullRequests] Non-OK response",
        res.status,
        res.statusText
      );
      return {};
    }
    const data = await res.json();
    if (!Array.isArray(data)) return {};
    const map: PullRequestAuthorMap = {};
    for (const pr of data) {
      if (pr && typeof pr.title === "string" && typeof pr.number === "number") {
        map[pr.number] = pr.title;
      }
    }
    return map;
  } catch (e) {
    console.warn("[getGithubPullRequests] Failed to fetch PRs", e);
    return {};
  }
}

/**
 * Start background data prefetching and refetching for the runs list.
 * This ensures the homepage loads instantly and data stays fresh.
 */
export function startDataPrefetching(queryClient: QueryClient): void {
  // Initial prefetch for instant first load
  void queryClient.prefetchQuery({
    queryKey: ["runs"],
    queryFn: () => fetchRunData(queryClient),
    staleTime: 3 * 60 * 1000, // 3 min stale window
    gcTime: Infinity, // never garbage collect. Runs data always stays in memory
  });

  // Prefetch GitHub PR author map (never stale / never GC so we only fetch once per session)
  void queryClient.prefetchQuery({
    queryKey: ["prs"],
    queryFn: () => getGithubPullRequests(),
    staleTime: Infinity, // never goes stale
    gcTime: Infinity, // keep forever
  });

  // Background refetch every 2 minutes to keep data fresh
  setInterval(
    () => {
      void queryClient.refetchQueries({
        queryKey: ["runs"],
        type: "all", // Keeps the runs data current no matter what!
      });
    },
    2 * 60 * 1000
  ); // Refetch every 2 min
}

/**
 * Fetch run details for runs filtered by branch.
 * Returns a map of testName -> TestRunInfo[].
 *
 * @param getConcurrency - Optional callback to get current max concurrent requests (defaults to 5)
 */
export async function fetchTestAnalysis(
  branchFilter: string,
  queryClient: QueryClient,
  onProgress?: (fetched: number, total: number) => void,
  getConcurrency?: () => number
): Promise<Map<string, TestRunInfo[]>> {
  // Fetch all runs
  const runs = await queryClient.ensureQueryData<RunData[]>({
    queryKey: ["runs"],
    queryFn: () => fetchRunData(queryClient),
    staleTime: 2 * 60 * 1000, // refetch every 2 minutes
    gcTime: Infinity, // never garbage collect
  });

  // Filter runs based on branch selection
  const filteredRuns = runs.filter(
    (run) => run.metadata.ghBranch === branchFilter
  );

  const totalToFetch = filteredRuns.length;
  let fetchedCount = 0;

  // Prefetch with controlled parallelism - maintains constant concurrent requests
  // Use dynamic concurrency if provided, otherwise default to 5
  const runIds: string[] = [];

  const prefetchRun = async (run: RunData) => {
    const runId = run.name.split("/")[1]; // run.name is "runs/123456789", we want "123456789"
    const key = ["runDetails", runId];

    // Skip if already cached
    if (queryClient.getQueryData(key)) {
      fetchedCount++;
      if (onProgress) {
        onProgress(fetchedCount, totalToFetch);
      }
      return runId;
    }

    try {
      await queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => fetchRunDetails(runId, queryClient),
        staleTime: Infinity, // never goes stale because this data should never change
        gcTime: Infinity, // never garbage collect
      });

      // Increment counter and report progress after each prefetch completes
      fetchedCount++;
      if (onProgress) {
        onProgress(fetchedCount, totalToFetch);
      }

      return runId;
    } catch (e) {
      console.warn(`[fetchTestAnalysis] Prefetch failed for run ${runId}`, e);
      fetchedCount++;
      if (onProgress) {
        onProgress(fetchedCount, totalToFetch);
      }
      return runId;
    }
  };

  // Process with rolling window - always keep maxConcurrent requests in flight
  let currentIndex = 0;
  const inFlight = new Set<Promise<string>>();

  while (currentIndex < filteredRuns.length || inFlight.size > 0) {
    // Get current concurrency limit (can change dynamically)
    const maxConcurrent = getConcurrency ? getConcurrency() : 5;

    // Fill up to maxConcurrent
    while (
      currentIndex < filteredRuns.length &&
      inFlight.size < maxConcurrent
    ) {
      const promise = prefetchRun(filteredRuns[currentIndex]);
      inFlight.add(promise);
      currentIndex++;

      // Clean up when done and collect result
      promise.then(
        (runId) => {
          inFlight.delete(promise);
          if (runId) runIds.push(runId);
        },
        () => {
          inFlight.delete(promise);
        }
      );
    }

    // Wait for at least one to complete before continuing
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }

  // Build the map from cached data
  const runDetailsMap = new Map<string, RunDetailsData>();
  runIds.forEach((runId) => {
    const runDetails = queryClient.getQueryData<RunDetailsData>([
      "runDetails",
      runId,
    ]);
    if (runDetails) {
      runDetailsMap.set(runId, runDetails);
    }
  });

  // Create mapping of testName -> TestRunInfo[]
  const testMapping = new Map<string, TestRunInfo[]>();

  runDetailsMap.forEach((runDetails) => {
    runDetails.tests.forEach((test) => {
      const testName = test.name;
      const testRunInfo: TestRunInfo = {
        runNumber: runDetails.runNumber,
        status: test.status,
        creationTime: runDetails.creationTime,
      };

      if (!testMapping.has(testName)) {
        testMapping.set(testName, []);
      }
      testMapping.get(testName)!.push(testRunInfo);
    });
  });

  return testMapping;
}

/**
 * Convert test mapping to table data.
 * Transforms a map of test names to their run information into a flat array of TestData.
 */
export function convertToTestData(
  testMapping: Map<string, TestRunInfo[]>
): TestData[] {
  const data: TestData[] = [];

  testMapping.forEach((runInfos, testName) => {
    const failedCount = runInfos.filter(
      (info) => info.status === "failed"
    ).length;
    const split = testName.split("/");
    const totalCount = runInfos.length;

    data.push({
      architecture: split[0],
      name: split[1],
      failedCount,
      totalCount,
    });
  });

  return data;
}

/**
 * Convert test mapping to test details data for a specific test.
 * Extracts the run information for a single test from the mapping.
 */
export function convertToTestDetailsData(
  testMapping: Map<string, TestRunInfo[]>,
  testName: string
): TestRunInfo[] {
  const testRunInfos = testMapping.get(testName);
  return testRunInfos || [];
}

// Main export function - fetches and returns parsed run data
export async function fetchRunData(
  queryClient: QueryClient
): Promise<RunData[]> {
  try {
    const url =
      "https://openvmmghtestresults.blob.core.windows.net/results?restype=container&comp=list&showonly=files&include=metadata&prefix=runs/";
    const response = await fetch(url);
    const data = await response.text();

    // Parse the data and get the runs array
    const runs = parseRunData(data, queryClient);

    // Collect all PR numbers that need titles
    const prNumbers = runs
      .map((run) => run.metadata.ghPr)
      .filter((pr): pr is string => pr !== undefined);

    if (prNumbers.length > 0) {
      // Use the aggregated PR map (prefetched under key 'prs'). Never stale / never GC.
      const prMap = await queryClient.ensureQueryData<PullRequestAuthorMap>({
        queryKey: ["prs"],
        queryFn: () => getGithubPullRequests(),
        staleTime: Infinity,
        gcTime: Infinity,
      });
      console.log("When parsing run data, using the map: ", prMap);
      runs.forEach((run) => {
        const pr = run.metadata.ghPr;
        if (pr && prMap[pr]) {
          run.metadata.prTitle = prMap[pr];
        }
      });
    }

    return runs;
  } catch (error) {
    console.error("Error fetching run data:", error);
    throw error;
  }
}

// (Deprecated) fetchSinglePRTitle removed in favor of bulk getGithubPullRequests map.

// Function to parse XML run data into structured format
function parseRunData(xmlText: string, queryClient: QueryClient): RunData[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");

  // Parse each blob
  const blobs = xmlDoc.getElementsByTagName("Blob");
  const runs: RunData[] = [];

  for (const blob of blobs) {
    const name = blob.getElementsByTagName("Name")[0]?.textContent || "";
    const creationTime = new Date(
      blob.getElementsByTagName("Creation-Time")[0]?.textContent || ""
    );
    const lastModified = new Date(
      blob.getElementsByTagName("Last-Modified")[0]?.textContent || ""
    );
    const etag = blob.getElementsByTagName("Etag")[0]?.textContent || "";
    const contentLength = parseInt(
      blob.getElementsByTagName("Content-Length")[0]?.textContent || "0"
    );

    // Parse metadata
    const metadataElement = blob.getElementsByTagName("Metadata")[0];
    const metadata: RunMetadata = {
      petriFailed: parseInt(
        metadataElement?.getElementsByTagName("petrifailed")[0]?.textContent ||
          "0"
      ),
      petriPassed: parseInt(
        metadataElement?.getElementsByTagName("petripassed")[0]?.textContent ||
          "0"
      ),
      ghBranch:
        metadataElement?.getElementsByTagName("ghbranch")[0]?.textContent || "",
      ghPr:
        metadataElement?.getElementsByTagName("ghpr")[0]?.textContent ||
        undefined,
    };

    runs.push({
      name,
      creationTime,
      lastModified,
      etag,
      contentLength,
      metadata,
    });
  }

  // Trigger background data prefetching of runDetails
  opportunisticPrefetching(runs, queryClient);
  return runs;
}

/**
 * We avoid duplicate work and run this in the background so initial render isn't blocked.
 * Prefetches in batches of 5 concurrent requests to balance speed vs resource usage.
 */
function opportunisticPrefetching(
  runs: RunData[],
  queryClient: QueryClient
): void {
  try {
    // Sort all runs by creation time descending
    const sortedRuns = [...runs].sort(
      (a, b) => b.creationTime.getTime() - a.creationTime.getTime()
    );

    const extractRunNumber = (name: string) => {
      const runNumberFull = name.replace(/^runs\//, "");
      return runNumberFull.split("/")[0];
    };

    void (async () => {
      const prefetched = new Set<string>();
      const prefetchList: string[] = [];

      // Step 1: First 7 failed runs
      const failedRuns = sortedRuns.filter((r) => r.metadata.petriFailed > 0);
      const first7Failed = failedRuns.slice(0, 7);
      for (const run of first7Failed) {
        const runNumber = extractRunNumber(run.name);
        if (runNumber) {
          prefetchList.push(runNumber);
          prefetched.add(runNumber);
        }
      }

      // Step 2: Top 10 runs overall (regardless of status/branch)
      const top10 = sortedRuns.slice(0, 10);
      for (const run of top10) {
        const runNumber = extractRunNumber(run.name);
        if (runNumber && !prefetched.has(runNumber)) {
          prefetchList.push(runNumber);
          prefetched.add(runNumber);
        }
      }

      // Step 3: Last 7 runs on main branch
      const mainRuns = sortedRuns
        .filter((r) => r.metadata.ghBranch === "main")
        .slice(0, 7);
      for (const run of mainRuns) {
        const runNumber = extractRunNumber(run.name);
        if (runNumber && !prefetched.has(runNumber)) {
          prefetchList.push(runNumber);
          prefetched.add(runNumber);
        }
      }

      // Prefetch with controlled parallelism (5 concurrent requests at a time)
      const BATCH_SIZE = 5;
      const prefetchRun = async (runNumber: string) => {
        const key = ["runDetails", runNumber];
        if (queryClient.getQueryData(key)) return;
        try {
          await queryClient.prefetchQuery({
            queryKey: key,
            queryFn: () => fetchRunDetails(runNumber, queryClient),
            staleTime: Infinity,
            gcTime: Infinity,
          });
        } catch (e) {
          console.warn(
            `[opportunisticPrefetching] Prefetch failed for run ${runNumber}`,
            e
          );
        }
      };

      // Process in batches to limit concurrent requests
      for (let i = 0; i < prefetchList.length; i += BATCH_SIZE) {
        const batch = prefetchList.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map((runNumber) => prefetchRun(runNumber))
        );
      }
    })();
  } catch (e) {
    console.warn(
      "[opportunisticPrefetching] Failed to schedule runDetails prefetch",
      e
    );
  }
}

// Function to parse detailed run data from XML using lightweight regex parsing
function parseRunDetails(
  xmlText: string,
  runNumber: string,
  queryClient: QueryClient
): RunDetailsData {
  const testFolders = new Map<
    string,
    { hasJsonl: boolean; hasPassed: boolean }
  >();

  // Extract creation time from the first blob
  let creationTime: Date | null = null;
  try {
    const creationTimeMatch = xmlText.match(
      /<Creation-Time>([^<]+)<\/Creation-Time>/
    );
    if (creationTimeMatch) {
      const parsedDate = new Date(creationTimeMatch[1]);
      if (!isNaN(parsedDate.getTime())) {
        creationTime = parsedDate;
      }
    }
  } catch {
    // If parsing fails, creationTime remains null
  }

  // Regex to extract Name elements from Blob entries
  // This avoids creating a full DOM tree and just scans the text
  const nameRegex = /<Name>([^<]+)<\/Name>/g;

  let match;
  while ((match = nameRegex.exec(xmlText)) !== null) {
    const name = match[1];
    const nameParts = name.split("/");
    const fileName = nameParts[nameParts.length - 1];

    // Skip if not a test result file
    if (fileName !== "petri.jsonl" && fileName !== "petri.passed") {
      continue;
    }

    // Extract test folder path (everything except the filename)
    const testFolderPath = nameParts.slice(0, -1).join("/");

    // Initialize or update the test folder tracking
    if (!testFolders.has(testFolderPath)) {
      testFolders.set(testFolderPath, { hasJsonl: false, hasPassed: false });
    }

    const folder = testFolders.get(testFolderPath)!;
    if (fileName === "petri.jsonl") {
      folder.hasJsonl = true;
    } else if (fileName === "petri.passed") {
      folder.hasPassed = true;
    }
  }

  // Second pass: create test results based on the logic from old implementation
  const tests: TestResult[] = [];

  for (const [testFolderPath, folder] of testFolders) {
    // Only process folders that have petri.jsonl (these are test result folders)
    if (!folder.hasJsonl) {
      continue;
    }

    const pathParts = testFolderPath.split("/");

    // The path structure should be: runNumber/architecture/jobName/testName
    // Since runNumber is just the number, we need to remove it from the path
    if (pathParts.length >= 2) {
      // Remove the run number prefix from the path parts
      const cleanPathParts = pathParts.slice(1); // Skip the first part which is the run number

      if (cleanPathParts.length >= 2) {
        // Now we have: architecture/jobName/testName (or more levels)
        const architecture = cleanPathParts[0];
        const testName = cleanPathParts.slice(1).join("/"); // Everything after architecture

        // Determine status: if folder has petri.passed, it's passed; otherwise failed
        const status: "passed" | "failed" = folder.hasPassed
          ? "passed"
          : "failed";

        // Create a clean test name that includes architecture for grouping
        const fullTestName = `${architecture}/${testName}`;

        tests.push({
          name: fullTestName,
          status,
          path: testFolderPath,
        });
      }
    }
  }

  // Sort tests by name
  tests.sort((a, b) => a.name.localeCompare(b.name));

  // Prefetch petri.jsonl ONLY for failed tests (background, non-blocking)
  try {
    const prefetchPromises: Promise<unknown>[] = [];
    for (const test of tests) {
      if (test.status !== "failed") continue; // only failed tests
      const firstSlash = test.name.indexOf("/");
      if (firstSlash === -1) continue; // malformed name
      const architecture = test.name.slice(0, firstSlash);
      const remainder = test.name.slice(firstSlash + 1); // may contain further slashes
      const queryKey = ["petriLog", runNumber, architecture, remainder];
      prefetchPromises.push(
        queryClient.fetchQuery({
          queryKey,
          queryFn: () =>
            fetchProcessedPetriLog(runNumber, architecture, remainder),
          staleTime: 60 * 1000, // 1 min stale window for logs
          gcTime: 60 * 1000,
        })
      );
    }
    if (prefetchPromises.length) {
      Promise.allSettled(prefetchPromises).then((res) => {
        const failed = res.filter((r) => r.status === "rejected").length;
        if (failed) {
          console.warn(
            `[parseRunDetails] ${failed} petri.jsonl prefetches failed for run ${runNumber}`
          );
        }
      });
    }
  } catch (e) {
    console.warn("[parseRunDetails] Prefetch phase error", e);
  }

  return {
    creationTime: creationTime ?? undefined,
    runNumber,
    tests,
  };
}

/**
 * Fetch detailed run information (listing of test result folders) for a run number.
 * When a QueryClient is supplied we proactively prefetch & cache the content of
 * any petri.jsonl (and petri.passed) files discovered during the blob listing.
 */
export async function fetchRunDetails(
  runNumber: string,
  queryClient: QueryClient
): Promise<RunDetailsData> {
  try {
    let allTests: TestResult[] = [];
    let continuationToken: string | null = null;
    let creationTime: Date | null = null;

    do {
      // Build URL with continuation token if we have one
      // TODO: If heirarchical namespaces are supported this fetch call might go by much faster. Try this out in a non-prod environment first to try it out
      let url = `https://openvmmghtestresults.blob.core.windows.net/results?restype=container&comp=list&showonly=files&prefix=${encodeURIComponent(runNumber)}`;
      if (continuationToken) {
        url += `&marker=${encodeURIComponent(continuationToken)}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch run details: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.text();
      const pageResults = parseRunDetails(data, runNumber, queryClient);

      if (!creationTime && pageResults.creationTime) {
        creationTime = pageResults.creationTime;
      }

      // Merge tests from this page
      allTests.push(...pageResults.tests);

      // Check for NextMarker using regex instead of DOMParser (more memory efficient)
      const nextMarkerMatch = data.match(/<NextMarker>([^<]+)<\/NextMarker>/);
      continuationToken = nextMarkerMatch ? nextMarkerMatch[1] : null;
    } while (continuationToken);

    // Sort all tests by name
    allTests.sort((a, b) => a.name.localeCompare(b.name));
    return {
      creationTime: creationTime ?? undefined,
      runNumber,
      tests: allTests,
    };
  } catch (error) {
    console.error(`Error fetching run details for ${runNumber}:`, error);
    throw error;
  }
}

/**
 * Fetch the raw petri.jsonl log content for a given run / architecture / test path.
 * Path layout (simplified, no job dimension):
 *   runs are stored under: <runId>/<architecture?>/<testNameRemainder>/petri.jsonl
 * If architecture is empty/undefined we omit that path element.
 * Returns the resolved URL and raw text (may be empty string if file exists but is blank).
 */
export async function fetchPetriLog(
  runId: string,
  architecture: string | undefined,
  testNameRemainder: string
): Promise<{ url: string; text: string }> {
  if (!runId) throw new Error("runId required");
  const parts: string[] = [runId];
  if (architecture) parts.push(architecture);
  if (testNameRemainder) parts.push(testNameRemainder);
  const url = `https://openvmmghtestresults.blob.core.windows.net/results/${parts.join("/")}/petri.jsonl`;
  console.log("[fetchPetriLog] Fetching", url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch petri log (${response.status} ${response.statusText}) for ${url}`
    );
  }
  const text = await response.text();
  return { url, text };
}

// --------------------------------------------
// petri.jsonl parsing (raw records only)
// --------------------------------------------

export interface RawPetriRecord {
  timestamp: string;
  message?: string;
  severity?: string;
  source?: string;
  attachment?: string;
  // Allow arbitrary extra properties without losing information
  [key: string]: any;
}

/**
 * Parse a petri.jsonl file (newline-delimited JSON objects) into an array of raw records.
 * - Trims empty lines
 * - JSON parses each line
 * - Sorts ascending by timestamp (stable)
 * Throws on first parse error to surface corrupt data quickly.
 */
export function parsePetriLogText(text: string): RawPetriRecord[] {
  if (!text) return [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const records: RawPetriRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && obj.timestamp) {
        records.push(obj as RawPetriRecord);
      } else {
        // Still push to avoid silent data loss; timestamp-less entries sort to front
        records.push(obj as RawPetriRecord);
      }
    } catch (e) {
      throw new Error(
        `Failed to parse petri.jsonl line ${i + 1}: ${(e as Error).message}`
      );
    }
  }

  records.sort((a, b) => {
    const ta = new Date(a.timestamp || 0).getTime();
    const tb = new Date(b.timestamp || 0).getTime();
    return ta - tb;
  });
  return records;
}

// --------------------------------------------
// Processed petri log entries (UI friendly)
// --------------------------------------------

export interface ProcessedLogEntry {
  index: number;
  timestamp: string;
  relative: string;
  severity: string;
  source: string;
  messageHtml: string; // sanitized HTML with ANSI styling & attachment links
  messageText: string; // plain lowercase text for filtering
  screenshot: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function removeTimestampPrefix(orig: string, entryTimestamp: Date): string {
  const message = orig.trim();
  const i = message.indexOf(" ");
  if (i === -1) return orig;
  let ts = message.slice(0, i);
  if (ts.endsWith("s")) {
    // relative like 12.345s
    const secs = parseFloat(ts.slice(0, -1));
    if (!isNaN(secs)) return message.slice(i + 1);
  }
  if (ts.startsWith("[")) ts = ts.slice(1, -1);
  const parsedTs = new Date(ts);
  if (isNaN(parsedTs.getTime())) return orig;
  parsedTs.setMilliseconds(0);
  const truncated = new Date(entryTimestamp.getTime());
  truncated.setMilliseconds(0);
  if (parsedTs.getTime() !== truncated.getTime()) return orig;
  return message.slice(i + 1);
}

function extractSeverity(
  orig: string,
  defaultSeverity: string
): { message: string; severity: string } {
  const severityLevels = ["ERROR", "WARN", "INFO", "DEBUG"];
  const trimmed = orig.trim();
  for (const lvl of severityLevels) {
    if (trimmed.startsWith(lvl)) {
      return { message: trimmed.slice(lvl.length + 1), severity: lvl };
    }
  }
  return { message: orig, severity: defaultSeverity };
}

function formatRelative(start: string, current: string): string {
  const deltaMs = new Date(current).getTime() - new Date(start).getTime();
  const sec = ((deltaMs / 1000) % 60).toFixed(3);
  const min = Math.floor((deltaMs / 60000) % 60);
  const hr = Math.floor(deltaMs / 3600000);
  return `${hr > 0 ? hr + "h " : ""}${min}m ${sec}s`;
}

// Map ANSI SGR codes to inline styles (subset used in original UI)
const ANSI_STYLE_MAP: Record<string, string> = {
  "1": "font-weight:bold",
  "3": "font-style:italic",
  "4": "text-decoration:underline",
  "30": "color:black",
  "31": "color:red",
  "32": "color:green",
  "33": "color:#b58900",
  "34": "color:blue",
  "35": "color:magenta",
  "36": "color:cyan",
  "37": "color:white",
  "90": "color:gray",
  "91": "color:lightcoral",
  "92": "color:lightgreen",
  "93": "color:gold",
  "94": "color:lightskyblue",
  "95": "color:plum",
  "96": "color:lightcyan",
  "97": "color:white",
  "39": "color:inherit",
};

function ansiToHtml(str: string): string {
  const ESC_REGEX = /\u001b\[([0-9;]*)m/g;
  let html = "";
  let lastIndex = 0;
  let current: string[] = [];
  const flush = (text: string) => {
    if (!text) return;
    const esc = escapeHtml(text);
    if (current.length) {
      html += `<span style="${current.join(";")}">${esc}</span>`;
    } else {
      html += esc;
    }
  };
  for (const match of str.matchAll(ESC_REGEX)) {
    const [full, codesStr] = match;
    const idx = match.index || 0;
    flush(str.slice(lastIndex, idx));
    const codes = codesStr.split(";").filter((c) => c.length > 0);
    for (const code of codes) {
      if (code === "0") {
        current = [];
        continue;
      }
      const style = ANSI_STYLE_MAP[code];
      if (style) {
        const prop = style.split(":")[0];
        current = current.filter((s) => !s.startsWith(prop));
        current.push(style);
      }
    }
    lastIndex = idx + full.length;
  }
  flush(str.slice(lastIndex));
  return html;
}

/**
 * High-level fetch + process for LogViewer. Produces display-ready entries.
 */
export async function fetchProcessedPetriLog(
  runId: string,
  architecture: string | undefined,
  testNameRemainder: string
): Promise<ProcessedLogEntry[]> {
  const { url, text } = await fetchPetriLog(
    runId,
    architecture,
    testNameRemainder
  );
  if (!text) return [];
  const raw = parsePetriLogText(text);
  const entries: ProcessedLogEntry[] = [];
  let start: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const rec = raw[i];
    const timestamp = rec.timestamp;
    if (!start) start = timestamp;
    let message = rec.message || "";
    let severity = rec.severity || "INFO";
    const source = rec.source || (rec.attachment ? "attachment" : "unknown");

    message = removeTimestampPrefix(message, new Date(timestamp));
    const sevExtract = extractSeverity(message, severity);
    message = sevExtract.message;
    severity = sevExtract.severity;

    let messageHtml = ansiToHtml(message);
    let screenshot: string | null = null;
    if (rec.attachment) {
      const attachmentUrl = new URL(rec.attachment, url).toString();
      // Only treat PNGs as screenshots if they're NOT inspect files
      if (
        rec.attachment.endsWith(".png") &&
        !rec.attachment.includes("inspect") &&
        entries.length > 0
      ) {
        // associate with previous entry
        entries[entries.length - 1].screenshot = attachmentUrl;
        continue; // don't emit separate row
      }
      // Inspect attachment gets two links (inspect + raw); others single link
      if (rec.attachment.includes("inspect")) {
        messageHtml +=
          (messageHtml ? " " : "") +
          `<a href="${attachmentUrl}" class="attachment" target="_blank" data-inspect="true">${escapeHtml(rec.attachment)}</a> <a href="${attachmentUrl}" class="attachment" target="_blank">[raw]</a>`;
      } else {
        messageHtml +=
          (messageHtml ? " " : "") +
          `<a href="${attachmentUrl}" class="attachment" target="_blank">${escapeHtml(rec.attachment)}</a>`;
      }
    }

    entries.push({
      index: i,
      timestamp,
      relative: start ? formatRelative(start, timestamp) : "0m 0.000s",
      severity,
      source,
      messageHtml,
      messageText: messageHtml.replace(/<[^>]+>/g, "").toLowerCase(),
      screenshot,
    });
  }
  return entries;
}

// ---------------- Inspect File Types and Parsing ----------------

export type InspectPrimitive =
  | { type: "string"; value: string }
  | { type: "bytes"; value: string }
  | { type: "unevaluated" }
  | { type: "boolean"; value: boolean }
  | { type: "error"; value: string }
  | { type: "number"; value: string };

export interface InspectObject {
  type: "object";
  children: { key: string; value: InspectNode }[];
}
export type InspectNode = InspectPrimitive | InspectObject;

function parseInspectNode(input: string): InspectObject {
  let i = 0;

  function skipWhitespace() {
    while (/\s/.test(input[i])) i++;
  }

  function parseKey(): string {
    skipWhitespace();
    const match = /^(.+?):\s/.exec(input.slice(i));
    if (!match)
      throw new Error(
        `Invalid key at position ${i}: '${input.slice(i, i + 10)}'`
      );
    i += match[0].length;
    return match[1];
  }

  function parseString(): string {
    i++;
    let str = "";
    while (i < input.length && input[i] !== '"') {
      if (input[i] === "\\") str += input[i++];
      str += input[i++];
    }
    if (input[i] !== '"') throw new Error("Unterminated string");
    i++;
    return str;
  }

  function parseValue(): InspectNode {
    skipWhitespace();
    if (input[i] === "{") return parseObject();
    if (input[i] === '"') return { type: "string", value: parseString() };
    if (input[i] === "<") {
      const start = i;
      while (i < input.length && input[i] !== ">") i++;
      i++;
      return { type: "bytes", value: input.slice(start, i) };
    }
    if (input[i] === "_") {
      i++;
      return { type: "unevaluated" };
    }
    if (input[i] === "t") {
      if (input.slice(i, i + 4) !== "true")
        throw new Error(`Expected 'true' at ${i}`);
      i += 4;
      return { type: "boolean", value: true };
    }
    if (input[i] === "f") {
      if (input.slice(i, i + 5) !== "false")
        throw new Error(`Expected 'false' at ${i}`);
      i += 5;
      return { type: "boolean", value: false };
    }
    if (input[i] === "e") {
      if (input.slice(i, i + 7) !== "error (")
        throw new Error(`Expected 'error (' at ${i}`);
      i += 7;
      let parens = 1;
      const start = i;
      while (i < input.length && parens > 0) {
        if (input[i] === "(") parens++;
        else if (input[i] === ")") parens--;
        i++;
      }
      if (input[i - 1] !== ")") throw new Error("Unterminated error");
      return { type: "error", value: input.slice(start, i - 1) };
    }
    const match = /^[+-]?((0x[0-9a-fA-F]+)|(0b[01]+)|([0-9]+(\.[0-9]*)?))/.exec(
      input.slice(i)
    );
    if (match) {
      i += match[0].length;
      return { type: "number", value: match[0] };
    }
    throw new Error(`Unexpected token at ${i}: '${input.slice(i, i + 10)}'`);
  }

  function parseObject(): InspectObject {
    if (input[i] !== "{") throw new Error(`Expected '{' at ${i}`);
    i++;
    skipWhitespace();
    const children: { key: string; value: InspectNode }[] = [];
    while (i < input.length && input[i] !== "}") {
      const key = parseKey();
      skipWhitespace();
      const value = parseValue();
      children.push({ key, value });
      skipWhitespace();
      if (input[i] === ",") {
        i++;
        skipWhitespace();
      } else if (input[i] !== "}")
        throw new Error(`Expected ',' or '}' at ${i}`);
    }
    if (input[i] !== "}") throw new Error(`Unterminated object at ${i}`);
    i++;
    return { type: "object", children };
  }

  skipWhitespace();
  const result = parseObject();
  skipWhitespace();
  if (i < input.length) throw new Error(`Trailing content at ${i}`);
  return result;
}

/**
 * Fetches and parses an inspect file from the given URL.
 * Returns the parsed inspect object structure containing the file's data tree.
 */
export async function getInspectFile(fileUrl: string): Promise<InspectObject> {
  const resp = await fetch(fileUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  return parseInspectNode(text);
}
