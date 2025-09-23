import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  ColumnDef,
  flexRender,
  SortingState,
} from '@tanstack/react-table';
import { AdvancedSearch, evaluateQuery, defaultQuery, type SearchGroup } from './AdvancedSearch';
import './styles.css';

interface LogEntry {
  timestamp: string;
  relative: string;
  severity: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  source: string;
  message: string;
  attachment?: string;
  screenshot?: string;
}

interface TestLogViewerProps {
  runId: string;
  runDate?: Date;
  testName: string;
  jobName: string;
  onBack: () => void;
  githubUrl: string;
}

export function TestLogViewer({
  runId,
  runDate,
  testName,
  jobName,
  onBack,
  githubUrl
}: TestLogViewerProps): React.JSX.Element {
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [selectedLogIndex, setSelectedLogIndex] = useState<number | null>(null);
  const [modalContent, setModalContent] = useState<{ type: 'image' | 'text'; content: string; url: string } | null>(null);
  const [isAdvancedSearch, setIsAdvancedSearch] = useState<boolean>(false);
  const [advancedQuery, setAdvancedQuery] = useState<SearchGroup>(defaultQuery);
  const [sorting, setSorting] = useState<SortingState>([]);

  // Format test name for display (remove path prefixes and convert __ to ::)
  const convertTestName = (name: string): string => {
    return name.replace(/__/g, "::");
  };
  
  const displayTestName = convertTestName(testName.split('/').pop() || testName);
  
  // Extract architecture from job name (e.g., "aarch64-windows-vmm-tests-logs" -> "aarch64")
  const getArchitecture = (jobName: string): string => {
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
        const processedLogs: LogEntry[] = [];
        let startTime: string | null = null;
        
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
          
          const relative = formatRelative(startTime!, line.timestamp);
          
          // Clean up message (remove timestamp prefix if present)
          let message = line.message || '';
          message = removeTimestamp(message, new Date(line.timestamp));
          
          // Extract severity from message if present
          const { message: cleanMessage, severity } = extractSeverity(message, line.severity || 'INFO');
          
          // Convert attachment URL to absolute if it exists and is not a PNG
          let attachmentUrl: string | undefined;
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
        
      } catch (err) {
        console.error('Error loading test logs:', err);
        setError(err instanceof Error ? err.message : 'Failed to load test logs');
      } finally {
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
    } else {
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
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isF = e.key === 'f' || e.key === 'F';
      const isFind = (isMac && e.metaKey && isF) || (!isMac && e.ctrlKey && isF);

      // Focus search input on Ctrl/Cmd+F
      if (isFind) {
        e.preventDefault();
        const searchInput = document.querySelector('.search-input') as HTMLInputElement;
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
        } else if (isAdvancedSearch) {
          setAdvancedQuery(defaultQuery);
        } else if (searchFilter) {
          setSearchFilter('');
        } else if (selectedLogIndex !== null) {
          setSelectedLogIndex(null);
        }
      }
    };

    const handleCopy = (e: ClipboardEvent) => {
      if (selectedLogIndex !== null && filteredLogs[selectedLogIndex]) {
        const selection = window.getSelection();
        if (selection && selection.toString().trim()) return; // User selected text, let it be

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
  function formatRelative(from: string, to: string): string {
    const deltaMs = new Date(to).getTime() - new Date(from).getTime();
    const sec = ((deltaMs / 1000) % 60).toFixed(3);
    const min = Math.floor((deltaMs / 60000) % 60);
    const hr = Math.floor(deltaMs / 3600000);

    return `${hr > 0 ? hr + 'h ' : ''}${min}m ${sec}s`;
  }

  function removeTimestamp(orig: string, entryTimestamp: Date): string {
    const message = orig.trim();
    const i = message.indexOf(' ');
    if (i === -1) return orig;
    
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
    if (isNaN(parsedTs.getTime())) return orig;
    
    parsedTs.setMilliseconds(0);
    const truncatedTs = new Date(entryTimestamp.getTime());
    truncatedTs.setMilliseconds(0);
    
    if (parsedTs.getTime() !== truncatedTs.getTime()) return orig;
    
    return message.slice(i + 1);
  }

  function extractSeverity(orig: string, defaultSeverity: string): { message: string; severity: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' } {
    const severityLevels = ['ERROR', 'WARN', 'INFO', 'DEBUG'] as const;
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
      severity: (severityLevels.includes(defaultSeverity as any) ? defaultSeverity : 'INFO') as any
    };
  }

  function tokenizeSearchQuery(query: string): string[] {
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
  }

  // ANSI color parsing function inspired by test.html
  function parseAnsiColors(text: string): React.ReactNode {
    const ANSI_STYLE_MAP: Record<string, string> = {
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
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let currentStyles: string[] = [];

    const matches = Array.from(text.matchAll(ESC_REGEX));
    
    for (const match of matches) {
      const [fullMatch, codeStr] = match;
      const index = match.index!;

      // Add plain text before this escape sequence
      if (index > lastIndex) {
        const plainText = text.slice(lastIndex, index);
        if (currentStyles.length > 0) {
          parts.push(
            <span key={`styled-${lastIndex}`} style={{ display: 'inline', ...parseInlineStyles(currentStyles.join('; ')) }}>
              {plainText}
            </span>
          );
        } else {
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
        parts.push(
          <span key={`styled-${lastIndex}`} style={{ display: 'inline', ...parseInlineStyles(currentStyles.join('; ')) }}>
            {trailingText}
          </span>
        );
      } else {
        parts.push(trailingText);
      }
    }

    return parts.length > 0 ? <>{parts}</> : text;
  }

  function parseInlineStyles(styleString: string): React.CSSProperties {
    const styles: React.CSSProperties = {};
    const declarations = styleString.split(';');
    
    for (const declaration of declarations) {
      const [property, value] = declaration.split(':').map(s => s.trim());
      if (property && value) {
        // Convert CSS property names to camelCase for React
        const camelProperty = property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        (styles as any)[camelProperty] = value;
      }
    }
    
    return styles;
  }

  function rowMatchesQuery(log: LogEntry, tokens: string[]): boolean {
    return tokens.every(token => {
      const [prefix, ...rest] = token.split(':');
      const term = rest.join(':').toLowerCase();

      if (prefix === 'source') {
        return log.source.toLowerCase().includes(term);
      } else if (prefix === 'severity') {
        return log.severity.toLowerCase().includes(term);
      } else if (prefix === 'message') {
        return log.message.toLowerCase().includes(term);
      } else {
        // general match
        return (
          log.source.toLowerCase().includes(token.toLowerCase()) ||
          log.severity.toLowerCase().includes(token.toLowerCase()) ||
          log.message.toLowerCase().includes(token.toLowerCase())
        );
      }
    });
  }

  const handleRowClick = (index: number) => {
    if (selectedLogIndex === index) {
      // Deselect if clicking the same row
      setSelectedLogIndex(null);
      window.history.replaceState(null, '', '#');
    } else {
      setSelectedLogIndex(index);
      window.history.replaceState(null, '', `#log-${index}`);
    }
  };

  const handleAttachmentClick = async (e: React.MouseEvent, url: string) => {
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
      } else if (url.endsWith('.txt') || url.endsWith('.log') || url.endsWith('.json')) {
        // Text attachment
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }
        const text = await response.text();
        setModalContent({ type: 'text', content: text, url });
      } else {
        // For other file types, just open in new tab
        window.open(url, '_blank');
      }
    } catch (error) {
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
    } else {
      setAdvancedQuery(defaultQuery);
    }
  };

  const handleAdvancedQueryChange = (query: SearchGroup) => {
    setAdvancedQuery(query);
  };

  // Define columns for the sortable table
  const columns = useMemo<ColumnDef<LogEntry>[]>(() => [
    {
      id: 'timestamp',
      header: 'Timestamp',
      accessorFn: (row) => row.relative,
      enableSorting: true,
      cell: ({ row }) => (
        <span title={row.original.timestamp}>
          {row.original.relative}
        </span>
      ),
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
        const severity = getValue() as string;
        return (
          <span className={`severity-${severity.toLowerCase()}`}>
            {severity}
          </span>
        );
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
      cell: ({ row }) => (
        <div>
          <span className="log-message">{parseAnsiColors(row.original.message)}</span>
          {row.original.attachment && (
            <span className="attachment-link">
              {' '}
              <a 
                href={row.original.attachment} 
                target="_blank" 
                rel="noopener noreferrer"
                onClick={(e) => handleAttachmentClick(e, row.original.attachment!)}
                className="attachment-link-item"
              >
                📎 {row.original.attachment.split('/').pop()}
              </a>
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'screenshot',
      header: 'Screenshot',
      accessorKey: 'screenshot',
      enableSorting: false,
      cell: ({ row }) => (
        row.original.screenshot ? (
          <img 
            src={row.original.screenshot}
            alt="Screenshot"
            className="screenshot-thumbnail"
            onClick={(e) => handleAttachmentClick(e, row.original.screenshot!)}
            title="Click to view full size"
          />
        ) : null
      ),
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
    return (
      <div className="run-overview">
        <div className="run-overview-header">
          <div className="header-left-section">
            <button 
              className="back-button dark-grey"
              onClick={onBack}
              title="Back to run details"
            >
              ← Run Details
            </button>
            <div className="header-title-section">
              <h3>Test Logs</h3>
              <div className="breadcrumb">
                <span className="run-info">Run {runId}</span>
                {runDate && (
                  <span className="run-date"> • {runDate.toLocaleDateString()}</span>
                )}
              </div>
            </div>
          </div>
          <div className="header-right-section">
            <button
              onClick={() => window.open(githubUrl, '_blank')}
              className="github-button"
            >
              GitHub Run
            </button>
          </div>
        </div>
        <div className="run-overview-content">
          <div className="loading-message">Loading test logs...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="run-overview">
        <div className="run-overview-header">
          <div className="header-left-section">
            <button 
              className="back-button dark-grey"
              onClick={onBack}
              title="Back to run details"
            >
              ← Run Details
            </button>
            <div className="header-title-section">
              <h3>Test Logs</h3>
              <div className="breadcrumb">
                <span className="run-info">Run {runId}</span>
                {runDate && (
                  <span className="run-date"> • {runDate.toLocaleDateString()}</span>
                )}
              </div>
            </div>
          </div>
          <div className="header-right-section">
            <button
              onClick={() => window.open(githubUrl, '_blank')}
              className="github-button"
            >
              GitHub Run
            </button>
          </div>
        </div>
        <div className="run-overview-content">
          <div className="error-message">Error: {error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="run-overview test-log-viewer">
      <div className="run-overview-header">
        <div className="header-left-section">
          <button 
            className="back-button dark-grey"
            onClick={onBack}
            title="Back to run details"
          >
            ← Run Details
          </button>
          <div className="header-title-section">
            <div className="breadcrumb">
              <span className="test-info">{architecture}/{displayTestName}</span>
              {runDate && (
                <span className="run-date"> • {runDate.toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </div>
        <div className="header-right-section">
          <button
            onClick={() => window.open(githubUrl, '_blank')}
            className="github-button"
          >
            GitHub Run
          </button>
        </div>
      </div>

      <div className="run-overview-content">
        {/* Search Interface */}
        <div className="search-section">
          {isAdvancedSearch ? (
            <AdvancedSearch
              query={advancedQuery}
              onQueryChange={handleAdvancedQueryChange}
              onToggleAdvanced={handleToggleAdvancedSearch}
            />
          ) : (
            <div className="simple-search-container">
              <div className="search-header">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search logs..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
                <button
                  type="button"
                  className="toggle-search-button"
                  onClick={handleToggleAdvancedSearch}
                  title="Switch to advanced search"
                >
                  Advanced Search
                </button>
                <div className="search-tips">
                    Simple Search Tips: Use <code>severity:ERROR</code>, or <code>message:failed</code> for targeted searches
                </div>
              </div>
            </div>
          )}
        </div>

        {filteredLogs.length === 0 && !loading ? (
          <div className="no-logs-message">
            {(isAdvancedSearch || searchFilter) ? 'No logs match the current search criteria.' : 'No logs found for this test.'}
          </div>
        ) : (
          <div className="table-container">
            <table className="advanced-run-table log-table">
              <colgroup>
                <col className="timestamp-col" />
                <col className="severity-col" />
                <col className="source-col" />
                <col className="message-col" />
                <col className="screenshot-col" />
              </colgroup>
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className={`${header.id}-header ${header.column.getCanSort() ? 'sortable' : ''}`}
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
                {table.getRowModel().rows.map((row, index) => (
                  <tr 
                    key={row.id}
                    className={`table-row log-row severity-${row.original.severity.toLowerCase()} ${selectedLogIndex === index ? 'selected' : ''}`}
                    onClick={() => handleRowClick(index)}
                    id={`log-${index}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={`${cell.column.id}-cell`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for viewing attachments */}
      {modalContent && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            {modalContent.type === 'image' ? (
              <img 
                src={modalContent.content} 
                alt="Attachment" 
                className="modal-image"
                onClick={closeModal}
              />
            ) : (
              <pre className="modal-text">
                {modalContent.content}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}