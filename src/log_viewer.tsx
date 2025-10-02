import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Menu } from './menu';
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import { VirtualizedTable } from './virtualized_table';
import { InspectOverlay } from './inspect';
import { fetchProcessedPetriLog, ProcessedLogEntry } from './fetch';
import { useQueryClient } from '@tanstack/react-query';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    ColumnDef,
    SortingState,
} from '@tanstack/react-table';
import './styles/common.css';

interface InspectViewerHeaderProps {
    runId: string;
    architecture: string;
    testNameRemainder: string; // portion after architecture
    fullTestName: string; // architecture + '/' + remainder
    searchFilter: string;
    setSearchFilter: (filter: string) => void;
    onClearFilter: () => void;
}

// Display entry shape sourced from fetchProcessedPetriLog
interface LogEntry extends ProcessedLogEntry { }

function LogViewerHeader({ runId, architecture, testNameRemainder, fullTestName, searchFilter, setSearchFilter, onClearFilter }: InspectViewerHeaderProps): React.JSX.Element {
    const encodedArchitecture = encodeURIComponent(architecture);
    const encodedRemainder = encodeURIComponent(testNameRemainder);

    return (
        <>
            <div className="runs-header-left-section" style={{ minWidth: 0, flex: 1, display: 'flex' }}>
                <div
                    className="runs-header-title-section"
                    style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: '0.75rem',
                        overflow: 'hidden',
                        minWidth: 0,
                        flex: 1
                    }}
                >
                    <Menu />
                    <h3
                        style={{
                            margin: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            overflow: 'hidden',
                            minWidth: 0,
                            flex: 1
                        }}
                    >
                        <span style={{ flexShrink: 0 }}>../</span>
                        <Link to={`/runs/${runId}`} className="common-page-path" style={{ color: 'inherit', flexShrink: 0 }}>{runId}</Link>
                        <span style={{ flexShrink: 0 }}>/</span>
                        <Link
                            to={`/runs/${runId}/${encodedArchitecture}/${encodedRemainder}`}
                            className="common-page-path"
                            style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                minWidth: 0,
                                flexShrink: 1,
                                color: 'inherit',
                                display: 'block',
                                maxWidth: '100%'
                            }}
                            title={fullTestName}
                        >
                            {testNameRemainder}
                        </Link>
                        {architecture && (
                            <span
                                style={{
                                    flexShrink: 0,
                                    color: '#888',
                                    fontSize: '0.75em',
                                    fontWeight: 'normal',
                                    marginLeft: '0.4rem',
                                    lineHeight: '1',
                                    paddingLeft: '0.4rem',
                                }}
                            >
                                {architecture}
                            </span>
                        )}
                    </h3>
                </div>
            </div>
            <div className="runs-header-right-section" style={{ position: 'relative', display: 'inline-block' }}>
                <input
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filter Logs ..."
                    className="common-search-input"
                    style={{ paddingRight: '28px' }}
                />
                {searchFilter && (
                    <button
                        onClick={onClearFilter}
                        style={{
                            position: 'absolute',
                            right: '6px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'none',
                            border: 'none',
                            fontSize: '16px',
                            color: '#888',
                            cursor: 'pointer',
                            padding: 0,
                            lineHeight: 1
                        }}
                        title="Clear filter"
                    >
                        ×
                    </button>
                )}
            </div>
        </>
    );
}

export function LogViewer(): React.JSX.Element {
    const [searchFilter, setSearchFilter] = useState<string>('');
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [selectedRow, setSelectedRow] = useState<string | null>(null);
    const [pendingScrollIndex, setPendingScrollIndex] = useState<number | null>(null);
    const [modalContent, setModalContent] = useState<{ type: 'image' | 'text' | 'iframe', content: string } | null>(null);
    const [inspectFileUrl, setInspectFileUrl] = useState<string | null>(null);
    // Removed cached testResult usage – we now always fetch directly
    const [sorting, setSorting] = useState<SortingState>([]);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const logContainerRef = useRef<HTMLDivElement>(null);
    // Deep link initialization refs
    const initialLogParamRef = useRef<number | null>(null);
    const initializedFromUrlRef = useRef<boolean>(false);

    const { runId, architecture: archParam, testName: encodedTestName } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    // Build full test name depending on whether new (architecture + remainder) or legacy route
    let fullTestName: string;
    let architecture: string;
    let testNameRemainder: string;
    if (archParam) {
        architecture = decodeURIComponent(archParam);
        testNameRemainder = encodedTestName ? decodeURIComponent(encodedTestName) : '';
        fullTestName = architecture + '/' + testNameRemainder;
    } else {
        const legacy = encodedTestName ? decodeURIComponent(encodedTestName) : 'unknown';
        const parts = legacy.split('/');
        architecture = parts.length > 1 ? parts[0] : '';
        testNameRemainder = parts.length > 1 ? parts.slice(1).join('/') : legacy;
        fullTestName = legacy;
    }


    const queryClient = useQueryClient();

    const tokenizeSearchQuery = (query: string): string[] => {
        const quoteCount = (query.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            query += '"';
        }
        const regex = /"([^"]+)"|(\S+)/g;
        const tokens: string[] = [];
        let match;
        while ((match = regex.exec(query))) {
            tokens.push(match[1] || match[2]);
        }
        return tokens;
    };

    const rowMatchesQuery = (log: LogEntry, tokens: string[]): boolean => {
        return tokens.every(token => {
            const [prefix, ...rest] = token.split(':');
            const term = rest.join(':').toLowerCase();

            if (prefix === 'source') {
                return log.source.toLowerCase().includes(term);
            } else if (prefix === 'severity') {
                return log.severity.toLowerCase().includes(term);
            } else if (prefix === 'message') {
                return log.messageText.includes(term);
            } else {
                return (
                    log.source.toLowerCase().includes(token.toLowerCase()) ||
                    log.severity.toLowerCase().includes(token.toLowerCase()) ||
                    log.messageText.includes(token.toLowerCase())
                );
            }
        });
    };

    // Define columns for the virtualized table
    const columns = useMemo<ColumnDef<LogEntry>[]>(() => [
        {
            accessorKey: 'relative',
            header: 'Timestamp',
            cell: (info) => (
                <span title={info.row.original.timestamp}>
                    {info.getValue() as string}
                </span>
            ),
            enableSorting: true,
        },
        {
            accessorKey: 'severity',
            header: 'Severity',
            enableSorting: false,
        },
        {
            accessorKey: 'source',
            header: 'Source',
            enableSorting: false,
        },
        {
            id: 'message',
            accessorFn: (row) => row.messageText, // Use text for sorting/filtering
            header: 'Message',
            cell: (info) => (
                <div dangerouslySetInnerHTML={{ __html: info.row.original.messageHtml }} />
            ),
            enableSorting: false, // Disable sorting for complex HTML content
        },
        {
            id: 'screenshot',
            header: 'Screenshot',
            cell: (info) => {
                const screenshot = info.row.original.screenshot;
                return screenshot ? (
                    <img
                        src={screenshot}
                        alt="Screenshot"
                        style={{
                            maxWidth: '100px',
                            maxHeight: '50px',
                            cursor: 'pointer',
                            objectFit: 'contain'
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            setModalContent({ type: 'image', content: screenshot });
                        }}
                    />
                ) : '';
            },
            enableSorting: false,
        }
    ], []);

    // Create the table
    const table = useReactTable({
        data: filteredLogs,
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

    // Fetch + process log entries via react-query helper
    useEffect(() => {
        if (!runId || !fullTestName) return;
        setLoading(true);
        queryClient.fetchQuery({
            queryKey: ['petriLog', runId, architecture, testNameRemainder],
            queryFn: () => fetchProcessedPetriLog(runId, architecture, testNameRemainder),
            staleTime: 60 * 1000, // 1 min stale window for logs
            gcTime: 5 * 60 * 1000,
        }).then(entries => {
            setLogEntries(entries as LogEntry[]);
            setFilteredLogs(entries as LogEntry[]);
        }).catch(err => {
            console.error('❌ Error fetching test results:', err);
            setLogEntries([]);
            setFilteredLogs([]);
        }).finally(() => setLoading(false));
    }, [queryClient, runId, fullTestName, architecture, testNameRemainder]);

    // Intercept clicks on inspect attachment links to open overlay
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            const anchor = target.closest('a[data-inspect="true"]') as HTMLAnchorElement | null;
            if (anchor) {
                e.preventDefault();
                setInspectFileUrl(anchor.href);
            }
        };
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    // Filter logs when search changes
    useEffect(() => {
        if (!searchFilter) {
            setFilteredLogs(logEntries);
        } else {
            const tokens = tokenizeSearchQuery(searchFilter);
            const filtered = logEntries.filter(log => rowMatchesQuery(log, tokens));
            setFilteredLogs(filtered);
        }
    }, [searchFilter, logEntries]);

    // Handle keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const isF = e.key === 'f' || e.key === 'F';
            const isFind = (isMac && e.metaKey && isF) || (!isMac && e.ctrlKey && isF);

            if (isFind && !modalContent && document.activeElement !== searchInputRef.current) {
                e.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
                return;
            }

            if (e.key === 'Escape') {
                if (modalContent) {
                    setModalContent(null);
                } else if (searchFilter) {
                    setSearchFilter('');
                } else if (document.activeElement === searchInputRef.current) {
                    searchInputRef.current?.blur();
                }
            }

            // Custom copy handlers
            const isCopyCombo = (e.key === 'c' || e.key === 'C') && (e.metaKey || e.ctrlKey);
            if (!isCopyCombo) return;

            // Don't override when typing in an input/textarea or there is an actual text selection
            const active = document.activeElement as HTMLElement | null;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) return;

            // Need a selected log row
            if (!selectedRow) return;

            const idx = parseInt(selectedRow.replace('log-', ''), 10);
            if (isNaN(idx)) return;
            const entry = logEntries.find(le => le.index === idx);
            if (!entry) return;

            if (e.shiftKey) {
                // Ctrl+Shift+C (or Cmd+Shift+C) => copy deep link to this log line (hash-based routing aware)
                e.preventDefault();
                const { origin, pathname, hash } = window.location;
                // HashRouter format: <origin><pathname>#/route/segments?query
                const hashParts = hash.split('?');
                const hashRoute = hashParts[0] || '#/';
                const hashQuery = hashParts[1] ? new URLSearchParams(hashParts[1]) : new URLSearchParams();
                hashQuery.set('log', String(entry.index));
                const deepLink = `${origin}${pathname}${hashRoute}?${hashQuery.toString()}`;
                navigator.clipboard?.writeText(deepLink).catch(() => {
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = deepLink; ta.style.position = 'fixed'; ta.style.opacity = '0';
                        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                    } catch { /* no-op */ }
                });
                return;
            }

            // Plain Ctrl+C => copy JSON representation of the selected log line only
            e.preventDefault();
            const jsonObj: Record<string, any> = {
                index: entry.index,
                timestamp: entry.timestamp,
                relative: entry.relative,
                severity: entry.severity,
                source: entry.source,
                message: entry.messageText.trim(),
            };
            if (entry.screenshot) jsonObj.screenshot = entry.screenshot;
            const jsonBlock = JSON.stringify(jsonObj, null, 2);
            navigator.clipboard?.writeText(jsonBlock).catch(() => {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = jsonBlock; ta.style.position = 'fixed'; ta.style.opacity = '0';
                    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                } catch { /* no-op */ }
            });
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [modalContent, searchFilter, selectedRow, logEntries, location.search]);

    const handleRowClick = (originalIndex: number, logId: string, event: React.MouseEvent) => {
        if ((event.target as HTMLElement).closest('a')) return; // ignore clicks on links

        // Detect if user is performing a text selection inside this row. If so, never remove the highlight.
        const sel = window.getSelection();
        const isSelectingText = !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
        const currentTarget = event.currentTarget as HTMLElement | null;
        let selectionInsideRow = false;
        if (isSelectingText && currentTarget && sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const common = range.commonAncestorContainer;
            selectionInsideRow = currentTarget.contains(common.nodeType === 1 ? common as Node : common.parentElement as Node);
        }

        const params = new URLSearchParams(location.search);

        // If already selected and the user is dragging/selecting text inside the row, keep selection & ensure URL param is present.
        if (selectedRow === logId && selectionInsideRow) {
            if (!params.get('log')) {
                params.set('log', originalIndex.toString());
                navigate(`${location.pathname}?${params.toString()}`, { replace: true });
            }
            return; // do not toggle off
        }

        if (selectedRow === logId) {
            // Plain click on an already selected row (no text selection) -> toggle off
            setSelectedRow(null);
            params.delete('log');
            navigate(params.toString() ? `${location.pathname}?${params.toString()}` : location.pathname, { replace: true });
            return;
        }

        // Selecting a new row
        setSelectedRow(logId);
        params.set('log', originalIndex.toString());
        navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    };

    const handleClearFilter = () => {
        setSearchFilter('');
        searchInputRef.current?.focus();
    };

    // Capture the initial ?log param once per runId/testName change
    useEffect(() => {
        initializedFromUrlRef.current = false;
        const params = new URLSearchParams(location.search);
        const raw = params.get('log');
        if (raw == null) {
            initialLogParamRef.current = null;
            // Even if absent we consider initialization done (no auto-selection needed)
            initializedFromUrlRef.current = true;
            return;
        }
        const parsed = parseInt(raw, 10);
        if (isNaN(parsed)) {
            initialLogParamRef.current = null;
            initializedFromUrlRef.current = true;
            return;
        }
        initialLogParamRef.current = parsed;
    }, [runId, fullTestName]);

    // Perform one-time selection & scroll after logs load (deep link only)
    useEffect(() => {
        if (initializedFromUrlRef.current) return; // already handled (or none needed)
        const target = initialLogParamRef.current;
        if (target == null) return; // nothing to do
        if (!logEntries.length) return; // wait for entries
        const entryExists = logEntries.some(le => le.index === target);
        if (!entryExists) {
            initializedFromUrlRef.current = true; // finalize even if missing
            return;
        }
        const logId = `log-${target}`;
        setSelectedRow(logId);
        const displayIdx = filteredLogs.findIndex(l => l.index === target);
        if (displayIdx >= 0) setPendingScrollIndex(displayIdx);
        initializedFromUrlRef.current = true; // prevent future runs
    }, [logEntries, filteredLogs]);

    // Once we've scrolled for the deep link, clear the pending index so subsequent clicks don't re-scroll
    useEffect(() => {
        if (pendingScrollIndex == null) return;
        const id = requestAnimationFrame(() => setPendingScrollIndex(null));
        return () => cancelAnimationFrame(id);
    }, [pendingScrollIndex]);

    return (
        <div className="common-page-display">
            <style>
                {`
                    .severity-ERROR td {
                        border-left: 4px solid #d00 !important;
                        color: #900;
                    }
                    .severity-WARN td {
                        border-left: 4px solid #d98e00 !important;
                        color: #a65f00;
                    }
                    .severity-INFO td {
                        border-left: 4px solid #007acc !important;
                        color: #004e7a;
                    }
                    .severity-DEBUG td {
                        border-left: 4px solid #888 !important;
                        color: #555;
                    }
                    .selected {
                        outline: 2px solid #007acc !important;
                        outline-offset: -2px;
                    }
                    .virtualized-table-row {
                        cursor: pointer;
                    }
                    .virtualized-table-row td:nth-child(4) {
                        word-break: break-word;
                    }
                `}
            </style>
            <div className="common-page-header">
                <LogViewerHeader
                    runId={runId || 'unknown'}
                    architecture={architecture}
                    testNameRemainder={testNameRemainder}
                    fullTestName={fullTestName}
                    searchFilter={searchFilter}
                    setSearchFilter={setSearchFilter}
                    onClearFilter={handleClearFilter}
                />
            </div>

            <div ref={logContainerRef} style={{ fontFamily: 'monospace', fontSize: '14px', position: 'relative' }}>
                {filteredLogs.length === 0 && !loading ? (
                    <div style={{ padding: '20px', textAlign: 'center', fontStyle: 'italic', color: '#888' }}>
                        No log entries found
                    </div>
                ) : (
                    <VirtualizedTable<LogEntry>
                        table={table}
                        columnWidthMap={{
                            relative: 100,
                            severity: 80,
                            source: 80,
                            screenshot: 100,
                        }}
                        estimatedRowHeight={50}
                        getRowClassName={(row) => {
                            const logId = `log-${row.original.index}`;
                            const isSelected = selectedRow === logId;
                            const severityClass = `severity-${row.original.severity}`;
                            return `${severityClass} ${isSelected ? 'selected' : ''}`;
                        }}
                        onRowClick={(row, event) => {
                            const logId = `log-${row.original.index}`;
                            handleRowClick(row.original.index, logId, event);
                        }}
                        scrollToIndex={pendingScrollIndex}
                    />
                )}
            </div>

            {/* Modal */}
            {modalContent && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        backgroundColor: 'rgba(0, 0, 0, 0.25)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 9999
                    }}
                    onClick={() => setModalContent(null)}
                >
                    {modalContent.type === 'image' && (
                        <img
                            src={modalContent.content}
                            alt="screenshot"
                            style={{
                                maxWidth: '90%',
                                maxHeight: '90%',
                                boxShadow: '0 0 12px rgba(0, 0, 0, 0.8)',
                                borderRadius: '6px'
                            }}
                        />
                    )}
                    {modalContent.type === 'text' && (
                        <pre style={{
                            maxWidth: '90%',
                            maxHeight: '90%',
                            background: 'white',
                            color: 'black',
                            fontFamily: 'monospace',
                            fontSize: '14px',
                            overflow: 'auto',
                            padding: '16px',
                            borderRadius: '6px',
                            boxShadow: '0 0 12px rgba(0, 0, 0, 0.8)',
                            whiteSpace: 'pre-wrap',
                            cursor: 'auto'
                        }} onClick={(e) => e.stopPropagation()}>
                            {modalContent.content}
                        </pre>
                    )}
                </div>
            )}
            {inspectFileUrl && (
                <InspectOverlay fileUrl={inspectFileUrl} onClose={() => setInspectFileUrl(null)} />
            )}
        </div>
    );
}
