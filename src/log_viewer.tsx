import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Hamburger } from './hamburger';
import { Link, useParams, useLocation } from 'react-router-dom';
import { getCachedRunDetails } from './dataStore';
import { TestResult } from './fetch';
import { VirtualizedTable } from './VirtualizedTable';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    ColumnDef,
    SortingState,
} from '@tanstack/react-table';
import './styles/common.css';

const baseUrl = "https://openvmmghtestresults.blob.core.windows.net/results";

interface InspectViewerHeaderProps {
    runId: string;
    testName: string;
    searchFilter: string;
    setSearchFilter: (filter: string) => void;
    onClearFilter: () => void;
}

interface LogEntry {
    index: number;
    timestamp: string;
    relative: string;
    severity: string;
    source: string;
    messageNode: HTMLElement;
    messageText: string;
    screenshot: string | null;
}

function InspectViewerHeader({ runId, testName, searchFilter, setSearchFilter, onClearFilter }: InspectViewerHeaderProps): React.JSX.Element {
    // Split test name into architecture and name
    const parts = testName.split('/');
    const architecture = parts.length > 1 ? parts[0] : '';
    const name = parts.length > 1 ? parts.slice(1).join('/') : testName;

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
                    <Hamburger />
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
                            to={`/runs/${runId}/${encodeURIComponent(testName)}`}
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
                            title={testName}
                        >
                            {name}
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

export function InspectViewer(): React.JSX.Element {
    const [searchFilter, setSearchFilter] = useState<string>('');
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [selectedRow, setSelectedRow] = useState<string | null>(null);
    const [modalContent, setModalContent] = useState<{ type: 'image' | 'text' | 'iframe', content: string } | null>(null);
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [sorting, setSorting] = useState<SortingState>([]);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const { runId, testName: encodedTestName } = useParams();
    const location = useLocation();
    const testName = encodedTestName ? decodeURIComponent(encodedTestName) : 'unknown';


    // Try to get test data from navigation state or cached run details
    useEffect(() => {
        // First check if test data was passed via navigation state
        const stateTestResult = location.state?.testResult as TestResult | undefined;
        if (stateTestResult) {
            setTestResult(stateTestResult);
            return;
        }

        // Fall back to checking cached run details
        if (runId) {
            const cachedRunDetails = getCachedRunDetails(runId);
            if (cachedRunDetails) {
                const foundTest = cachedRunDetails.tests.find(test => test.name === testName);
                if (foundTest) {
                    setTestResult(foundTest);
                    return;
                }
            }
        }

        // No cached data found
        setTestResult(null);
    }, [runId, testName, location.state]);    // Utility functions from test.html
    const node = (tag: string, attrs: any = {}, ...content: any[]): HTMLElement => {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'class') {
                element.className = value as string;
            } else if (key === 'dataset') {
                Object.assign(element.dataset, value);
            } else if (typeof value === 'object' && value !== null && value.constructor === Object) {
                Object.assign((element as any)[key], value);
            } else {
                element.setAttribute(key, value as string);
            }
        }
        element.append(...content);
        return element;
    };

    const removeTimestamp = (orig: string, entryTimestamp: Date): string => {
        const message = orig.trim();
        const i = message.indexOf(" ");
        if (i === -1) return orig;

        let ts = message.slice(0, i);
        if (ts.endsWith("s")) {
            const secs = parseFloat(ts.slice(0, -1));
            if (!isNaN(secs)) return message.slice(i + 1);
        }

        if (ts.startsWith("[")) {
            ts = ts.slice(1, -1);
        }
        const parsedTs = new Date(ts);
        if (isNaN(parsedTs.getTime())) return orig;

        parsedTs.setMilliseconds(0);
        const truncatedTs = new Date(entryTimestamp.getTime());
        truncatedTs.setMilliseconds(0);
        if (parsedTs.getTime() !== truncatedTs.getTime()) return orig;

        return message.slice(i + 1);
    };

    const replaceSeverity = (orig: string, severity: string): { message: string, severity: string } => {
        const severityLevels = ["ERROR", "WARN", "INFO", "DEBUG"];
        const message = orig.trim();
        for (const level of severityLevels) {
            if (message.startsWith(level)) {
                return {
                    message: message.slice(level.length + 1),
                    severity: level
                };
            }
        }
        return { message: orig, severity: severity };
    };

    const formatRelative = (from: string, to: string): string => {
        const deltaMs = new Date(to).getTime() - new Date(from).getTime();
        const sec = ((deltaMs / 1000) % 60).toFixed(3);
        const min = Math.floor((deltaMs / 60000) % 60);
        const hr = Math.floor(deltaMs / 3600000);
        return `${hr > 0 ? hr + 'h ' : ''}${min}m ${sec}s`;
    };

    const ansiToSpan = (str: string): HTMLElement => {
        const ANSI_STYLE_MAP: { [key: string]: string } = {
            '1': 'font-weight: bold', '3': 'font-style: italic', '4': 'text-decoration: underline',
            '30': 'color: black', '31': 'color: red', '32': 'color: green',
            '33': 'color: #b58900', '34': 'color: blue', '35': 'color: magenta',
            '36': 'color: cyan', '37': 'color: white',
            '90': 'color: gray', '91': 'color: lightcoral', '92': 'color: lightgreen',
            '93': 'color: gold', '94': 'color: lightskyblue', '95': 'color: plum',
            '96': 'color: lightcyan', '97': 'color: white',
            '39': 'color: inherit'
        };

        const ESC_REGEX = /\u001b\[([0-9;]*)m/g;
        let result = node("span");
        let lastIndex = 0;
        let currentStyles: string[] = [];

        const flush = (text: string) => {
            if (!text) return;
            if (currentStyles.length > 0) {
                result.append(node("span", { style: currentStyles.join('; ') }, text));
            } else {
                result.append(text);
            }
        };

        for (const match of str.matchAll(ESC_REGEX)) {
            const [fullMatch, codeStr] = match;
            const index = match.index!;

            flush(str.slice(lastIndex, index));

            const codes = codeStr.split(';');
            for (const code of codes) {
                if (code === '0') {
                    currentStyles = [];
                    continue;
                }
                const style = ANSI_STYLE_MAP[code];
                if (style) {
                    const type = style.split(':')[0];
                    currentStyles = currentStyles.filter(s => !s.startsWith(type));
                    currentStyles.push(style);
                }
            }

            lastIndex = index + fullMatch.length;
        }

        flush(str.slice(lastIndex));
        return result;
    };

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
                <div dangerouslySetInnerHTML={{ __html: info.row.original.messageNode.innerHTML }} />
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

    // Fetch test results
    useEffect(() => {
        const fetchTestResults = async () => {
            if (!runId || !testName) {
                return;
            }

            setLoading(true);
            try {
                // Try to construct the correct URL. The path structure is: runId/architecture/jobName/testName  
                // If we have test result data with path, use it, otherwise try common job names
                const tryFetchWithJobNames = async (jobNames: string[]) => {
                    for (const jobName of jobNames) {
                        const tryUrl = `${baseUrl}/${runId}/${jobName}/${testName}/petri.jsonl`;
                        try {
                            const tryResponse = await fetch(tryUrl);
                            if (tryResponse.ok) {
                                return { response: tryResponse, url: tryUrl };
                            }
                        } catch (error) {
                        }
                    }
                    throw new Error('Could not find petri.jsonl with any job name');
                };

                let url = '';
                let response: Response;

                if (testResult && testResult.path) {
                    // Use the path from test result if available
                    url = `${baseUrl}/${testResult.path}/petri.jsonl`;
                    response = await fetch(url);
                    if (!response.ok) {
                        const result = await tryFetchWithJobNames(['default', 'ci', 'main', 'pr']);
                        response = result.response;
                        url = result.url;
                    }
                } else {
                    // Try common job names
                    const result = await tryFetchWithJobNames(['default', 'ci', 'main', 'pr']);
                    response = result.response;
                    url = result.url;
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.text();

                if (data.length === 0) {
                    setLogEntries([]);
                    setFilteredLogs([]);
                    return;
                }

                let lines: any[];
                try {
                    lines = data.split("\n").filter(line => line.trim() !== "").map(line => JSON.parse(line));
                } catch (parseError) {
                    throw parseError;
                }
                lines.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                const entries: LogEntry[] = [];
                let start: string | null = null;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const timestamp = line.timestamp;
                    let message = line.message || "";
                    let severity = line.severity || "INFO";
                    const source = line.source || (line.attachment ? "attachment" : "unknown");

                    let attachment = null;
                    if (line.attachment) {
                        attachment = new URL(line.attachment, url);
                        if (line.attachment.endsWith(".png") && entries.length > 0) {
                            entries[entries.length - 1].screenshot = attachment.toString();
                            continue;
                        }
                    }

                    if (!start) {
                        start = line.timestamp;
                    }
                    const relative = start ? formatRelative(start, timestamp) : '0m 0.000s';

                    message = removeTimestamp(message, new Date(line.timestamp));
                    const r = replaceSeverity(message, severity);
                    message = r.message;
                    severity = r.severity;

                    const messageNode = ansiToSpan(message);
                    if (attachment) {
                        if (messageNode.children.length > 0) {
                            messageNode.append(" ");
                        }
                        if (line.attachment.includes('inspect')) {
                            const link = node("a", { href: attachment.toString(), class: "attachment", target: "_blank", "data-inspect": "true" }, line.attachment);
                            const rawLink = node("a", { href: attachment.toString(), class: "attachment", target: "_blank" }, "[raw]");
                            messageNode.append(link, ' ', rawLink);
                        } else {
                            const link = node("a", { href: attachment.toString(), class: "attachment", target: "_blank" }, line.attachment);
                            messageNode.append(link);
                        }
                    }

                    entries.push({
                        index: i,
                        timestamp: timestamp,
                        relative: relative,
                        severity: severity,
                        source: source,
                        messageNode: messageNode,
                        messageText: messageNode.textContent?.toLowerCase() || '',
                        screenshot: null,
                    });
                }

                setLogEntries(entries);
                setFilteredLogs(entries);
            } catch (error) {
                console.error('❌ Error fetching test results:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchTestResults();
    }, [runId, testName, testResult]);

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
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [modalContent, searchFilter]);

    const handleRowClick = (logId: string, event: React.MouseEvent) => {
        if ((event.target as HTMLElement).closest('a')) return;

        if (selectedRow === logId) {
            setSelectedRow(null);
        } else {
            setSelectedRow(logId);
        }
    };

    const handleClearFilter = () => {
        setSearchFilter('');
        searchInputRef.current?.focus();
    };

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
                <InspectViewerHeader
                    runId={runId || 'unknown'}
                    testName={testName}
                    searchFilter={searchFilter}
                    setSearchFilter={setSearchFilter}
                    onClearFilter={handleClearFilter}
                />
            </div>

            <div style={{ fontFamily: 'monospace', fontSize: '14px', position: 'relative' }}>
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
                            handleRowClick(logId, event);
                        }}
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
        </div>
    );
}
