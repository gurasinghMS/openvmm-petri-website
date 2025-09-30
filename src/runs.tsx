import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import './styles/runs.css';
import './styles/common.css';
import { fetchRunData, RunData } from './fetch';
import { Hamburger } from './hamburger';
import { VirtualizedRunsTable } from './VirtualizedTable.tsx';
import { useNavigate, Link } from 'react-router-dom';

export function Runs(): React.JSX.Element {
  const [runs, setRuns] = useState<RunData[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [internalFilter, setInternalFilter] = useState<string>('');
  const navigate = useNavigate();

  // Query client should allow us to cache and reuse the data.
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.fetchQuery({
      queryKey: ['runs'],
      queryFn: () => fetchRunData(queryClient),
      staleTime: 3 * 60 * 1000, // runs list can revalidate every 3 minutes
      gcTime: 5 * 60 * 1000,
    }).then(setRuns);
  }, [queryClient]);

  // Default sort by creation time, newest first
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'creationTime', desc: true }
  ]);

  // Filter runs based on branch selection and search terms
  const filteredRuns = useMemo(() => {
    let branchFiltered = branchFilter === 'all' ? runs : runs.filter(run => run.metadata.ghBranch === branchFilter);
    const terms = internalFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return branchFiltered;
    console.log("Filtering with terms:", terms);
    return branchFiltered.filter(run => {
      // Search in run name, status, branch, PR, and PR title
      const status = run.metadata.petriFailed === 0 ? 'passed' : 'failed';
      const pr = run.metadata.ghPr ? `${run.metadata.ghPr} ${run.metadata.prTitle || ''}` : '';
      const haystack = `${run.name} ${status} ${run.metadata.ghBranch || ''} ${pr}`.toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }, [runs, branchFilter, internalFilter]);

  const columns = useMemo(() => createColumns((runId: string) => navigate(`/runs/${runId}`)), [navigate]);

  const table = useReactTable({
    data: filteredRuns,
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
    debugTable: false,
  });
  return (
    <div className="common-page-display">
      <div className="common-page-header">
        <RunsHeader
          branchFilter={branchFilter}
          setBranchFilter={setBranchFilter}
          globalFilter={internalFilter}
          setGlobalFilter={setInternalFilter}
          resultCount={filteredRuns.length}
        />
      </div>
      <VirtualizedRunsTable table={table} />
      {filteredRuns.length === 0 && runs.length > 0 && (
        <div className="no-results" style={{ padding: '1rem' }}>
          No runs match your search criteria.
        </div>
      )}
    </div>
  );
}

// Define the columns for the runs table
const createColumns = (onRunClick: (runId: string) => void): ColumnDef<RunData>[] => {
  return [
    {
      accessorKey: 'name',
      header: 'Run',
      enableSorting: true,
      cell: (info) => {
        const runId = info.getValue<string>().replace('runs/', '');
        return (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onRunClick(runId);
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
          <div className="common-status-cell">
            <span className={status === 'passed' ? 'common-status-pass' : 'common-status-fail'}>
            </span>
          </div>
        );
      },
    },
    {
      id: 'failed',
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
      cell: (info) => {
        const branch = info.getValue<string>() || '';
        return (
          <div
            className="branch-name"
            title={branch}
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: '1.25rem',
            }}
          >
            {branch}
          </div>
        );
      },
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
        const fullText = pr ? `#${pr}${prTitle ? ` ${prTitle}` : ''}` : '';
        return pr ? (
          <div className="pr-cell">
            <a
              href={`https://github.com/microsoft/openvmm/pull/${pr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="pr-combined-link"
              title={prTitle ? `#${pr} ${prTitle}` : `PR #${pr}`}
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: '1.25rem',
              }}
            >
              {fullText}
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
      id: 'ghRun', // distinct id to avoid clashing with first 'name' accessor
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
  ]
};

interface RunsHeaderProps {
  branchFilter: string;
  setBranchFilter: (branch: string) => void;
  globalFilter: string;
  setGlobalFilter: (filter: string) => void;
  resultCount: number;
}

export function RunsHeader({
  branchFilter,
  setBranchFilter,
  globalFilter,
  setGlobalFilter,
  resultCount,
}: RunsHeaderProps): React.JSX.Element {
  return (
    <>
      <div className="runs-header-left-section">
        <div className="runs-header-title-section" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Hamburger />
          <h3 style={{ margin: 0 }}>
            <Link to="/runs" className="common-page-path" style={{ color: 'inherit' }}>Runs</Link>
          </h3>
        </div>
        <div className="common-filter-buttons">
          <button
            className={`common-filter-btn ${branchFilter === 'all' ? 'active' : ''}`}
            onClick={() => setBranchFilter('all')}
          >
            all
          </button>
          <button
            className={`common-filter-btn ${branchFilter === 'main' ? 'active' : ''}`}
            onClick={() => setBranchFilter('main')}
          >
            main
          </button>
        </div>
      </div>
      <div className="runs-header-right-section">
        <input
          value={globalFilter ?? ''}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search ..."
          className="common-search-input"
        />
        <span className="results-count">
          {resultCount} runs
        </span>
      </div>
    </>
  );
}
