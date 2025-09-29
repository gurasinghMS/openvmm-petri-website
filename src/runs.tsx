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
  const [globalFilter, setGlobalFilter] = useState('');

  // Filter runs based on branch selection
  const filteredRuns = useMemo(() => {
    if (branchFilter === 'all') {
      return runs;
    }
    return runs.filter(run => run.metadata.ghBranch === branchFilter);
  }, [runs, branchFilter]);

  const columns = useMemo(() => createColumns((runId: string) => navigate(`/runs/${runId}`)), [navigate]);

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
  return (
    <div className="common-page-display">
      <div className="common-page-header">
        <RunsHeader
          branchFilter={branchFilter}
          setBranchFilter={setBranchFilter}
          globalFilter={globalFilter}
          setGlobalFilter={setGlobalFilter}
          resultCount={table.getFilteredRowModel().rows.length}
        />
      </div>
      <VirtualizedRunsTable table={table} />
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
          <div className="status-cell">
            <span className={status === 'passed' ? 'status-pass' : 'status-fail'}>
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
          <span
            className="branch-name"
            title={branch}
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              lineHeight: '1.1rem',
              maxHeight: '2.0rem', // 2 lines * lineHeight
            }}
          >
            {branch}
          </span>
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
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'normal',
                lineHeight: '1.1rem',
                maxHeight: '2.1rem',
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
