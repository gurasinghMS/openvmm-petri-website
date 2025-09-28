import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  ColumnDef,
  flexRender,
  SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useQueryClient } from '@tanstack/react-query';
import './styles/runs.css';
import './styles/common.css';
import { fetchRunData, RunData } from './fetch';
import { Hamburger } from './hamburger';

export function Runs(): React.JSX.Element {
  const [runs, setRuns] = useState<RunData[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('all');

  // Query client should allow us to cache and reuse the data.
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.fetchQuery({ queryKey: ['runs'], queryFn: fetchRunData }).then(setRuns);
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

  const columns = useMemo(() => createColumns(), []);

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

  // Get the rows to render
  const { rows } = table.getRowModel();

  // Refs for header + body scroll container
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerWrapperRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  // Measure header height so we can offset the sticky body container.
  useLayoutEffect(() => {
    const el = headerWrapperRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Inject a one-time style to hide scrollbars for the virtualized body container (cross-browser)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const styleId = 'virtualized-table-hide-scrollbar';
    if (document.getElementById(styleId)) return; // already added
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .virtualized-table-body { scrollbar-width: none; -ms-overflow-style: none; }
      .virtualized-table-body::-webkit-scrollbar { width: 0; height: 0; }
    `;
    document.head.appendChild(style);
  }, []);

  // Set up the row virtualizer
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 50, // Base estimate, will be measured dynamically
    overscan: 10, // Render 10 additional rows outside the visible area
    measureElement:
      typeof window !== 'undefined' &&
        navigator.userAgent.indexOf('Firefox') === -1
        ? element => element?.getBoundingClientRect().height
        : undefined,
  });

  // Custom intertwined scroll behavior:
  //  - Scrolling DOWN: try to scroll the outer document first; once exhausted, scroll the inner table.
  //  - Scrolling UP: try to scroll the inner table first; once at top, bubble to the outer document.
  // Implementation approach: intercept wheel events on the inner container (virtualized body) and
  // manually distribute delta between window and the inner scroll container.
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      // Only handle vertical deltas; allow horizontal (if any) to pass through.
      if (e.deltaY === 0) return;

      const deltaY = e.deltaY;
      const docEl = document.documentElement;
      const maxWindowScroll = docEl.scrollHeight - window.innerHeight; // max scrollTop value for window
      const windowScrollY = window.scrollY;

      if (deltaY > 0) {
        // Scrolling DOWN: outer (window) gets priority.
        const remainingWindowScroll = maxWindowScroll - windowScrollY;
        if (remainingWindowScroll > 0) {
          // We can still scroll the window. Consume as much deltaY as possible.
          e.preventDefault();
          // Amount to apply to window.
          const applyToWindow = Math.min(deltaY, remainingWindowScroll);
          if (applyToWindow !== 0) {
            window.scrollTo({ top: windowScrollY + applyToWindow, behavior: 'auto' });
          }
          const leftover = deltaY - applyToWindow;
          if (leftover > 0) {
            // Apply leftover to inner container.
            container.scrollTop += leftover;
          }
        } else {
          // Window already at bottom; allow inner container to scroll naturally.
          // We still enforce a manual scroll to avoid mixed native/managed behavior.
          if (container.scrollTop < container.scrollHeight - container.clientHeight) {
            e.preventDefault();
            container.scrollTop += deltaY;
          }
        }
      } else { // deltaY < 0
        // Scrolling UP: inner container gets priority.
        const containerScrollTop = container.scrollTop;
        if (containerScrollTop > 0) {
          e.preventDefault();
          // How much can we move up inside container?
          const possibleUp = containerScrollTop; // max we can move up
          const desiredUp = -deltaY; // positive value
          const applyToInner = Math.min(possibleUp, desiredUp);
          if (applyToInner !== 0) {
            container.scrollTop -= applyToInner;
          }
          const leftover = desiredUp - applyToInner; // positive if we still have delta to apply upward
          if (leftover > 0) {
            // Need to scroll window up the leftover amount.
            const windowUpCapacity = windowScrollY; // how much window can scroll up
            const applyToWindow = Math.min(windowUpCapacity, leftover);
            if (applyToWindow !== 0) {
              window.scrollTo({ top: windowScrollY - applyToWindow, behavior: 'auto' });
            }
          }
        } else {
          // Inner already at top; scroll window if possible.
          if (windowScrollY > 0) {
            e.preventDefault();
            const applyToWindow = Math.min(windowScrollY, -deltaY);
            if (applyToWindow !== 0) {
              window.scrollTo({ top: windowScrollY - applyToWindow, behavior: 'auto' });
            }
          }
        }
      }
    };

    // Use passive:false so we can preventDefault when we manually handle deltas.
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [tableContainerRef]);

  // Global (outer) wheel handling so the intertwined scroll behavior also applies
  // when the user scrolls outside the table container area.
  // Rules to preserve:
  //  - Scrolling DOWN: window first, then (if window at bottom) table.
  //  - Scrolling UP: table first, then (if table at top) window.
  // NOTE: We skip handling if the original target is inside the table container
  // because the container-level listener above already provides the desired behavior.
  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) return;

    const onWindowWheel = (e: WheelEvent) => {
      // Ignore if event already handled / not vertical / originates inside container.
      if (e.defaultPrevented || e.deltaY === 0) return;
      if (container.contains(e.target as Node)) return; // inner listener covers this case

      const deltaY = e.deltaY;
      const docEl = document.documentElement;
      const maxWindowScroll = docEl.scrollHeight - window.innerHeight;
      const windowScrollY = window.scrollY;

      if (deltaY > 0) {
        // DOWN: window priority
        const remainingWindowScroll = maxWindowScroll - windowScrollY;
        if (remainingWindowScroll > 0) {
          // We may not need to touch container if window can absorb full delta.
          if (deltaY <= remainingWindowScroll) {
            // Let native scroll handle it for smoothness.
            return; // no preventDefault
          } else {
            // Partially consume by window, remainder by container.
            e.preventDefault();
            window.scrollTo({ top: windowScrollY + remainingWindowScroll, behavior: 'auto' });
            const leftover = deltaY - remainingWindowScroll;
            const innerRemaining = container.scrollHeight - container.clientHeight - container.scrollTop;
            if (innerRemaining > 0) {
              container.scrollTop = container.scrollTop + Math.min(leftover, innerRemaining);
            }
          }
        } else {
          // Window already at bottom; push into container if possible.
          const innerRemaining = container.scrollHeight - container.clientHeight - container.scrollTop;
          if (innerRemaining > 0) {
            e.preventDefault();
            container.scrollTop = container.scrollTop + Math.min(deltaY, innerRemaining);
          }
        }
      } else { // deltaY < 0
        // UP: table priority
        const desiredUp = -deltaY; // positive
        const containerScrollTop = container.scrollTop;
        if (containerScrollTop > 0) {
          if (desiredUp <= containerScrollTop) {
            e.preventDefault();
            container.scrollTop = containerScrollTop - desiredUp;
            return;
          } else {
            // Consume what we can in container, remainder to window.
            e.preventDefault();
            container.scrollTop = 0;
            const leftover = desiredUp - containerScrollTop;
            const applyToWindow = Math.min(windowScrollY, leftover);
            if (applyToWindow > 0) {
              window.scrollTo({ top: windowScrollY - applyToWindow, behavior: 'auto' });
            }
            return;
          }
        }
        // Container already at top; allow window to scroll up (native) unless we need to clamp.
        // Native behavior is fine; but if window cannot scroll further we just do nothing.
        // No preventDefault to keep momentum / OS feel.
      };
    };

    // Need passive:false because we may call preventDefault when redistributing delta.
    window.addEventListener('wheel', onWindowWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', onWindowWheel);
    };
  }, [tableContainerRef]);

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
      <div className="common-table" style={{ position: 'relative' }}>
        {/* Sticky header container (independent) */}
        <div
          ref={headerWrapperRef}
          style={{
            position: 'sticky',
            top: '4rem', // offset for site header
            zIndex: 999,
            background: 'white',
            boxShadow: '0 1px 0 rgba(0,0,0,0.08)'
          }}
        >
          <table className="common-advanced-table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    // Centralized width map (px) for consistent alignment between header & body
                    const widthMap: Record<string, number> = {
                      name: 100,        // Run
                      creationTime: 170, // Created
                      status: 60,       // Status
                      failed: 60,       // Failed
                      total: 60,        // Total
                      ghRun: 100,       // GH Run (custom id below)
                    };
                    const w = widthMap[header.column.id];
                    return (
                      <th
                        key={header.id}
                        className={header.column.getCanSort() ? 'sortable' : ''}
                        onClick={header.column.getToggleSortingHandler()}
                        style={{
                          padding: '6px 8px',
                          fontWeight: 600,
                          fontSize: '0.8rem',
                          letterSpacing: '0.5px',
                          textTransform: 'uppercase',
                          cursor: header.column.getCanSort() ? 'pointer' : 'default',
                          background: 'white',
                          boxSizing: 'border-box',
                          ...(w ? { width: w, minWidth: w, maxWidth: w } : {})
                        }}
                      >
                        <div className="common-advanced-table-header-content" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <span className="common-sort-indicator" style={{ flex: '0 0 auto' }}>
                              {{
                                asc: '↑',
                                desc: '↓',
                              }[header.column.getIsSorted() as string] ?? '⇅'}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
          </table>
        </div>

        {/* Sticky body container offset below header so rows never hide behind header */}
        <div
          style={{
            position: 'sticky',
            top: `calc(4rem + ${headerHeight}px)`,
            zIndex: 998,
            background: 'white'
          }}
        >
          <div
            ref={tableContainerRef}
            className="virtualized-table-body"
            style={{
              height: `calc(100vh - 4rem - ${headerHeight}px)`,
              overflow: 'auto', // keep scroll logic functional while hiding scrollbar visually
              position: 'relative'
            }}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <div
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className={`virtualized-table-row ${row.original.metadata.petriFailed > 0 ? 'failed-row' : 'passed-row'}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <table className="common-advanced-table" style={{ margin: 0, tableLayout: 'fixed', width: '100%' }}>
                      <tbody>
                        <tr>
                          {row.getVisibleCells().map((cell) => {
                            const widthMap: Record<string, number> = {
                              name: 100,
                              creationTime: 170,
                              status: 60,
                              failed: 60,
                              total: 60,
                              ghRun: 100,
                            };
                            const w = widthMap[cell.column.id];
                            return (
                              <td
                                key={cell.id}
                                style={{
                                  border: 'none',
                                  borderBottom: '1px solid #e0e0e0',
                                  boxSizing: 'border-box',
                                  ...(w ? { width: w, minWidth: w, maxWidth: w } : {})
                                }}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Define the columns for the runs table
const createColumns = (): ColumnDef<RunData>[] => {
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
              // TODO: This should just update the underlying path of the application!
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
          <h3 style={{ margin: 0 }}>Runs</h3>
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
