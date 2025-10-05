import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './styles/common.css';

interface SearchInputProps {
    value: string;
    onChange: (value: string) => void;
    inputRef?: React.RefObject<HTMLInputElement | null>;
    usePersistentSearching?: boolean;
}

export function SearchInput({ value, onChange, inputRef, usePersistentSearching = true }: SearchInputProps): React.JSX.Element {
    const location = useLocation();
    const navigate = useNavigate();
    const isInitialMount = useRef(true);
    const internalRef = useRef<HTMLInputElement>(null);
    const actualRef = inputRef || internalRef;

    // On mount: read search parameter from URL and update caller's filter (only if persistent searching is enabled)
    useEffect(() => {
        if (!usePersistentSearching) {
            isInitialMount.current = false;
            return;
        }

        const params = new URLSearchParams(location.search);
        const searchParam = params.get('search');
        if (searchParam !== null && searchParam !== value) {
            onChange(searchParam);
        }
        isInitialMount.current = false;
    }, []); // Only run on mount

    // When value changes (after initial mount), update the URL (only if persistent searching is enabled)
    useEffect(() => {
        if (!usePersistentSearching) return;
        if (isInitialMount.current) return; // Skip on initial mount

        const params = new URLSearchParams(location.search);
        if (value) {
            params.set('search', value);
        } else {
            params.delete('search');
        }

        const newSearch = params.toString();
        const newPath = newSearch ? `${location.pathname}?${newSearch}` : location.pathname;

        // Only navigate if the URL actually changed
        if (location.pathname + location.search !== newPath) {
            navigate(newPath, { replace: true });
        }
    }, [value, location.pathname, navigate, location.search, usePersistentSearching]);

    // Handle Ctrl/Cmd+F keyboard shortcut and Escape to clear
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().includes('MAC');
            const isFind = (e.key === 'f' || e.key === 'F') && ((isMac && e.metaKey) || (!isMac && e.ctrlKey));

            if (isFind && document.activeElement !== actualRef.current) {
                e.preventDefault();
                actualRef.current?.focus();
                actualRef.current?.select();
            }

            if (e.key === 'Escape') {
                // Only handle Escape if this input is focused OR if it's in a container that should handle it
                const isFocused = document.activeElement === actualRef.current;

                // Check if we're in an overlay (inspect overlay)
                const isInOverlay = actualRef.current?.closest('.inspect-overlay') !== null;

                // If this is an overlay search, only handle when focused or when there's a value
                if (isInOverlay) {
                    if (!isFocused && !value) {
                        return; // Don't handle
                    }
                } else {
                    // For non-overlay search bars, don't handle Escape if an overlay is open
                    if (!isFocused && document.querySelector('.inspect-overlay')) {
                        return; // Don't handle - an overlay is open
                    }
                }

                if (value) {
                    onChange('');
                }
                if (isFocused) {
                    actualRef.current?.blur();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [value, onChange]);

    const handleChange = (newValue: string) => {
        onChange(newValue);
    };

    return (
        <div style={{ display: 'inline-block' }}>
            <input
                ref={actualRef}
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="Filter ..."
                className="common-search-input"
            />
            {value && (
                <button
                    onClick={() => handleChange('')}
                    className="common-search-clear-btn"
                    title="Clear filter"
                >
                    ×
                </button>
            )}
        </div>
    );
}
