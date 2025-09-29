import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { flexRender, type Table, type Row } from '@tanstack/react-table';
import { RunData } from './fetch';

export interface VirtualizedTableProps<TData extends object> {
    table: Table<TData>;
    columnWidthMap?: Record<string, number>;
    estimatedRowHeight?: number; // default 50
    overscan?: number; // default 10
    /** Derive a className for a given row (virtual wrapper div). */
    getRowClassName?: (row: Row<TData>) => string;
}

function defaultInferRowClass(row: Row<any>): string {
    const failed = row?.original?.metadata?.petriFailed;
    if (typeof failed === 'number') {
        return failed > 0 ? 'failed-row' : 'passed-row';
    }
    return 'passed-row';
}

export function VirtualizedTable<TData extends object>({
    table,
    columnWidthMap,
    estimatedRowHeight = 80,
    overscan = 10,
    getRowClassName,
}: VirtualizedTableProps<TData>): React.JSX.Element {
    const { rows } = table.getRowModel();

    const tableContainerRef = useRef<HTMLDivElement>(null);
    const headerWrapperRef = useRef<HTMLDivElement>(null);
    const [headerHeight, setHeaderHeight] = useState(0);

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

    // Extracted effect hooks for clarity (see implementations below)
    useHideScrollbarStyle();

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => tableContainerRef.current,
        estimateSize: () => estimatedRowHeight,
        overscan,
        measureElement:
            typeof window !== 'undefined' &&
                navigator.userAgent.indexOf('Firefox') === -1
                ? element => element?.getBoundingClientRect().height
                : undefined,
    });

    useIntertwinedInnerWheel(tableContainerRef);

    useIntertwinedOuterWheel(tableContainerRef);

    return (
        <div className="common-table" style={{ position: 'relative' }}>
            <div
                ref={headerWrapperRef}
                style={{
                    position: 'sticky',
                    top: '4rem',
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
                                    const defaultWidthMap: Record<string, number> = {
                                        name: 100,
                                        creationTime: 170,
                                        status: 60,
                                        failed: 60,
                                        total: 60,
                                        ghRun: 100,
                                    };
                                    const effectiveWidthMap = columnWidthMap ?? defaultWidthMap;
                                    const w = effectiveWidthMap[header.column.id];
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
                                                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
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
                        overflow: 'auto',
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
                            const row = rows[virtualRow.index] as Row<TData>;
                            return (
                                <div
                                    key={row.id}
                                    data-index={virtualRow.index}
                                    ref={rowVirtualizer.measureElement}
                                    className={`virtualized-table-row ${getRowClassName ? getRowClassName(row) : defaultInferRowClass(row)}`}
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
                                                    const defaultWidthMap: Record<string, number> = {
                                                        name: 100,
                                                        creationTime: 170,
                                                        status: 60,
                                                        failed: 60,
                                                        total: 60,
                                                        ghRun: 100,
                                                    };
                                                    const effectiveWidthMap = columnWidthMap ?? defaultWidthMap;
                                                    const w = effectiveWidthMap[cell.column.id];
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
    );
}

// Backwards-compatible specialized export for existing RunData usage
export type RunsTableInstance = Table<RunData>;
export interface VirtualizedRunsTableProps extends VirtualizedTableProps<RunData> { }
export function VirtualizedRunsTable(props: VirtualizedRunsTableProps) {
    return <VirtualizedTable<RunData> {...props} />;
}

export default VirtualizedRunsTable;

// ===================== Extracted Effect Helpers =====================

/**
 * Injects a one-time style block to hide scrollbars in the virtualized body across browsers.
 * Caveats:
 *  - Runs only in a browser environment.
 *  - Idempotent: skips if the style tag already exists (prevents duplicate nodes on hot reload).
 */
function useHideScrollbarStyle() {
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const styleId = 'virtualized-table-hide-scrollbar';
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
      .virtualized-table-body { scrollbar-width: none; -ms-overflow-style: none; }
      .virtualized-table-body::-webkit-scrollbar { width: 0; height: 0; }
    `;
        document.head.appendChild(style);
    }, []);
}

/**
 * Provides the inner (table container) wheel interception to enforce intertwined scroll behavior:
 *  - Scroll down: consume window scroll first, then overflow into inner container.
 *  - Scroll up: consume inner container first, then bubble to window.
 * Caveats:
 *  - Uses non-passive wheel listener to allow preventDefault (required for manual distribution of deltaY).
 *  - Assumes a stable ref; no dependencies so it runs only once.
 */
function useIntertwinedInnerWheel(containerRef: React.RefObject<HTMLDivElement | null>) {
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const onWheel = (e: WheelEvent) => {
            if (e.deltaY === 0) return;
            const deltaY = e.deltaY;
            const docEl = document.documentElement;
            const maxWindowScroll = docEl.scrollHeight - window.innerHeight;
            const windowScrollY = window.scrollY;
            if (deltaY > 0) {
                const remainingWindowScroll = maxWindowScroll - windowScrollY;
                if (remainingWindowScroll > 0) {
                    e.preventDefault();
                    const applyToWindow = Math.min(deltaY, remainingWindowScroll);
                    if (applyToWindow !== 0) window.scrollTo({ top: windowScrollY + applyToWindow, behavior: 'auto' });
                    const leftover = deltaY - applyToWindow;
                    if (leftover > 0) container.scrollTop += leftover;
                } else if (container.scrollTop < container.scrollHeight - container.clientHeight) {
                    e.preventDefault();
                    container.scrollTop += deltaY;
                }
            } else {
                const containerScrollTop = container.scrollTop;
                if (containerScrollTop > 0) {
                    e.preventDefault();
                    const possibleUp = containerScrollTop;
                    const desiredUp = -deltaY;
                    const applyToInner = Math.min(possibleUp, desiredUp);
                    if (applyToInner !== 0) container.scrollTop -= applyToInner;
                    const leftover = desiredUp - applyToInner;
                    if (leftover > 0) {
                        const windowUpCapacity = windowScrollY;
                        const applyToWindow = Math.min(windowUpCapacity, leftover);
                        if (applyToWindow !== 0) window.scrollTo({ top: windowScrollY - applyToWindow, behavior: 'auto' });
                    }
                } else if (windowScrollY > 0) {
                    e.preventDefault();
                    const applyToWindow = Math.min(windowScrollY, -deltaY);
                    if (applyToWindow !== 0) window.scrollTo({ top: windowScrollY - applyToWindow, behavior: 'auto' });
                }
            }
        };
        container.addEventListener('wheel', onWheel, { passive: false });
        return () => container.removeEventListener('wheel', onWheel);
    }, []);
}

/**
 * Global wheel listener that complements the inner listener so the intertwined behavior also
 * applies when the wheel event originates outside the table container.
 * Caveats:
 *  - Also non-passive to allow preventDefault.
 *  - Does not handle horizontal scrolling; deltaY only.
 *  - Must be removed on unmount to avoid leaks.
 */
function useIntertwinedOuterWheel(containerRef: React.RefObject<HTMLDivElement | null>) {
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const onWindowWheel = (e: WheelEvent) => {
            if (e.defaultPrevented || e.deltaY === 0) return;
            if (container.contains(e.target as Node)) return; // inner listener already handling
            const deltaY = e.deltaY;
            const docEl = document.documentElement;
            const maxWindowScroll = docEl.scrollHeight - window.innerHeight;
            const windowScrollY = window.scrollY;
            if (deltaY > 0) {
                const remainingWindowScroll = maxWindowScroll - windowScrollY;
                if (remainingWindowScroll > 0) {
                    if (deltaY <= remainingWindowScroll) return; // let native window scrolling consume
                    e.preventDefault();
                    window.scrollTo({ top: windowScrollY + remainingWindowScroll, behavior: 'auto' });
                    const leftover = deltaY - remainingWindowScroll;
                    const innerRemaining = container.scrollHeight - container.clientHeight - container.scrollTop;
                    if (innerRemaining > 0) container.scrollTop = container.scrollTop + Math.min(leftover, innerRemaining);
                } else {
                    const innerRemaining = container.scrollHeight - container.clientHeight - container.scrollTop;
                    if (innerRemaining > 0) {
                        e.preventDefault();
                        container.scrollTop = container.scrollTop + Math.min(deltaY, innerRemaining);
                    }
                }
            } else {
                const desiredUp = -deltaY;
                const containerScrollTop = container.scrollTop;
                if (containerScrollTop > 0) {
                    if (desiredUp <= containerScrollTop) {
                        e.preventDefault();
                        container.scrollTop = containerScrollTop - desiredUp;
                        return;
                    } else {
                        e.preventDefault();
                        container.scrollTop = 0;
                        const leftover = desiredUp - containerScrollTop;
                        const applyToWindow = Math.min(windowScrollY, leftover);
                        if (applyToWindow > 0) window.scrollTo({ top: windowScrollY - applyToWindow, behavior: 'auto' });
                        return;
                    }
                }
            }
        };
        window.addEventListener('wheel', onWindowWheel, { passive: false });
        return () => window.removeEventListener('wheel', onWindowWheel);
    }, []);
}
