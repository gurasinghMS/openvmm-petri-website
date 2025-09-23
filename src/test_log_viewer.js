import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useMemo } from 'react';
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, } from '@tanstack/react-table';
import { AdvancedSearch, evaluateQuery, defaultQuery } from './AdvancedSearch';
import './styles.css';
export function TestLogViewer({ runId, runDate, testName, jobName, onBack, githubUrl }) {
    const [logEntries, setLogEntries] = useState([]);
    const [filteredLogs, setFilteredLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchFilter, setSearchFilter] = useState('');
    const [selectedLogIndex, setSelectedLogIndex] = useState(null);
    const [modalContent, setModalContent] = useState(null);
    const [isAdvancedSearch, setIsAdvancedSearch] = useState(false);
    const [advancedQuery, setAdvancedQuery] = useState(defaultQuery);
    const [sorting, setSorting] = useState([]);
    // Format test name for display (remove path prefixes and convert __ to ::)
    const convertTestName = (name) => {
        return name.replace(/__/g, "::");
    };
    const displayTestName = convertTestName(testName.split('/').pop() || testName);
    // Extract architecture from job name (e.g., "aarch64-windows-vmm-tests-logs" -> "aarch64")
    const getArchitecture = (jobName) => {
        const parts = jobName.split('-');
        return parts[0] || jobName;
    };
    const architecture = getArchitecture(jobName);
    useEffect(() => {
        const loadTestLogs = async () => {
            try {
                setLoading(true);
                setError(null);
                // Construct the URL for the test logs based on the pattern from test.html
                // Remove the job name prefix from the test name if it exists
                const cleanTestName = testName.startsWith(jobName + '/')
                    ? testName.slice(jobName.length + 1)
                    : testName;
                const baseUrl = "https://openvmmghtestresults.blob.core.windows.net/results";
                const url = `${baseUrl}/${runId}/${jobName}/${cleanTestName}/petri.jsonl`;
                console.log(`Loading test logs with params:`, { runId, jobName, testName, cleanTestName });
                console.log(`Loading test logs from: ${url}`);
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch test logs: ${response.statusText}`);
                }
                const data = await response.text();
                const lines = data.split('\n')
                    .filter(line => line.trim() !== '')
                    .map(line => JSON.parse(line));
                // Sort by timestamp
                lines.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                // Process the logs similar to test.html
                const processedLogs = [];
                let startTime = null;
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    // Handle screenshots - they get attached to the previous log entry
                    if (line.attachment && line.attachment.endsWith('.png') && processedLogs.length > 0) {
                        // Convert relative attachment URL to absolute URL
                        const screenshotUrl = new URL(line.attachment, url).toString();
                        processedLogs[processedLogs.length - 1].screenshot = screenshotUrl;
                        continue;
                    }
                    if (!startTime) {
                        startTime = line.timestamp;
                    }
                    const relative = formatRelative(startTime, line.timestamp);
                    // Clean up message (remove timestamp prefix if present)
                    let message = line.message || '';
                    message = removeTimestamp(message, new Date(line.timestamp));
                    // Extract severity from message if present
                    const { message: cleanMessage, severity } = extractSeverity(message, line.severity || 'INFO');
                    // Convert attachment URL to absolute if it exists and is not a PNG
                    let attachmentUrl;
                    if (line.attachment && !line.attachment.endsWith('.png')) {
                        attachmentUrl = new URL(line.attachment, url).toString();
                    }
                    processedLogs.push({
                        timestamp: line.timestamp,
                        relative,
                        severity,
                        source: line.source || (line.attachment ? 'attachment' : 'unknown'),
                        message: cleanMessage,
                        attachment: attachmentUrl,
                        screenshot: undefined // Will be set by the next screenshot entry
                    });
                }
                setLogEntries(processedLogs);
                setFilteredLogs(processedLogs);
            }
            catch (err) {
                console.error('Error loading test logs:', err);
                setError(err instanceof Error ? err.message : 'Failed to load test logs');
            }
            finally {
                setLoading(false);
            }
        };
        loadTestLogs();
    }, [runId, testName, jobName]);
    // Filter logs based on search (simple or advanced)
    useEffect(() => {
        if (isAdvancedSearch) {
            // Advanced search using query builder
            const filtered = logEntries.filter(log => evaluateQuery(log, advancedQuery));
            setFilteredLogs(filtered);
        }
        else {
            // Simple search using the existing logic
            if (!searchFilter.trim()) {
                setFilteredLogs(logEntries);
                return;
            }
            const tokens = tokenizeSearchQuery(searchFilter);
            const filtered = logEntries.filter(log => rowMatchesQuery(log, tokens));
            setFilteredLogs(filtered);
        }
    }, [searchFilter, logEntries, isAdvancedSearch, advancedQuery]);
    // Keyboard handling for search and row selection
    useEffect(() => {
        const handleKeyDown = (e) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const isF = e.key === 'f' || e.key === 'F';
            const isFind = (isMac && e.metaKey && isF) || (!isMac && e.ctrlKey && isF);
            // Focus search input on Ctrl/Cmd+F
            if (isFind) {
                e.preventDefault();
                const searchInput = document.querySelector('.search-input');
                if (searchInput && !searchInput.matches(':focus')) {
                    searchInput.focus();
                    searchInput.select();
                }
                return;
            }
            // Clear search on Escape
            if (e.key === 'Escape') {
                if (modalContent) {
                    closeModal();
                }
                else if (isAdvancedSearch) {
                    setAdvancedQuery(defaultQuery);
                }
                else if (searchFilter) {
                    setSearchFilter('');
                }
                else if (selectedLogIndex !== null) {
                    setSelectedLogIndex(null);
                }
            }
        };
        const handleCopy = (e) => {
            if (selectedLogIndex !== null && filteredLogs[selectedLogIndex]) {
                const selection = window.getSelection();
                if (selection && selection.toString().trim())
                    return; // User selected text, let it be
                const log = filteredLogs[selectedLogIndex];
                const text = [log.relative, log.severity, log.source, log.message].join('\t');
                e.clipboardData?.setData('text/plain', text);
                e.preventDefault();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('copy', handleCopy);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('copy', handleCopy);
        };
    }, [searchFilter, selectedLogIndex, filteredLogs, modalContent, isAdvancedSearch]);
    // Handle URL hash for row selection
    useEffect(() => {
        const hash = window.location.hash;
        if (hash.startsWith('#log-')) {
            const index = parseInt(hash.slice(5), 10);
            if (!isNaN(index) && index >= 0 && index < filteredLogs.length) {
                setSelectedLogIndex(index);
                // Scroll to the row
                setTimeout(() => {
                    const row = document.getElementById(hash.slice(1));
                    if (row) {
                        row.scrollIntoView({ block: 'center' });
                    }
                }, 100);
            }
        }
    }, [filteredLogs]);
    // Helper functions from test.html
    function formatRelative(from, to) {
        const deltaMs = new Date(to).getTime() - new Date(from).getTime();
        const sec = ((deltaMs / 1000) % 60).toFixed(3);
        const min = Math.floor((deltaMs / 60000) % 60);
        const hr = Math.floor(deltaMs / 3600000);
        return `${hr > 0 ? hr + 'h ' : ''}${min}m ${sec}s`;
    }
    function removeTimestamp(orig, entryTimestamp) {
        const message = orig.trim();
        const i = message.indexOf(' ');
        if (i === -1)
            return orig;
        let ts = message.slice(0, i);
        if (ts.endsWith('s')) {
            const secs = parseFloat(ts.slice(0, -1));
            if (!isNaN(secs)) {
                return message.slice(i + 1);
            }
        }
        if (ts.startsWith('[')) {
            ts = ts.slice(1, -1);
        }
        const parsedTs = new Date(ts);
        if (isNaN(parsedTs.getTime()))
            return orig;
        parsedTs.setMilliseconds(0);
        const truncatedTs = new Date(entryTimestamp.getTime());
        truncatedTs.setMilliseconds(0);
        if (parsedTs.getTime() !== truncatedTs.getTime())
            return orig;
        return message.slice(i + 1);
    }
    function extractSeverity(orig, defaultSeverity) {
        const severityLevels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
        const message = orig.trim();
        for (const level of severityLevels) {
            if (message.startsWith(level)) {
                return {
                    message: message.slice(level.length + 1),
                    severity: level
                };
            }
        }
        return {
            message: orig,
            severity: (severityLevels.includes(defaultSeverity) ? defaultSeverity : 'INFO')
        };
    }
    function tokenizeSearchQuery(query) {
        const quoteCount = (query.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            query += '"';
        }
        const regex = /"([^"]+)"|(\S+)/g;
        const tokens = [];
        let match;
        while ((match = regex.exec(query))) {
            tokens.push(match[1] || match[2]);
        }
        return tokens;
    }
    // ANSI color parsing function inspired by test.html
    function parseAnsiColors(text) {
        const ANSI_STYLE_MAP = {
            // Text styles
            '1': 'font-weight: bold',
            '3': 'font-style: italic',
            '4': 'text-decoration: underline',
            // Foreground colors
            '30': 'color: black', '31': 'color: red', '32': 'color: green',
            '33': 'color: #b58900', '34': 'color: blue', '35': 'color: magenta',
            '36': 'color: cyan', '37': 'color: white',
            '90': 'color: gray', '91': 'color: lightcoral', '92': 'color: lightgreen',
            '93': 'color: gold', '94': 'color: lightskyblue', '95': 'color: plum',
            '96': 'color: lightcyan', '97': 'color: white',
            // Reset foreground
            '39': 'color: inherit'
        };
        const ESC_REGEX = /\u001b\[([0-9;]*)m/g;
        const parts = [];
        let lastIndex = 0;
        let currentStyles = [];
        const matches = Array.from(text.matchAll(ESC_REGEX));
        for (const match of matches) {
            const [fullMatch, codeStr] = match;
            const index = match.index;
            // Add plain text before this escape sequence
            if (index > lastIndex) {
                const plainText = text.slice(lastIndex, index);
                if (currentStyles.length > 0) {
                    parts.push(_jsx("span", { style: { display: 'inline', ...parseInlineStyles(currentStyles.join('; ')) }, children: plainText }, `styled-${lastIndex}`));
                }
                else {
                    parts.push(plainText);
                }
            }
            // Update styles
            const codes = codeStr.split(';');
            for (const code of codes) {
                if (code === '0') {
                    currentStyles = [];
                    continue;
                }
                const style = ANSI_STYLE_MAP[code];
                if (style) {
                    // Replace style of the same type
                    const type = style.split(':')[0];
                    currentStyles = currentStyles.filter(s => !s.startsWith(type));
                    currentStyles.push(style);
                }
            }
            lastIndex = index + fullMatch.length;
        }
        // Add any trailing text
        if (lastIndex < text.length) {
            const trailingText = text.slice(lastIndex);
            if (currentStyles.length > 0) {
                parts.push(_jsx("span", { style: { display: 'inline', ...parseInlineStyles(currentStyles.join('; ')) }, children: trailingText }, `styled-${lastIndex}`));
            }
            else {
                parts.push(trailingText);
            }
        }
        return parts.length > 0 ? _jsx(_Fragment, { children: parts }) : text;
    }
    function parseInlineStyles(styleString) {
        const styles = {};
        const declarations = styleString.split(';');
        for (const declaration of declarations) {
            const [property, value] = declaration.split(':').map(s => s.trim());
            if (property && value) {
                // Convert CSS property names to camelCase for React
                const camelProperty = property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
                styles[camelProperty] = value;
            }
        }
        return styles;
    }
    function rowMatchesQuery(log, tokens) {
        return tokens.every(token => {
            const [prefix, ...rest] = token.split(':');
            const term = rest.join(':').toLowerCase();
            if (prefix === 'source') {
                return log.source.toLowerCase().includes(term);
            }
            else if (prefix === 'severity') {
                return log.severity.toLowerCase().includes(term);
            }
            else if (prefix === 'message') {
                return log.message.toLowerCase().includes(term);
            }
            else {
                // general match
                return (log.source.toLowerCase().includes(token.toLowerCase()) ||
                    log.severity.toLowerCase().includes(token.toLowerCase()) ||
                    log.message.toLowerCase().includes(token.toLowerCase()));
            }
        });
    }
    const handleRowClick = (index) => {
        if (selectedLogIndex === index) {
            // Deselect if clicking the same row
            setSelectedLogIndex(null);
            window.history.replaceState(null, '', '#');
        }
        else {
            setSelectedLogIndex(index);
            window.history.replaceState(null, '', `#log-${index}`);
        }
    };
    const handleAttachmentClick = async (e, url) => {
        e.stopPropagation();
        // Don't handle modal for Ctrl/Cmd+click (let it open in new tab)
        if (e.ctrlKey || e.metaKey) {
            return;
        }
        e.preventDefault();
        try {
            if (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.gif')) {
                // Image attachment
                setModalContent({ type: 'image', content: url, url });
            }
            else if (url.endsWith('.txt') || url.endsWith('.log') || url.endsWith('.json')) {
                // Text attachment
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
                }
                const text = await response.text();
                setModalContent({ type: 'text', content: text, url });
            }
            else {
                // For other file types, just open in new tab
                window.open(url, '_blank');
            }
        }
        catch (error) {
            console.error('Error opening attachment:', error);
            const errorText = error instanceof Error ? error.message : 'Failed to open attachment';
            setModalContent({ type: 'text', content: `Error opening attachment: ${errorText}`, url });
        }
    };
    const closeModal = () => {
        setModalContent(null);
    };
    const handleToggleAdvancedSearch = () => {
        setIsAdvancedSearch(!isAdvancedSearch);
        // Reset search when switching modes
        if (!isAdvancedSearch) {
            setSearchFilter('');
        }
        else {
            setAdvancedQuery(defaultQuery);
        }
    };
    const handleAdvancedQueryChange = (query) => {
        setAdvancedQuery(query);
    };
    // Define columns for the sortable table
    const columns = useMemo(() => [
        {
            id: 'timestamp',
            header: 'Timestamp',
            accessorFn: (row) => row.relative,
            enableSorting: true,
            cell: ({ row }) => (_jsx("span", { title: row.original.timestamp, children: row.original.relative })),
            sortingFn: (rowA, rowB) => {
                // Sort by actual timestamp, not relative time
                const timestampA = new Date(rowA.original.timestamp).getTime();
                const timestampB = new Date(rowB.original.timestamp).getTime();
                return timestampA - timestampB;
            },
        },
        {
            id: 'severity',
            header: 'Severity',
            accessorKey: 'severity',
            enableSorting: true,
            cell: ({ getValue }) => {
                const severity = getValue();
                return (_jsx("span", { className: `severity-${severity.toLowerCase()}`, children: severity }));
            },
        },
        {
            id: 'source',
            header: 'Source',
            accessorKey: 'source',
            enableSorting: true,
        },
        {
            id: 'message',
            header: 'Message',
            accessorKey: 'message',
            enableSorting: true,
            cell: ({ row }) => (_jsxs("div", { children: [_jsx("span", { className: "log-message", children: parseAnsiColors(row.original.message) }), row.original.attachment && (_jsxs("span", { className: "attachment-link", children: [' ', _jsxs("a", { href: row.original.attachment, target: "_blank", rel: "noopener noreferrer", onClick: (e) => handleAttachmentClick(e, row.original.attachment), className: "attachment-link-item", children: ["\uD83D\uDCCE ", row.original.attachment.split('/').pop()] })] }))] })),
        },
        {
            id: 'screenshot',
            header: 'Screenshot',
            accessorKey: 'screenshot',
            enableSorting: false,
            cell: ({ row }) => (row.original.screenshot ? (_jsx("img", { src: row.original.screenshot, alt: "Screenshot", className: "screenshot-thumbnail", onClick: (e) => handleAttachmentClick(e, row.original.screenshot), title: "Click to view full size" })) : null),
        },
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
        enableSorting: true,
    });
    if (loading) {
        return (_jsxs("div", { className: "run-overview", children: [_jsxs("div", { className: "run-overview-header", children: [_jsxs("div", { className: "header-left-section", children: [_jsx("button", { className: "back-button dark-grey", onClick: onBack, title: "Back to run details", children: "\u2190 Run Details" }), _jsxs("div", { className: "header-title-section", children: [_jsx("h3", { children: "Test Logs" }), _jsxs("div", { className: "breadcrumb", children: [_jsxs("span", { className: "run-info", children: ["Run ", runId] }), runDate && (_jsxs("span", { className: "run-date", children: [" \u2022 ", runDate.toLocaleDateString()] }))] })] })] }), _jsx("div", { className: "header-right-section", children: _jsx("button", { onClick: () => window.open(githubUrl, '_blank'), className: "github-button", children: "GitHub Run" }) })] }), _jsx("div", { className: "run-overview-content", children: _jsx("div", { className: "loading-message", children: "Loading test logs..." }) })] }));
    }
    if (error) {
        return (_jsxs("div", { className: "run-overview", children: [_jsxs("div", { className: "run-overview-header", children: [_jsxs("div", { className: "header-left-section", children: [_jsx("button", { className: "back-button dark-grey", onClick: onBack, title: "Back to run details", children: "\u2190 Run Details" }), _jsxs("div", { className: "header-title-section", children: [_jsx("h3", { children: "Test Logs" }), _jsxs("div", { className: "breadcrumb", children: [_jsxs("span", { className: "run-info", children: ["Run ", runId] }), runDate && (_jsxs("span", { className: "run-date", children: [" \u2022 ", runDate.toLocaleDateString()] }))] })] })] }), _jsx("div", { className: "header-right-section", children: _jsx("button", { onClick: () => window.open(githubUrl, '_blank'), className: "github-button", children: "GitHub Run" }) })] }), _jsx("div", { className: "run-overview-content", children: _jsxs("div", { className: "error-message", children: ["Error: ", error] }) })] }));
    }
    return (_jsxs("div", { className: "run-overview test-log-viewer", children: [_jsxs("div", { className: "run-overview-header", children: [_jsxs("div", { className: "header-left-section", children: [_jsx("button", { className: "back-button dark-grey", onClick: onBack, title: "Back to run details", children: "\u2190 Run Details" }), _jsx("div", { className: "header-title-section", children: _jsxs("div", { className: "breadcrumb", children: [_jsxs("span", { className: "test-info", children: [architecture, "/", displayTestName] }), runDate && (_jsxs("span", { className: "run-date", children: [" \u2022 ", runDate.toLocaleDateString()] }))] }) })] }), _jsx("div", { className: "header-right-section", children: _jsx("button", { onClick: () => window.open(githubUrl, '_blank'), className: "github-button", children: "GitHub Run" }) })] }), _jsxs("div", { className: "run-overview-content", children: [_jsx("div", { className: "search-section", children: isAdvancedSearch ? (_jsx(AdvancedSearch, { query: advancedQuery, onQueryChange: handleAdvancedQueryChange, onToggleAdvanced: handleToggleAdvancedSearch })) : (_jsx("div", { className: "simple-search-container", children: _jsxs("div", { className: "search-header", children: [_jsx("input", { type: "text", className: "search-input", placeholder: "Search logs...", value: searchFilter, onChange: (e) => setSearchFilter(e.target.value) }), _jsx("button", { type: "button", className: "toggle-search-button", onClick: handleToggleAdvancedSearch, title: "Switch to advanced search", children: "Advanced Search" }), _jsxs("div", { className: "search-tips", children: ["Simple Search Tips: Use ", _jsx("code", { children: "severity:ERROR" }), ", or ", _jsx("code", { children: "message:failed" }), " for targeted searches"] })] }) })) }), filteredLogs.length === 0 && !loading ? (_jsx("div", { className: "no-logs-message", children: (isAdvancedSearch || searchFilter) ? 'No logs match the current search criteria.' : 'No logs found for this test.' })) : (_jsx("div", { className: "table-container", children: _jsxs("table", { className: "advanced-run-table log-table", children: [_jsxs("colgroup", { children: [_jsx("col", { className: "timestamp-col" }), _jsx("col", { className: "severity-col" }), _jsx("col", { className: "source-col" }), _jsx("col", { className: "message-col" }), _jsx("col", { className: "screenshot-col" })] }), _jsx("thead", { children: table.getHeaderGroups().map((headerGroup) => (_jsx("tr", { children: headerGroup.headers.map((header) => (_jsx("th", { className: `${header.id}-header ${header.column.getCanSort() ? 'sortable' : ''}`, onClick: header.column.getToggleSortingHandler(), children: _jsxs("div", { className: "header-content", children: [header.isPlaceholder
                                                        ? null
                                                        : flexRender(header.column.columnDef.header, header.getContext()), header.column.getCanSort() && (_jsx("span", { className: "sort-indicator", children: {
                                                            asc: '↑',
                                                            desc: '↓',
                                                        }[header.column.getIsSorted()] ?? '⇅' }))] }) }, header.id))) }, headerGroup.id))) }), _jsx("tbody", { children: table.getRowModel().rows.map((row, index) => (_jsx("tr", { className: `table-row log-row severity-${row.original.severity.toLowerCase()} ${selectedLogIndex === index ? 'selected' : ''}`, onClick: () => handleRowClick(index), id: `log-${index}`, children: row.getVisibleCells().map((cell) => (_jsx("td", { className: `${cell.column.id}-cell`, children: flexRender(cell.column.columnDef.cell, cell.getContext()) }, cell.id))) }, row.id))) })] }) }))] }), modalContent && (_jsx("div", { className: "modal-overlay", onClick: closeModal, children: _jsx("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), children: modalContent.type === 'image' ? (_jsx("img", { src: modalContent.content, alt: "Attachment", className: "modal-image", onClick: closeModal })) : (_jsx("pre", { className: "modal-text", children: modalContent.content })) }) }))] }));
}
