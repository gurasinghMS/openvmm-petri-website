import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import './styles/menu.css';

// New Hamburger drawer component for site navigation (replaces legacy header usage)
export function Menu(): React.JSX.Element {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    const currentPath = window.location.pathname;

    const close = useCallback(() => setOpen(false), []);
    const toggle = useCallback(() => setOpen(o => !o), []);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, close]);

    // Prevent body scroll while drawer open (simple approach)
    useEffect(() => {
        if (open) {
            const prev = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = prev; };
        }
    }, [open]);

    function navigateAndClose(path: string) {
        const target = path.startsWith('/') ? path : `/${path}`;
        navigate(target);
        close();
    }

    const isActive = (target: string) => currentPath.endsWith('/' + target);

    return (
        <>
            <button
                type="button"
                aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
                className="menu-trigger"
                onClick={toggle}
            >
                <span className="menu-lines" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </span>
            </button>
            {open && createPortal(
                <>
                    <div className="menu-overlay" onClick={close} role="presentation" />
                    <nav
                        className={open ? 'menu-drawer open' : 'menu-drawer'}
                        aria-hidden={!open}
                        aria-label="Primary"
                    >
                        <div className="menu-drawer-header">Petri Test Viewer</div>
                        <ul className="menu-nav-list" role="list">
                            <li>
                                <button
                                    className={isActive('runs') ? 'drawer-link active' : 'drawer-link'}
                                    onClick={() => navigateAndClose('/runs')}
                                >
                                    Runs
                                </button>
                            </li>
                            <li>
                                <button
                                    className={isActive('tests') ? 'drawer-link active' : 'drawer-link'}
                                    onClick={() => navigateAndClose('/tests')}
                                >
                                    Tests
                                </button>
                            </li>
                            <li className="drawer-separator" aria-hidden="true" />
                            <li>
                                <a
                                    className="drawer-link external"
                                    href="https://github.com/microsoft/openvmm"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Repo
                                </a>
                            </li>
                            <li>
                                <a
                                    className="drawer-link external"
                                    href="http://openvmm.dev/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Guide
                                </a>
                            </li>
                        </ul>
                    </nav>
                </>,
                document.body
            )}
        </>
    );
}

export default Menu;
