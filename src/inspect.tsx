import React, { useEffect, useRef, useState } from 'react';

/**
 * Port of old inspect.html functionality into a React overlay component.
 * Follows the original implementation closely, using direct DOM manipulation
 * for expand/collapse to maintain performance.
 */

// ---------------- Parsing Logic (unchanged structure) ----------------

type InspectPrimitive =
    | { type: 'string'; value: string }
    | { type: 'bytes'; value: string }
    | { type: 'unevaluated' }
    | { type: 'boolean'; value: boolean }
    | { type: 'error'; value: string }
    | { type: 'number'; value: string };

interface InspectObject { type: 'object'; children: { key: string; value: InspectNode }[] }
type InspectNode = InspectPrimitive | InspectObject;

function parseInspectNode(input: string): InspectObject {
    let i = 0;

    function skipWhitespace() { while (/\s/.test(input[i])) i++; }

    function parseKey(): string {
        skipWhitespace();
        const match = /^(.+?):\s/.exec(input.slice(i));
        if (!match) throw new Error(`Invalid key at position ${i}: '${input.slice(i, i + 10)}'`);
        i += match[0].length; return match[1];
    }

    function parseString(): string {
        i++; let str = '';
        while (i < input.length && input[i] !== '"') { if (input[i] === '\\') str += input[i++]; str += input[i++]; }
        if (input[i] !== '"') throw new Error('Unterminated string');
        i++; return str;
    }

    function parseValue(): InspectNode {
        skipWhitespace();
        if (input[i] === '{') return parseObject();
        if (input[i] === '"') return { type: 'string', value: parseString() };
        if (input[i] === '<') { const start = i; while (i < input.length && input[i] !== '>') i++; i++; return { type: 'bytes', value: input.slice(start, i) }; }
        if (input[i] === '_') { i++; return { type: 'unevaluated' }; }
        if (input[i] === 't') { if (input.slice(i, i + 4) !== 'true') throw new Error(`Expected 'true' at ${i}`); i += 4; return { type: 'boolean', value: true }; }
        if (input[i] === 'f') { if (input.slice(i, i + 5) !== 'false') throw new Error(`Expected 'false' at ${i}`); i += 5; return { type: 'boolean', value: false }; }
        if (input[i] === 'e') {
            if (input.slice(i, i + 7) !== 'error (') throw new Error(`Expected 'error (' at ${i}`);
            i += 7; let parens = 1; const start = i;
            while (i < input.length && parens > 0) { if (input[i] === '(') parens++; else if (input[i] === ')') parens--; i++; }
            if (input[i - 1] !== ')') throw new Error('Unterminated error');
            return { type: 'error', value: input.slice(start, i - 1) };
        }
        const match = /^[+-]?((0x[0-9a-fA-F]+)|(0b[01]+)|([0-9]+(\.[0-9]*)?))/.exec(input.slice(i));
        if (match) { i += match[0].length; return { type: 'number', value: match[0] }; }
        throw new Error(`Unexpected token at ${i}: '${input.slice(i, i + 10)}'`);
    }

    function parseObject(): InspectObject {
        if (input[i] !== '{') throw new Error(`Expected '{' at ${i}`);
        i++; skipWhitespace(); const children: { key: string; value: InspectNode }[] = [];
        while (i < input.length && input[i] !== '}') {
            const key = parseKey(); skipWhitespace(); const value = parseValue(); children.push({ key, value }); skipWhitespace();
            if (input[i] === ',') { i++; skipWhitespace(); }
            else if (input[i] !== '}') throw new Error(`Expected ',' or '}' at ${i}`);
        }
        if (input[i] !== '}') throw new Error(`Unterminated object at ${i}`); i++; return { type: 'object', children };
    }

    skipWhitespace(); const result = parseObject(); skipWhitespace(); if (i < input.length) throw new Error(`Trailing content at ${i}`); return result;
}

// ---------------- Formatting / Utilities ----------------

function formatValue(v: InspectPrimitive): string {
    switch (v.type) {
        case 'string':
        case 'boolean':
        case 'number':
        case 'bytes': return String(v.value);
        case 'unevaluated': return '⏳';
        case 'error': return `❌ ${v.value}`;
    }
}

function node(tag: string, attrs: Record<string, any>, ...children: (string | Node)[]): HTMLElement {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') el.className = v;
        else if (k === 'style') Object.assign(el.style, v);
        else el.setAttribute(k, v);
    }
    for (const child of children) {
        if (typeof child === 'string') el.appendChild(document.createTextNode(child));
        else el.appendChild(child);
    }
    return el;
}

function highlightMatch(str: string, filter: string): HTMLElement | string {
    if (!filter) return str;
    const lowerStr = str.toLowerCase();
    const lowerFilter = filter.toLowerCase();
    const index = lowerStr.indexOf(lowerFilter);
    if (index === -1) return str;
    return node('span', {},
        str.slice(0, index),
        node('span', { class: 'highlight' }, str.slice(index, index + filter.length)),
        str.slice(index + filter.length)
    );
}

interface InspectOverlayProps {
    fileUrl: string;           // Absolute URL (already resolved)
    onClose: () => void;       // Close callback
}

export const InspectOverlay: React.FC<InspectOverlayProps> = ({ fileUrl, onClose }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [allExpanded, setAllExpanded] = useState(true);
    const filterInputRef = useRef<HTMLInputElement>(null);
    const contentsRef = useRef<HTMLDivElement>(null);
    const selectedPathRef = useRef<string>('');
    const rootRef = useRef<InspectObject | null>(null);
    const allToggleButtonsRef = useRef<HTMLElement[]>([]);

    const fileName = (() => {
        try { const u = new URL(fileUrl); return u.pathname.split('/').filter(Boolean).slice(-1)[0] || fileUrl; } catch { return fileUrl; }
    })();

    // Fetch and parse the inspect file
    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        (async () => {
            try {
                const resp = await fetch(fileUrl);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const text = await resp.text();
                const parsed = parseInspectNode(text);
                if (!cancelled) {
                    rootRef.current = parsed;
                    setLoading(false);
                    // Hash-based selection removed - not needed in overlay
                }
            } catch (e: any) {
                if (!cancelled) { setError(e.message || String(e)); setLoading(false); }
            }
        })();
        return () => { cancelled = true; };
    }, [fileUrl]);

    // Render the tree using direct DOM manipulation (like original)
    useEffect(() => {
        if (!contentsRef.current || !rootRef.current || loading || error) return;

        allToggleButtonsRef.current = [];

        function renderInspectNode(nodeData: InspectNode, filterLower: string, path = '', alreadyMatched = false, depth = 0): HTMLElement | null {
            if (nodeData.type !== 'object') return null;

            const container = node('div', { class: 'tree-children' });

            for (const child of nodeData.children) {
                const key = child.key;
                const valNode = child.value;
                const keyMatch = key.toLowerCase().includes(filterLower);
                const valText = valNode.type === 'object' ? '' : formatValue(valNode);
                const valMatch = valText.toLowerCase().includes(filterLower);
                const indent = `${depth * 1.2}em`;
                const fullPath = path ? `${path}.${key}` : key;

                if (valNode.type === 'object') {
                    const subtree = renderInspectNode(valNode, filterLower, fullPath, keyMatch || alreadyMatched, depth + 1);
                    if (subtree) {
                        const toggle = node('span', { class: 'tree-expander', style: { cursor: 'pointer' } }, '[-]');
                        const header = node('div',
                            { class: 'tree-node', style: { marginLeft: indent }, 'data-path': fullPath },
                            toggle,
                            node('span', { class: 'tree-key' }, highlightMatch(key, filterLower))
                        );

                        let expanded = true;

                        // Store toggle control object
                        const toggleControl = {
                            toggle,
                            subtree: subtree as HTMLElement,
                            setExpanded: (val: boolean) => {
                                expanded = val;
                                toggle.textContent = expanded ? '[-]' : '[+]';
                                (subtree as HTMLElement).style.display = expanded ? '' : 'none';
                            }
                        };

                        allToggleButtonsRef.current.push(toggleControl as any);

                        toggle.addEventListener('click', (e) => {
                            e.stopPropagation(); // Prevent click from bubbling to parent tree-node
                            expanded = !expanded;
                            toggle.textContent = expanded ? '[-]' : '[+]';
                            (subtree as HTMLElement).style.display = expanded ? '' : 'none';

                            // Also select this row when toggling
                            if (contentsRef.current) {
                                if (selectedPathRef.current) {
                                    const prevSelected = contentsRef.current.querySelector(`.tree-node[data-path="${CSS.escape(selectedPathRef.current)}"]`);
                                    if (prevSelected) {
                                        prevSelected.classList.remove('selected');
                                    }
                                }
                                selectedPathRef.current = fullPath;
                                header.classList.add('selected');
                            }
                        });

                        container.append(header, subtree);
                    }
                } else if (!filterLower || keyMatch || valMatch || alreadyMatched) {
                    container.append(
                        node('div',
                            { class: 'tree-node', style: { marginLeft: indent }, 'data-path': fullPath },
                            node('span', { class: 'tree-key' }, highlightMatch(`${key}: `, filterLower)),
                            node('span', {}, highlightMatch(valText, filterLower))
                        )
                    );
                }
            }

            return container.children.length > 0 ? container : null;
        }

        function updateFilteredTree() {
            if (!contentsRef.current || !rootRef.current) return;
            const f = filter.trim().toLowerCase();
            const filtered = renderInspectNode(rootRef.current, f);
            contentsRef.current.replaceChildren(filtered || node('div', {}, 'No matches'));

            // Restore selection
            if (selectedPathRef.current) {
                const anchor = contentsRef.current.querySelector(`.tree-node[data-path="${CSS.escape(selectedPathRef.current)}"]`);
                if (anchor) {
                    anchor.classList.add('selected');
                    requestAnimationFrame(() => {
                        if (anchor) {
                            (anchor as HTMLElement).scrollIntoView({ block: 'center' });
                        }
                    });
                }
            }
        }

        updateFilteredTree();
    }, [loading, error, filter]);

    // Handle tree node clicks for selection
    useEffect(() => {
        if (!contentsRef.current) return;

        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const n = target.closest('.tree-node');
            if (n) {
                const path = n.getAttribute('data-path');
                if (path && contentsRef.current) {
                    if (selectedPathRef.current) {
                        const prevSelected = contentsRef.current.querySelector(`.tree-node[data-path="${CSS.escape(selectedPathRef.current)}"]`);
                        if (prevSelected) {
                            prevSelected.classList.remove('selected');
                        }
                    }
                    selectedPathRef.current = path;
                    n.classList.add('selected');
                    // Removed: window.location.hash = encodeURIComponent(path);
                }
            }
        };

        contentsRef.current.addEventListener('click', handleClick);
        return () => {
            contentsRef.current?.removeEventListener('click', handleClick);
        };
    }, [loading, error]);

    // Keyboard shortcuts: Ctrl/Cmd+F focus filter, Esc clears / blurs / closes
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().includes('MAC');
            const isFind = (e.key === 'f' || e.key === 'F') && ((isMac && e.metaKey) || (!isMac && e.ctrlKey));
            if (isFind) {
                e.preventDefault();
                filterInputRef.current?.focus();
                filterInputRef.current?.select();
                return;
            }
            if (e.key === 'Escape') {
                if (filter) { setFilter(''); return; }
                if (document.activeElement === filterInputRef.current) {
                    (document.activeElement as HTMLElement).blur();
                    return;
                }
                onClose();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [filter, onClose]);

    const handleToggleAll = () => {
        const newState = !allExpanded;
        setAllExpanded(newState);
        allToggleButtonsRef.current.forEach((toggleControl: any) => {
            toggleControl.setExpanded(newState);
        });
    };

    return (
        <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 10000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '2vh 2vw' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div style={{ background: 'white', color: 'black', fontFamily: 'monospace', fontSize: '14px', width: 'min(1100px, 100%)', maxHeight: '96vh', display: 'flex', flexDirection: 'column', borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.4)', position: 'relative' }}>
                <style>{`
          .inspect-filter-bar { position: sticky; top: 0; left:0; right:0; background: white; display:flex; align-items:center; justify-content: space-between; padding:8px 16px; border-bottom:1px solid #ccc; z-index:10; box-sizing:border-box; }
          .inspect-test-name { font-weight:bold; font-size:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:50%; }
          .inspect-search-wrapper { position:relative; display:inline-block; }
          .inspect-search-controls { display:flex; align-items:center; gap:8px; }
          .inspect-toggle-all { background:white; border:1px solid #ccc; border-radius:4px; padding:6px 10px; font-family:monospace; font-size:14px; cursor:pointer; white-space:nowrap; }
          .inspect-toggle-all:hover { background:#f5f5f5; }
          .inspect-search-input { font-size:14px; padding:6px 28px 6px 10px; border:1px solid #ccc; border-radius:4px; font-family:monospace; min-width:200px; }
          .inspect-clear { position:absolute; right:6px; top:50%; transform:translateY(-50%); background:none; border:none; font-size:16px; color:#888; cursor:pointer; padding:0; line-height:1; }
          .inspect-clear:hover { color:#000; }
          .tree-node { position:relative; padding-left:2em; line-height:1.5; }
          .tree-expander { position:absolute; left:0; top:0; width:2em; cursor:pointer; }
          .tree-key { font-weight:bold; }
          .highlight { background: yellow; color: black; }
          .tree-node.selected { background:#fffaaf; outline:none; }
          .inspect-scroll { overflow:auto; padding:8px 16px 16px; flex:1; border-radius: 0 0 6px 6px; }
          .inspect-close-btn { position:absolute; top:4px; right:8px; background:none; border:none; font-size:20px; cursor:pointer; color:#444; }
          .inspect-close-btn:hover { color:#000; }
        `}</style>
                <button className="inspect-close-btn" onClick={onClose} aria-label="Close Inspect">×</button>
                <div className="inspect-filter-bar">
                    <div className="inspect-test-name" title={fileName}>{fileName}</div>
                    <div className="inspect-search-controls">
                        <button
                            className="inspect-toggle-all"
                            onClick={handleToggleAll}
                            title={allExpanded ? "Collapse all" : "Expand all"}
                        >
                            {allExpanded ? '><' : '<>'}
                        </button>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                            <input
                                ref={filterInputRef}
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                placeholder="Filter ..."
                                className="common-search-input"
                                style={{ paddingRight: '28px' }}
                            />
                            {filter && (
                                <button
                                    onClick={() => setFilter('')}
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
                    </div>
                </div>
                <div className="inspect-scroll" ref={contentsRef}>
                    {loading && <div style={{ padding: '12px' }}>Loading…</div>}
                    {error && !loading && <div style={{ padding: '12px', color: 'red' }}>Error: {error}</div>}
                </div>
            </div>
        </div>
    );
};
