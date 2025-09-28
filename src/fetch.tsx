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

// Function to fetch multiple PR titles in parallel
async function fetchPRTitles(prNumbers: string[]): Promise<Map<string, string>> {
  const prTitles = new Map<string, string>();

  // Make all API calls in parallel
  const promises = prNumbers.map(async (prNumber) => {
    try {
      const response = await fetch(`https://api.github.com/repos/microsoft/openvmm/pulls/${prNumber}`);

      if (response.status === 403) {
        return null;
      }

      if (response.ok) {
        const prData = await response.json();
        if (prData.title) {
          return { prNumber, title: prData.title };
        }
      }
    } catch (error) { }
    return null;
  });

  // Wait for all requests to complete and filter out nulls
  const results = await Promise.allSettled(promises);

  // Process all results, including those that were rejected
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      prTitles.set(result.value.prNumber, result.value.title);
    } else if (result.status === 'rejected') {
      console.warn(`Promise rejected for PR #${prNumbers[index]}:`, result.reason);
    }
  });

  return prTitles;
}

// Function to parse XML run data into structured format
function parseRunData(xmlText: string): ParsedRunResult {
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

  return {
    serviceEndpoint,
    containerName,
    prefix,
    runs,
  };
}

// Main export function - fetches and returns parsed run data
export async function fetchRunData(): Promise<RunData[]> {
  try {
    console.log('Fetching run data from Azure Blob Storage')
    const url = 'https://openvmmghtestresults.blob.core.windows.net/results?restype=container&comp=list&showonly=files&include=metadata&prefix=runs/';
    const response = await fetch(url);
    const data = await response.text();

    // Parse the data and get the runs array
    const parsedData = parseRunData(data);
    const runs = parsedData.runs;

    // Collect all PR numbers that need titles
    const prNumbers = runs
      .map(run => run.metadata.ghPr)
      .filter((pr): pr is string => pr !== undefined);

    // Fetch PR titles if we have any PRs
    if (prNumbers.length > 0) {
      const prTitles = await fetchPRTitles(prNumbers);

      // Add PR titles to the run data
      runs.forEach(run => {
        if (run.metadata.ghPr && prTitles.has(run.metadata.ghPr)) {
          run.metadata.prTitle = prTitles.get(run.metadata.ghPr);
        }
      });
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
function parseRunDetails(xmlText: string, runNumber: string): RunDetails {
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

  return {
    runNumber,
    tests
  };
}

// Function to fetch detailed test results for a specific run
export async function fetchRunDetails(runNumber: string): Promise<RunDetails> {
  try {
    console.log(`Fetching detailed test data for run ${runNumber}...`);

    let allTests: TestResult[] = [];
    let continuationToken: string | null = null;

    do {
      // Build URL with continuation token if we have one
      let url = `https://openvmmghtestresults.blob.core.windows.net/results?restype=container&comp=list&showonly=files&prefix=${encodeURIComponent(runNumber)}`;
      if (continuationToken) {
        url += `&marker=${encodeURIComponent(continuationToken)}`;
      }

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch run details: ${response.status} ${response.statusText}`);
      }

      const data = await response.text();
      const pageResults = parseRunDetails(data, runNumber);

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