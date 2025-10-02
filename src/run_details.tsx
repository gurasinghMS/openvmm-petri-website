import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table';
import { RunDetails, TestResult } from './fetch';
import { Menu } from './menu';
import { VirtualizedTable } from './virtualized_table';
import { Link, useLocation } from 'react-router-dom';
import './styles/common.css';
import './styles/runs.css';
import './styles/run_details.css'
import { useQueryClient } from '@tanstack/react-query';
import { fetchRunDetails } from './fetch';
import { SearchInput } from './search';

interface RunDetailsProps {
  runId: string;
  onTestLogClick?: (testName: string, jobName: string) => void;
}

interface RunDetailsHeaderProps {
  resultCount: number;
  totalCount: number;
  runId: string;
}

function RunDetailsHeader({ resultCount, totalCount, runId }: RunDetailsHeaderProps): React.JSX.Element {
  return (
    <>
      <div className="runs-header-left-section">
        <div className="runs-header-title-section" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Menu />
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Link to="/runs" className="common-page-path" style={{ color: 'inherit' }}>Runs</Link>
            <span style={{ opacity: 0.65 }}>/</span>
            <Link to={`/runs/${runId}`} className="common-page-path" style={{ color: 'inherit' }}>{runId}</Link>
          </h3>
        </div>
      </div>
      <div className="runs-header-right-section">
        <SearchInput />
        <span className="results-count" title={`${resultCount} of ${totalCount} tests visible`}>
          {resultCount} tests
        </span>
      </div>
    </>
  );
}

export function RunDetailsView({ runId, onTestLogClick }: RunDetailsProps): React.JSX.Element {
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  // (Spinner removed) Loading state previously unused; can be reintroduced if UI needs it later.
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'status', desc: false } // Sort by status ascending, failed tests first
  ]);

  const location = useLocation();

  // Read search filter from URL params
  const getSearchFilter = (): string => {
    const params = new URLSearchParams(location.search);
    return params.get('search') ?? '';
  };

  const internalFilter = getSearchFilter();

  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    // (loading state removed)
    setError(null);

    queryClient
      .fetchQuery({
        queryKey: ['runDetails', runId],
        // Pass queryClient down so petri.jsonl / petri.passed files discovered during listing get prefetched & cached
        queryFn: () => fetchRunDetails(runId, queryClient),
        staleTime: Infinity, // never goes stale
        gcTime: 15 * 60 * 1000, // still garbage collect after 5 minutes unused
      })
      .then((details) => {
        if (!cancelled) {
          setRunDetails(details);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch run details');
        }
      })
      .finally(() => {
        // no-op (loading state removed)
      });

    return () => {
      cancelled = true;
    };
  }, [queryClient, runId]);

  // Define columns for the test results table
  const columns = useMemo<ColumnDef<TestResult>[]>(() => [
    {
      id: 'architecture',
      header: 'Architecture',
      accessorFn: (row) => {
        const parts = row.name.split('/');
        return parts.length > 1 ? parts[0] : 'Other';
      },
      cell: info => <span className="architecture-name">{info.getValue() as string}</span>,
      enableSorting: true,
    },
    {
      id: 'testName',
      header: 'Test Name',
      accessorFn: (row) => {
        const parts = row.name.split('/');
        return parts.length > 1 ? parts.slice(1).join('/') : row.name;
      },
      cell: info => {
        const testName = info.getValue() as string; // portion after first '/'
        const fullTestName = info.row.original.name; // architecture/testName...
        const [architecturePart, ...restParts] = fullTestName.split('/');
        const encodedArchitecture = encodeURIComponent(architecturePart);
        const encodedRemainder = encodeURIComponent(restParts.join('/'));
        return (
          <Link
            to={`/runs/${runId}/${encodedArchitecture}/${encodedRemainder}`}
            state={{ testResult: info.row.original }}
            className="run-name-link"
            title={`View inspect for test: ${fullTestName}`}
          >
            {testName}
          </Link>
        );
      },
      enableSorting: true,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      enableSorting: true,
      cell: (info) => {
        const status = info.getValue<string>();
        return (
          <div className="common-status-cell">
            <span className={status === 'passed' ? 'common-status-pass' : 'common-status-fail'}>
            </span>
          </div>
        );
      },
    },
  ], [onTestLogClick]);

  // Conditional AND wildcard search
  const filteredTests = useMemo(() => {
    if (!runDetails?.tests) return [];
    const terms = internalFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return runDetails.tests;
    return runDetails.tests.filter(test => {
      // Search in name and status fields
      const haystack = `${test.name} ${test.status}`.toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }, [runDetails?.tests, internalFilter]);

  // Create the table
  const table = useReactTable({
    data: filteredTests,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableSorting: true,
    enableSortingRemoval: false,
  });


  // Error state
  if (error) {
    return (
      <div className="error-message">Error: {error}</div>
    );
  }

  const totalTests = runDetails?.tests?.length || 0;

  return (
    <div className="common-page-display">
      <div className="common-page-header">
        <RunDetailsHeader
          resultCount={filteredTests.length}
          totalCount={totalTests}
          runId={runId}
        />
      </div>
      <VirtualizedTable<TestResult>
        table={table}
        columnWidthMap={{ architecture: 140, testName: 600, status: 80 }}
        estimatedRowHeight={44}
        getRowClassName={(row) => row.original.status === 'failed' ? 'failed-row' : 'passed-row'}
      />
    </div>
  );
}