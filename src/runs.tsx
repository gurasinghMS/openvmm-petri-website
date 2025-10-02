import React, { useState, useEffect, useMemo } from 'react';
import {
  SortingState,
} from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import './styles/runs.css';
import './styles/common.css';
import { fetchRunData, RunData } from './fetch';
import { Menu } from './menu.tsx';
import { VirtualizedRunsTable } from './virtualized_table.tsx';
import { useNavigate, Link } from 'react-router-dom';
import { SearchInput } from './search';
import { createColumns, defaultSorting } from './table_defs/runs';

export function Runs(): React.JSX.Element {
  const [runs, setRuns] = useState<RunData[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Fetch the relevant data
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.fetchQuery({
      queryKey: ['runs'],
      queryFn: () => fetchRunData(queryClient),
      staleTime: 3 * 60 * 1000, // runs list can revalidate every 3 minutes
      gcTime: 5 * 60 * 1000,
    }).then(setRuns);
  }, [queryClient]);

  // Get the table definition (columns and default sorting)
  const navigate = useNavigate();
  const [sorting, setSorting] = useState<SortingState>(defaultSorting);
  const columns = useMemo(() => createColumns((runId: string) => navigate(`/runs/${runId}`)), [navigate]);

  // Filter runs based on branch selection and search terms
  const filteredRuns = useMemo(() => filterRuns(runs, branchFilter, searchFilter), [runs, branchFilter, searchFilter]);

  return (
    <div className="common-page-display">
      <div className="common-page-header">
        <RunsHeader
          branchFilter={branchFilter}
          setBranchFilter={setBranchFilter}
          searchFilter={searchFilter}
          setSearchFilter={setSearchFilter}
          resultCount={filteredRuns.length}
        />
      </div>
      <VirtualizedRunsTable
        data={filteredRuns}
        columns={columns}
        sorting={sorting}
        onSortingChange={setSorting}
      />
    </div>
  );
}

interface RunsHeaderProps {
  branchFilter: string;
  setBranchFilter: (branch: string) => void;
  searchFilter: string;
  setSearchFilter: (filter: string) => void;
  resultCount: number;
}

export function RunsHeader({
  branchFilter,
  setBranchFilter,
  searchFilter,
  setSearchFilter,
  resultCount,
}: RunsHeaderProps): React.JSX.Element {
  return (
    <>
      <div className="common-header-left">
        <div className="common-header-title">
          <Menu />
          <h3>
            <Link to="/runs" className="common-header-path">Runs</Link>
          </h3>
        </div>
        <div className="common-header-filter-buttons">
          <button
            className={`common-header-filter-btn ${branchFilter === 'all' ? 'active' : ''}`}
            onClick={() => setBranchFilter('all')}
          >
            all
          </button>
          <button
            className={`common-header-filter-btn ${branchFilter === 'main' ? 'active' : ''}`}
            onClick={() => setBranchFilter('main')}
          >
            main
          </button>
        </div>
      </div>
      <div className="common-header-right">
        <SearchInput value={searchFilter} onChange={setSearchFilter} />
        <span className="common-result-count">
          {resultCount} runs
        </span>
      </div>
    </>
  );
}

/**
 * filterRuns filters the list of runs based on the selected branch and search terms.
 * 
 * - Branch filtering is applied first: if 'all' is selected, all runs are included; otherwise, only runs matching the selected branch are kept.
 * - Search string is split into terms (by whitespace), and each run is checked
 *   to see if ALL terms are present.
 * - The searchable fields include: run name, status (passed/failed), branch name, PR number, and PR title.
 * - The filtering is case-insensitive.
 */
function filterRuns(runs: RunData[], branchFilter: string, searchFilter: string): RunData[] {
  let branchFiltered = branchFilter === 'all' ? runs : runs.filter(run => run.metadata.ghBranch === branchFilter);
  const terms = searchFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return branchFiltered;
  console.log("Filtering with terms:", terms);
  return branchFiltered.filter(run => {
    // Search in run name, status, branch, PR, and PR title
    const status = run.metadata.petriFailed === 0 ? 'passed' : 'failed';
    const pr = run.metadata.ghPr ? `${run.metadata.ghPr} ${run.metadata.prTitle || ''}` : '';
    const haystack = `${run.name} ${status} ${run.metadata.ghBranch || ''} ${pr}`.toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}
