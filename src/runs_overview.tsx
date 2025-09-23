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
  getTestStatsFromCache,
  getCachedRunCount,
  TestStats,
  getAnalysisState,
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
  const [testArchitectureFilter, setTestArchitectureFilter] = useState<string>('all');
  
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

  // Preload the most recent 50 runs immediately after runs are loaded
  useEffect(() => {
    const preloadRecentRuns = async () => {
      if (runs.length > 0 && !testDataLoaded) {
        console.log('🚀 Preloading most recent 50 runs in background...');
        
        // Get the 50 most recent runs
        const sortedRuns = [...runs].sort((a, b) => b.creationTime.getTime() - a.creationTime.getTime());
        const recentRuns = sortedRuns.slice(0, 50);
        const runNumbers = recentRuns.map(run => run.name.replace('runs/', ''));
        
        console.log('📋 Preloading run numbers:');
        recentRuns.forEach((run, index) => {
          const runNumber = run.name.replace('runs/', '');
          console.log(`  ${index + 1}. Run ${runNumber} (created: ${run.creationTime.toISOString()})`);
        });
        
        try {
          // Fetch and cache the run details in the background
          await fetchAndCacheRunDetails(runNumbers, (completed, total) => {
            console.log(`📊 Preload progress: ${completed}/${total} runs cached`);
          });
          
          console.log('✅ Preloading complete! Tests Overview will now be instant.');
        } catch (error) {
          console.warn('⚠️ Preloading failed, but will continue normally:', error);
        }
      }
    };

    preloadRecentRuns();
  }, [runs.length, testDataLoaded]);

  // Load test data only when needed and not already loaded
  useEffect(() => {
    if (activeTab === 'tests' && runs.length > 0 && !testDataLoaded && testStats.size === 0) {
      loadTestData(false); // Start with recent runs
    }
  }, [activeTab, runs.length, testDataLoaded, testStats.size]);

  // Add dataStore listener to update test stats in real-time
  useEffect(() => {
    const unsubscribe = addDataStoreListener(() => {
      // Update test stats from cache whenever dataStore changes
      const newTestStats = getTestStatsFromCache();
      
      if (newTestStats.size > 0) {
        setTestStats(newTestStats);
        
        if (!testDataLoaded && newTestStats.size > 0) {
          setTestDataLoaded(true);
        }
      }
    });

    // Also update immediately if there's already cached data
    const currentTestStats = getTestStatsFromCache();
    
    if (currentTestStats.size > 0) {
      setTestStats(currentTestStats);
      
      if (!testDataLoaded) {
        setTestDataLoaded(true);
      }
    }

    return unsubscribe;
  }, [testDataLoaded, runs.length]);

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
      
      // Determine which runs to load - get the most recent by creation time
      const sortedRuns = [...runs].sort((a, b) => b.creationTime.getTime() - a.creationTime.getTime());
      const runsToLoad = loadAll ? sortedRuns : sortedRuns.slice(0, 50);
      
      console.log(`Starting to fetch details for ${loadAll ? 'all' : 'most recent'} ${runsToLoad.length} runs using unified data store...`);
      
      // Extract run numbers for the data store
      const runNumbers = runsToLoad.map(run => run.name.replace('runs/', ''));
      
      // Use the data store to fetch/cache run details with progress tracking
      // The dataStore listener will automatically update testStats when data arrives
      await fetchAndCacheRunDetails(runNumbers, undefined, loadAll);
      
      // Get final stats from the dataStore (the listener will have updated them too)
      const finalStats = getTestStatsFromCache();
      setTestStats(finalStats);
      setTestDataLoaded(true);
      
      console.log(`Completed fetching details for ${runsToLoad.length} runs. Found ${finalStats.size} unique tests.`);
      
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
      accessorKey: 'metadata.petriPassed',
      header: 'Passed',
      enableSorting: true,
      cell: (info) => (
        <span className="passed-count">{info.getValue<number>()}</span>
      ),
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
                  All
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
              {testStats.size > 0 && (
                <div className="architecture-filter-section">
                  <select
                    value={testArchitectureFilter}
                    onChange={(e) => setTestArchitectureFilter(e.target.value)}
                    className="architecture-filter-select"
                  >
                    <option value="all">All Architectures</option>
                    {Array.from(new Set(Array.from(testStats.values()).map(test => test.testName.split('/')[0]))).sort().map(arch => (
                      <option key={arch} value={arch}>
                        {arch}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!getAnalysisState().loadAllRuns && getCachedRunCount() < runs.length && (
                <button 
                  className="load-all-btn"
                  onClick={() => loadTestData(true)}
                  disabled={getAnalysisState().isLoading}
                >
                  Analyze all runs
                </button>
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
                {!getAnalysisState().loadAllRuns && getCachedRunCount() < runs.length && (
                  <span> • Analyzed {getCachedRunCount()} of {runs.length} runs</span>
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
          onLoadAll={() => loadTestData(true)}
          searchFilter={testSearchFilter}
          architectureFilter={testArchitectureFilter}
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