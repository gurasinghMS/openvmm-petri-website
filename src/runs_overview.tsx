import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  ColumnDef,
  flexRender,
  SortingState,
} from '@tanstack/react-table';
import { RunData, RunDetails } from './fetch';
import { 
  getAllRuns, 
  fetchAndCacheRunDetails, 
  addDataStoreListener, 
  getRunDetails,
  getTestStatsFromCacheByBranch,
  getCachedRunCount,
  TestStats,
  getAnalysisState,
  markTestsPageAccessed,
} from './dataStore';
import { TestsOverview } from './tests_overview';
import { RunDetailsView } from './run_details';
import './styles.css';

interface RunOverviewProps {
  activeTab: 'runs' | 'tests';
  onRunClick?: (runId: string, runDate?: Date) => void;
  onTestClick?: (testName: string) => void;
  onTestLogClick?: (testName: string, jobName: string) => void;
  currentView: 'overview' | 'run-details';
  selectedRunId?: string;
  selectedRunDate?: Date;
  onBack?: () => void;
  backButtonText?: string;
  searchFilter?: string;
  onSearchFilterChange?: (filter: string) => void;
}

export function RunOverview({ 
  activeTab, 
  onRunClick, 
  onTestClick,
  onTestLogClick,
  currentView, 
  selectedRunId, 
  selectedRunDate, 
  onBack,
  backButtonText = "All Runs",
}: RunOverviewProps): React.JSX.Element {
  const [runs, setRuns] = useState<RunData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  
  // Test data state - now using persistent state from dataStore
  const [testStats, setTestStats] = useState<Map<string, TestStats>>(new Map());
  const [testDataError, setTestDataError] = useState<string | null>(null);
  const [testDataLoaded, setTestDataLoaded] = useState<boolean>(false);
  
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'creationTime', desc: true } // Default sort by creation time, newest first
  ]);
  const [globalFilter, setGlobalFilter] = useState('');
  
  // Tests page state
  const [testSearchFilter, setTestSearchFilter] = useState<string>('');
  const [testBranchFilter, setTestBranchFilter] = useState<string>('main');
  
  // Run details page state
  const [runDetailsSearchFilter, setRunDetailsSearchFilter] = useState<string>('');
  const [currentRunDetails, setCurrentRunDetails] = useState<RunDetails | null>(null);

  useEffect(() => {
    const loadRuns = async () => {
      try {
        setLoading(true);
        const data = await getAllRuns();
        setRuns(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch run data');
      } finally {
        setLoading(false);
      }
    };

    loadRuns();
  }, []);

  // Background loading is now handled automatically by the dataStore
  // when getAllRuns() is called and when tests page is accessed

  // Automatically start loading test data when tests tab is accessed
  useEffect(() => {
    if (activeTab === 'tests' && runs.length > 0) {
      // Mark that the tests page has been accessed to accelerate background loading
      markTestsPageAccessed();
      
      const analysisState = getAnalysisState();
      const cachedCount = getCachedRunCount();
      
      console.log(`🚀 Tests tab accessed. Cached: ${cachedCount}, Total: ${runs.length}, Loading: ${analysisState.isLoading}, LoadAll: ${analysisState.loadAllRuns}`);
      
      // If we have some data, show it immediately
      if (cachedCount > 0) {
        console.log('� Showing initial test stats from cached runs...');
        const initialStats = getTestStatsFromCacheByBranch(testBranchFilter);
        setTestStats(initialStats);
        setTestDataLoaded(true);
      }
      
      // ALWAYS start background analysis if not complete and not already loading
      // This handles both direct navigation to tests page AND normal flow
      if (!analysisState.loadAllRuns && !analysisState.isLoading) {
        console.log(`🚀 Starting background analysis of ${cachedCount > 0 ? 'remaining' : 'all'} runs...`);
        loadTestData(true); // Load ALL runs in background
      }
    }
  }, [activeTab, runs.length, testBranchFilter]);

  // Add dataStore listener to update test stats during and after loading
  useEffect(() => {
    const unsubscribe = addDataStoreListener(() => {
      // Always update testStats with current cached data (show partial results during loading)
      const newTestStats = getTestStatsFromCacheByBranch(testBranchFilter);
      
      // Always update testStats, even if empty (to clear the table for branches with no runs)
      setTestStats(newTestStats);
      
      if (!testDataLoaded && newTestStats.size > 0) {
        setTestDataLoaded(true);
      }
    });

    // Also update immediately with whatever data is available
    const currentTestStats = getTestStatsFromCacheByBranch(testBranchFilter);
    
    // Always set the stats, even if empty
    setTestStats(currentTestStats);
    
    if (!testDataLoaded && currentTestStats.size > 0) {
      setTestDataLoaded(true);
    }

    return unsubscribe;
  }, [testDataLoaded, runs.length, testBranchFilter]);

  // Load run details when selectedRunId changes
  useEffect(() => {
    if (currentView === 'run-details' && selectedRunId) {
      const loadRunDetails = async () => {
        try {
          const details = await getRunDetails(selectedRunId);
          setCurrentRunDetails(details);
        } catch (error) {
          console.error('Failed to load run details for header:', error);
          setCurrentRunDetails(null);
        }
      };
      loadRunDetails();
    } else {
      setCurrentRunDetails(null);
    }
  }, [currentView, selectedRunId]);

  const loadTestData = async (loadAll: boolean) => {
    const analysisState = getAnalysisState();
    if (analysisState.isLoading) return; // Prevent multiple simultaneous loads
    
    try {
      setTestDataError(null);
      
      // Filter runs to only include main branch and release/* branches
      const allowedBranchRuns = runs.filter(run => 
        run.metadata.ghBranch === 'main' || 
        run.metadata.ghBranch.startsWith('release/')
      );
      
      // Determine which runs to load - get the most recent by creation time
      const sortedRuns = [...allowedBranchRuns].sort((a, b) => b.creationTime.getTime() - a.creationTime.getTime());
      const runsToLoad = loadAll ? sortedRuns : sortedRuns;
      
      console.log(`Starting to fetch details for ${loadAll ? 'all' : 'most recent'} ${runsToLoad.length} main/release runs using unified data store...`);
      
      // Extract run numbers for the data store
      const runNumbers = runsToLoad.map(run => run.name.replace('runs/', ''));
      
      // Use the data store to fetch/cache run details with progress tracking
      // The dataStore listener will automatically update testStats when data arrives
      await fetchAndCacheRunDetails(runNumbers, undefined, loadAll, false); // false = background loading
      
      // Get final stats from the dataStore filtered by branch (the listener will have updated them too)
      const finalStats = getTestStatsFromCacheByBranch(testBranchFilter);
      setTestStats(finalStats);
      setTestDataLoaded(true);
      
      console.log(`Completed fetching details for ${runsToLoad.length} main/release runs. Found ${finalStats.size} unique tests.`);
      
    } catch (err) {
      setTestDataError(err instanceof Error ? err.message : 'Failed to fetch run details');
      console.error('Error loading run details:', err);
    }
  };

  // Filter runs based on branch selection
  const filteredRuns = useMemo(() => {
    if (branchFilter === 'all') {
      return runs;
    }
    return runs.filter(run => run.metadata.ghBranch === branchFilter);
  }, [runs, branchFilter]);

  const columns = useMemo<ColumnDef<RunData>[]>(() => [
    {
      accessorKey: 'name',
      header: 'Run',
      enableSorting: true,
      cell: (info) => {
        const runId = info.getValue<string>().replace('runs/', '');
        const rowData = info.row.original;
        return (
          <a 
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onRunClick?.(runId, rowData.creationTime);
            }}
            className="run-name-link"
          >
            {runId}
          </a>
        );
      },
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue(columnId) as string;
        const b = rowB.getValue(columnId) as string;
        return a.localeCompare(b);
      },
    },
    {
      accessorKey: 'creationTime',
      header: 'Created',
      enableSorting: true,
      cell: (info) => (
        <span className="created-date">{info.getValue<Date>().toLocaleString()}</span>
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue(columnId) as Date;
        const b = rowB.getValue(columnId) as Date;
        return a.getTime() - b.getTime();
      },
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: true,
      accessorFn: (row) => row.metadata.petriFailed === 0 ? 'passed' : 'failed',
      cell: (info) => {
        const status = info.getValue<string>();
        return (
          <div className="status-cell">
            <span className={status === 'passed' ? 'status-pass' : 'status-fail'}>
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'metadata.petriFailed',
      header: 'Failed',
      enableSorting: true,
      cell: (info) => (
        <span className="failed-count">{info.getValue<number>()}</span>
      ),
    },
    {
      id: 'total',
      header: 'Total',
      enableSorting: true,
      accessorFn: (row) => row.metadata.petriPassed + row.metadata.petriFailed,
      cell: (info) => (
        <span className="total-count">{info.getValue<number>()}</span>
      ),
    },
    {
      accessorKey: 'metadata.ghBranch',
      header: 'Branch',
      enableSorting: true,
      cell: (info) => (
        <span className="branch-name">{info.getValue<string>()}</span>
      ),
    },
    {
      accessorKey: 'metadata.ghPr',
      header: 'PR',
      enableSorting: true,
      accessorFn: (row) => {
        const pr = row.metadata.ghPr;
        const prTitle = row.metadata.prTitle;
        // Combine PR number and title for searching
        return pr ? `${pr} ${prTitle || ''}`.trim() : '';
      },
      cell: (info) => {
        const row = info.row.original;
        const pr = row.metadata.ghPr;
        const prTitle = row.metadata.prTitle;
        
        return pr ? (
          <div className="pr-cell">
            <a 
              href={`https://github.com/microsoft/openvmm/pull/${pr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="pr-combined-link"
              title={prTitle ? `#${pr} ${prTitle}` : `PR #${pr}`}
            >
              #{pr}{prTitle ? ` ${prTitle}` : ''}
            </a>
          </div>
        ) : (
          <span className="no-pr">-</span>
        );
      },
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.metadata.ghPr;
        const b = rowB.original.metadata.ghPr;
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return parseInt(a) - parseInt(b);
      },
    },
    {
      accessorKey: 'name',
      header: 'GH Run',
      enableSorting: true,
      cell: (info) => {
        const runId = info.getValue<string>().replace('runs/', '');
        return (
          <a 
            href={`https://github.com/microsoft/openvmm/actions/runs/${runId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="run-name-link"
          >
            {runId}
          </a>
        );
      },
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue(columnId) as string;
        const b = rowB.getValue(columnId) as string;
        return a.localeCompare(b);
      },
    },
  ], []);

  const table = useReactTable({
    data: filteredRuns,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableSorting: true,
    enableSortingRemoval: false,
    debugTable: false,
  });

  if (loading) {
    return <div className="run-overview-loading">Loading run data...</div>;
  }

  if (error) {
    return <div className="run-overview-error">Error: {error}</div>;
  }

  return (
    <div className="run-overview">
      <div className="run-overview-header">
        {currentView === 'overview' && activeTab === 'runs' && (
          <>
            <div className="header-left-section">
              <div className="header-title-section">
                <h3>Runs</h3>
              </div>
              <div className="branch-filter-buttons">
                <button
                  className={`branch-filter-btn ${branchFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setBranchFilter('all')}
                >
                  all
                </button>
                <button
                  className={`branch-filter-btn ${branchFilter === 'main' ? 'active' : ''}`}
                  onClick={() => setBranchFilter('main')}
                >
                  main
                </button>
                <button
                  className={`branch-filter-btn ${branchFilter === 'release/2505' ? 'active' : ''}`}
                  onClick={() => setBranchFilter('release/2505')}
                >
                  release/2505
                </button>
              </div>
            </div>
            <div className="table-controls">
              <input
                value={globalFilter ?? ''}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder="Search all columns..."
                className="search-input"
              />
              <span className="results-count">
                {table.getFilteredRowModel().rows.length} runs
              </span>
            </div>
          </>
        )}
        {currentView === 'overview' && activeTab === 'tests' && (
          <>
            <div className="header-left-section">
              <div className="header-title-section">
                <h3>Tests</h3>
              </div>
              <div className="branch-filter-buttons">
                <button
                  className={`branch-filter-btn ${testBranchFilter === 'main' ? 'active' : ''}`}
                  onClick={() => {
                    setTestBranchFilter('main');
                    // Immediately update display with current cached data for this branch
                    const branchStats = getTestStatsFromCacheByBranch('main');
                    setTestStats(branchStats);
                  }}
                >
                  main
                </button>
                <button
                  className={`branch-filter-btn ${testBranchFilter === 'release/2505' ? 'active' : ''}`}
                  onClick={() => {
                    setTestBranchFilter('release/2505');
                    // Immediately update display with current cached data for this branch
                    const branchStats = getTestStatsFromCacheByBranch('release/2505');
                    setTestStats(branchStats);
                  }}
                >
                  release/2505
                </button>
              </div>
              {getAnalysisState().isLoading && (
                <div className="analysis-progress">
                  <div className="loading-spinner"></div>
                  <span>Analyzing {getCachedRunCount()} of {runs.filter(run => 
                    run.metadata.ghBranch === 'main' || 
                    run.metadata.ghBranch.startsWith('release/')
                  ).length} main/release runs...</span>
                </div>
              )}
            </div>
            <div className="table-controls">
              <input
                value={testSearchFilter}
                onChange={(e) => setTestSearchFilter(e.target.value)}
                placeholder="Search tests..."
                className="search-input"
              />
              <div className="results-count">
                {testStats.size} tests
                {getAnalysisState().isLoading && (
                  <span className="partial-analysis-note"> • Partial results</span>
                )}
              </div>
            </div>
          </>
        )}
        {currentView === 'run-details' && selectedRunId && (
          <>
            <div className="header-left-section">
              <button 
                className="back-button dark-grey"
                onClick={onBack}
                title={`Back to ${backButtonText.toLowerCase()}`}
              >
                ← {backButtonText}
              </button>
              <div className="header-title-section">
                <div className="run-title-container">
                  <h3>{selectedRunId}</h3>
                  {selectedRunDate && (
                    <div className="run-date-subtitle">
                      {selectedRunDate.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  )}
                </div>
                {currentRunDetails && (
                  <div className="run-stats">
                    <span className="stat-item">
                      Total: <strong>{currentRunDetails.tests?.length || 0}</strong>
                    </span>
                    <span className="stat-item passed">
                      Passed: <strong>{currentRunDetails.tests?.filter(t => t.status === 'passed').length || 0}</strong>
                    </span>
                    <span className="stat-item failed">
                      Failed: <strong>{currentRunDetails.tests?.filter(t => t.status === 'failed').length || 0}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="table-controls">
              <input
                value={runDetailsSearchFilter}
                onChange={(e) => setRunDetailsSearchFilter(e.target.value)}
                placeholder="Search tests..."
                className="search-input"
              />
              <button
                onClick={() => window.open(`https://github.com/microsoft/openvmm/actions/runs/${selectedRunId}`, '_blank')}
                className="github-button"
              >
                GitHub Run
              </button>
            </div>
          </>
        )}
      </div>

      <div className="run-overview-content">
        {currentView === 'overview' && activeTab === 'runs' && (
          <div className="table-container">
            <table className="advanced-run-table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={header.column.getCanSort() ? 'sortable' : ''}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="header-content">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())
                      }
                      {header.column.getCanSort() && (
                        <span className="sort-indicator">
                          {{
                            asc: '↑',
                            desc: '↓',
                          }[header.column.getIsSorted() as string] ?? '⇅'}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={`table-row ${row.original.metadata.petriFailed > 0 ? 'failed-row' : 'passed-row'}`}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      
      {currentView === 'overview' && activeTab === 'tests' && (
        <TestsOverview 
          runs={runs}
          testStats={testStats}
          loading={getAnalysisState().isLoading}
          error={testDataError}
          processedRuns={getCachedRunCount()}
          totalRuns={getAnalysisState().targetRunCount || runs.length}
          loadAllRuns={getAnalysisState().loadAllRuns}
          searchFilter={testSearchFilter}
          onTestClick={onTestClick}
        />
      )}

      {currentView === 'run-details' && selectedRunId && (
        <RunDetailsView 
          runId={selectedRunId}
          searchFilter={runDetailsSearchFilter}
          onTestLogClick={onTestLogClick}
        />
      )}
      </div>
    </div>
  );
}