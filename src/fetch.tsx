// Data types for representing run data
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

export interface RunDetails {
  runNumber: string;
  tests: TestResult[];
}

export interface ParsedRunResult {
  serviceEndpoint: string;
  containerName: string;
  prefix: string;
  runs: RunData[];
}

// ============================================
// PR Title Fetching & Caching Helpers
// ============================================

import { QueryClient } from '@tanstack/react-query';

const PR_TITLE_CACHE_MS = 15 * 60 * 1000; // 15 minutes

/** Fetch a single PR title from GitHub. Returns null if unavailable or rate-limited. */
async function fetchSinglePRTitle(prNumber: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/microsoft/openvmm/pulls/${prNumber}`);
    if (response.status === 403) {
      // Likely rate limited – treat as missing but keep cached null to avoid hammering.
      return null;
    }
    if (response.ok) {
      const prData = await response.json();
      return typeof prData.title === 'string' ? prData.title : null;
    }
  } catch { /* swallow network errors; null indicates unknown */ }
  return null;
}

/**
 * Legacy bulk fetch fallback when no QueryClient is passed (kept for compatibility).
 * Not used when a QueryClient is provided.
 */
async function fetchPRTitlesBulk(prNumbers: string[]): Promise<Map<string, string>> {
  const prTitles = new Map<string, string>();
  const promises = prNumbers.map(prNumber => fetchSinglePRTitle(prNumber).then(title => ({ prNumber, title })));
  const results = await Promise.allSettled(promises);
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value.title) {
      prTitles.set(r.value.prNumber, r.value.title!);
    }
  });
  return prTitles;
}

// Function to parse XML run data into structured format
function parseRunData(xmlText: string, queryClient?: QueryClient): ParsedRunResult {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");

  // Get root element attributes
  const enumerationResults = xmlDoc.getElementsByTagName("EnumerationResults")[0];
  const serviceEndpoint = enumerationResults.getAttribute("ServiceEndpoint") || "";
  const containerName = enumerationResults.getAttribute("ContainerName") || "";
  const prefix = xmlDoc.getElementsByTagName("Prefix")[0]?.textContent || "";

  // Parse each blob
  const blobs = xmlDoc.getElementsByTagName("Blob");
  const runs: RunData[] = [];

  for (const blob of blobs) {
    const name = blob.getElementsByTagName("Name")[0]?.textContent || "";
    const creationTime = new Date(blob.getElementsByTagName("Creation-Time")[0]?.textContent || "");
    const lastModified = new Date(blob.getElementsByTagName("Last-Modified")[0]?.textContent || "");
    const etag = blob.getElementsByTagName("Etag")[0]?.textContent || "";
    const contentLength = parseInt(blob.getElementsByTagName("Content-Length")[0]?.textContent || "0");

    // Parse metadata
    const metadataElement = blob.getElementsByTagName("Metadata")[0];
    const metadata: RunMetadata = {
      petriFailed: parseInt(metadataElement?.getElementsByTagName("petrifailed")[0]?.textContent || "0"),
      petriPassed: parseInt(metadataElement?.getElementsByTagName("petripassed")[0]?.textContent || "0"),
      ghBranch: metadataElement?.getElementsByTagName("ghbranch")[0]?.textContent || "",
      ghPr: metadataElement?.getElementsByTagName("ghpr")[0]?.textContent || undefined,
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

  // Opportunistic prefetch strategy (sequential):
  // 1. Prefetch latest 5 failed runs (by creationTime desc)
  // 2. AFTER those complete, prefetch all remaining failed runs on branch 'main'
  // We avoid duplicate work and run this in the background so initial render isn't blocked.
  if (queryClient) {
    try {
      const failed = runs.filter(r => r.metadata.petriFailed > 0);
      failed.sort((a, b) => b.creationTime.getTime() - a.creationTime.getTime());
      const latestFive = failed.slice(0, 5);
      const failedMain = failed.filter(r => r.metadata.ghBranch === 'main');

      const extractRunNumber = (name: string) => {
        const runNumberFull = name.replace(/^runs\//, '');
        return runNumberFull.split('/')[0];
      };

      void (async () => {
        const prefetched = new Set<string>();
        const prefetchRun = async (runNumber: string) => {
          const key = ['runDetails', runNumber];
          if (queryClient.getQueryData(key)) { prefetched.add(runNumber); return; }
          try {
            await queryClient.prefetchQuery({
              queryKey: key,
              queryFn: () => fetchRunDetails(runNumber, queryClient),
              staleTime: Infinity,
              gcTime: 15 * 60 * 1000,
            });
            prefetched.add(runNumber);
          } catch (e) {
            console.warn(`[parseRunData] Prefetch failed for run ${runNumber}`, e);
          }
        };

        // First batch: latest 5 failed
        const firstRunNumbers = latestFive.map(r => extractRunNumber(r.name)).filter(Boolean);
        await Promise.allSettled(firstRunNumbers.map(rn => prefetchRun(rn)));

        // Second batch: failed on main not already prefetched
        const secondRunNumbers = failedMain
          .map(r => extractRunNumber(r.name))
          .filter(rn => rn && !prefetched.has(rn));
        if (secondRunNumbers.length) {
          await Promise.allSettled(secondRunNumbers.map(rn => prefetchRun(rn)));
        }
      })();
    } catch (e) {
      console.warn('[parseRunData] Failed to schedule runDetails prefetch', e);
    }
  }

  return {
    serviceEndpoint,
    containerName,
    prefix,
    runs,
  };
}

// Main export function - fetches and returns parsed run data
export async function fetchRunData(queryClient?: QueryClient): Promise<RunData[]> {
  try {
    console.log('Fetching run data from Azure Blob Storage')
    const url = 'https://openvmmghtestresults.blob.core.windows.net/results?restype=container&comp=list&showonly=files&include=metadata&prefix=runs/';
    const response = await fetch(url);
    const data = await response.text();

    // Parse the data and get the runs array
    const parsedData = parseRunData(data, queryClient);
    const runs = parsedData.runs;

    // Collect all PR numbers that need titles
    const prNumbers = runs
      .map(run => run.metadata.ghPr)
      .filter((pr): pr is string => pr !== undefined);

    if (prNumbers.length > 0) {
      if (queryClient) {
        // Use per-PR cached queries (15 min) to avoid redundant network calls across navigations.
        const unique = Array.from(new Set(prNumbers));
        const entries = await Promise.all(unique.map(async pr => {
          const title = await queryClient.ensureQueryData<string | null>({
            queryKey: ['prTitle', pr],
            queryFn: () => fetchSinglePRTitle(pr),
            staleTime: PR_TITLE_CACHE_MS,
            gcTime: PR_TITLE_CACHE_MS,
          });
          return [pr, title] as const;
        }));
        const titleMap = new Map<string, string | null>(entries);
        runs.forEach(run => {
          const pr = run.metadata.ghPr;
          if (pr && titleMap.has(pr)) {
            const t = titleMap.get(pr);
            if (t) run.metadata.prTitle = t;
          }
        });
      } else {
        // Fallback legacy bulk fetch (no caching layer available here)
        const prTitles = await fetchPRTitlesBulk(prNumbers);
        runs.forEach(run => {
          if (run.metadata.ghPr && prTitles.has(run.metadata.ghPr)) {
            run.metadata.prTitle = prTitles.get(run.metadata.ghPr);
          }
        });
      }
    }

    console.log('Done fetching and parsing run data');
    // Duplicate the runs array to simulate a large dataset
    return runs;
  } catch (error) {
    console.error('Error fetching run data:', error);
    throw error;
  }
}

// Function to parse detailed run data from XML
function parseRunDetails(xmlText: string, runNumber: string, queryClient?: QueryClient): RunDetails {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");

  const blobs = xmlDoc.getElementsByTagName("Blob");
  const testFolders = new Map<string, { hasJsonl: boolean, hasPassed: boolean }>();

  // First pass: collect all relevant files and group by test folder
  for (const blob of blobs) {
    const name = blob.getElementsByTagName("Name")[0]?.textContent || "";
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
        const testName = cleanPathParts.slice(1).join('/'); // Everything after architecture

        // Determine status: if folder has petri.passed, it's passed; otherwise failed
        const status: 'passed' | 'failed' = folder.hasPassed ? 'passed' : 'failed';

        // Create a clean test name that includes architecture for grouping
        const fullTestName = `${architecture}/${testName}`;

        tests.push({
          name: fullTestName,
          status,
          path: testFolderPath
        });
      }
    }
  }

  // Sort tests by name
  tests.sort((a, b) => a.name.localeCompare(b.name));

  // Prefetch petri.jsonl ONLY for failed tests (background, non-blocking)
  if (queryClient) {
    try {
      const prefetchPromises: Promise<unknown>[] = [];
      for (const test of tests) {
        if (test.status !== 'failed') continue; // only failed tests
        const firstSlash = test.name.indexOf('/');
        if (firstSlash === -1) continue; // malformed name
        const architecture = test.name.slice(0, firstSlash);
        const remainder = test.name.slice(firstSlash + 1); // may contain further slashes
        const queryKey = ['petriLog', runNumber, architecture, remainder];
        prefetchPromises.push(
          queryClient.fetchQuery({
            queryKey,
            queryFn: () => fetchProcessedPetriLog(runNumber, architecture, remainder),
            staleTime: 60 * 1000, // 1 min stale window for logs
            gcTime: 5 * 60 * 1000,
          })
        );
      }
      if (prefetchPromises.length) {
        Promise.allSettled(prefetchPromises).then(res => {
          const failed = res.filter(r => r.status === 'rejected').length;
          if (failed) {
            console.warn(`[parseRunDetails] ${failed} petri.jsonl prefetches failed for run ${runNumber}`);
          }
        });
      }
    } catch (e) {
      console.warn('[parseRunDetails] Prefetch phase error', e);
    }
  }

  return {
    runNumber,
    tests
  };
}

// Function to fetch detailed test results for a specific run
// (Removed) PETRI_FILE_CACHE_MS constant no longer used after refactor; reintroduce if raw petri file caching reinstated.

/**
 * Fetch detailed run information (listing of test result folders) for a run number.
 * When a QueryClient is supplied we proactively prefetch & cache the content of
 * any petri.jsonl (and petri.passed) files discovered during the blob listing.
 *
 * Query keys:
 *   [<blobPath>]  -> raw text content of that blob (petri.jsonl or petri.passed)
 *
 * For petri.jsonl we retain the entry for 1 hour (stale + GC) so subsequent
 * navigation to an individual test log can hydrate instantly without a network roundtrip.
 */
export async function fetchRunDetails(runNumber: string, queryClient?: QueryClient): Promise<RunDetails> {
  try {
    console.log(`Fetching detailed test data for run ${runNumber}...`);

    let allTests: TestResult[] = [];
    let continuationToken: string | null = null;

    do {
      // Build URL with continuation token if we have one
      // TODO: If heirarchical namespaces are supported this fetch call might go by much faster. Try this out in a non-prod environment first to try it out 
      let url = `https://openvmmghtestresults.blob.core.windows.net/results?restype=container&comp=list&showonly=files&prefix=${encodeURIComponent(runNumber)}`;
      if (continuationToken) {
        url += `&marker=${encodeURIComponent(continuationToken)}`;
      }

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch run details: ${response.status} ${response.statusText}`);
      }

      const data = await response.text();
      const pageResults = parseRunDetails(data, runNumber, queryClient);

      // Merge tests from this page
      allTests.push(...pageResults.tests);

      // Check for NextMarker to see if there are more pages
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(data, "text/xml");
      const nextMarkerElement = xmlDoc.getElementsByTagName("NextMarker")[0];
      continuationToken = nextMarkerElement?.textContent || null;

      console.log(`Found ${pageResults.tests.length} tests on this page. Total so far: ${allTests.length}`);
      if (continuationToken) {
        console.log(`More results available, will fetch next page...`);
      }

    } while (continuationToken);

    // Sort all tests by name
    allTests.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`✅ Completed fetching all test data for run ${runNumber}. Total tests: ${allTests.length}`);

    return {
      runNumber,
      tests: allTests
    };
  } catch (error) {
    console.error(`Error fetching run details for ${runNumber}:`, error);
    throw error;
  }
}

// ============================================
// Petri log fetch helper (for LogViewer)
// ============================================

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
  if (!runId) throw new Error('runId required');
  const parts: string[] = [runId];
  if (architecture) parts.push(architecture);
  if (testNameRemainder) parts.push(testNameRemainder);
  const url = `https://openvmmghtestresults.blob.core.windows.net/results/${parts.join('/')}/petri.jsonl`;
  console.log('[fetchPetriLog] Fetching', url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch petri log (${response.status} ${response.statusText}) for ${url}`);
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
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const records: RawPetriRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && obj.timestamp) {
        records.push(obj as RawPetriRecord);
      } else {
        // Still push to avoid silent data loss; timestamp-less entries sort to front
        records.push(obj as RawPetriRecord);
      }
    } catch (e) {
      throw new Error(`Failed to parse petri.jsonl line ${i + 1}: ${(e as Error).message}`);
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
  messageHtml: string;   // sanitized HTML with ANSI styling & attachment links
  messageText: string;   // plain lowercase text for filtering
  screenshot: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function removeTimestampPrefix(orig: string, entryTimestamp: Date): string {
  const message = orig.trim();
  const i = message.indexOf(' ');
  if (i === -1) return orig;
  let ts = message.slice(0, i);
  if (ts.endsWith('s')) { // relative like 12.345s
    const secs = parseFloat(ts.slice(0, -1));
    if (!isNaN(secs)) return message.slice(i + 1);
  }
  if (ts.startsWith('[')) ts = ts.slice(1, -1);
  const parsedTs = new Date(ts);
  if (isNaN(parsedTs.getTime())) return orig;
  parsedTs.setMilliseconds(0);
  const truncated = new Date(entryTimestamp.getTime());
  truncated.setMilliseconds(0);
  if (parsedTs.getTime() !== truncated.getTime()) return orig;
  return message.slice(i + 1);
}

function extractSeverity(orig: string, defaultSeverity: string): { message: string; severity: string } {
  const severityLevels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
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
  return `${hr > 0 ? hr + 'h ' : ''}${min}m ${sec}s`;
}

// Map ANSI SGR codes to inline styles (subset used in original UI)
const ANSI_STYLE_MAP: Record<string, string> = {
  '1': 'font-weight:bold', '3': 'font-style:italic', '4': 'text-decoration:underline',
  '30': 'color:black', '31': 'color:red', '32': 'color:green', '33': 'color:#b58900', '34': 'color:blue', '35': 'color:magenta', '36': 'color:cyan', '37': 'color:white',
  '90': 'color:gray', '91': 'color:lightcoral', '92': 'color:lightgreen', '93': 'color:gold', '94': 'color:lightskyblue', '95': 'color:plum', '96': 'color:lightcyan', '97': 'color:white',
  '39': 'color:inherit'
};

function ansiToHtml(str: string): string {
  const ESC_REGEX = /\u001b\[([0-9;]*)m/g;
  let html = '';
  let lastIndex = 0;
  let current: string[] = [];
  const flush = (text: string) => {
    if (!text) return;
    const esc = escapeHtml(text);
    if (current.length) {
      html += `<span style="${current.join(';')}">${esc}</span>`;
    } else {
      html += esc;
    }
  };
  for (const match of str.matchAll(ESC_REGEX)) {
    const [full, codesStr] = match;
    const idx = match.index || 0;
    flush(str.slice(lastIndex, idx));
    const codes = codesStr.split(';').filter(c => c.length > 0);
    for (const code of codes) {
      if (code === '0') { current = []; continue; }
      const style = ANSI_STYLE_MAP[code];
      if (style) {
        const prop = style.split(':')[0];
        current = current.filter(s => !s.startsWith(prop));
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
  const { url, text } = await fetchPetriLog(runId, architecture, testNameRemainder);
  if (!text) return [];
  const raw = parsePetriLogText(text);
  const entries: ProcessedLogEntry[] = [];
  let start: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const rec = raw[i];
    const timestamp = rec.timestamp;
    if (!start) start = timestamp;
    let message = rec.message || '';
    let severity = rec.severity || 'INFO';
    const source = rec.source || (rec.attachment ? 'attachment' : 'unknown');

    message = removeTimestampPrefix(message, new Date(timestamp));
    const sevExtract = extractSeverity(message, severity);
    message = sevExtract.message;
    severity = sevExtract.severity;

    let messageHtml = ansiToHtml(message);
    let screenshot: string | null = null;
    if (rec.attachment) {
      const attachmentUrl = new URL(rec.attachment, url).toString();
      if (rec.attachment.endsWith('.png') && entries.length > 0) {
        // associate with previous entry
        entries[entries.length - 1].screenshot = attachmentUrl;
        continue; // don't emit separate row
      }
      // Inspect attachment gets two links (inspect + raw); others single link
      if (rec.attachment.includes('inspect')) {
        messageHtml += (messageHtml ? ' ' : '') + `<a href="${attachmentUrl}" class="attachment" target="_blank" data-inspect="true">${escapeHtml(rec.attachment)}</a> <a href="${attachmentUrl}" class="attachment" target="_blank">[raw]</a>`;
      } else {
        messageHtml += (messageHtml ? ' ' : '') + `<a href="${attachmentUrl}" class="attachment" target="_blank">${escapeHtml(rec.attachment)}</a>`;
      }
    }

    entries.push({
      index: i,
      timestamp,
      relative: start ? formatRelative(start, timestamp) : '0m 0.000s',
      severity,
      source,
      messageHtml,
      messageText: messageHtml.replace(/<[^>]+>/g, '').toLowerCase(),
      screenshot,
    });
  }
  return entries;
}