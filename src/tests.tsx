import React from 'react';
import { Hamburger } from './hamburger';
import './styles/common.css';

export function Tests(): React.JSX.Element {
    return (
        <div className="common-page-display">
            <div className="common-page-header" style={{ paddingLeft: '0.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Hamburger />
                    <h3 style={{ margin: 0 }}>Tests</h3>
                </div>
                <div style={{ fontSize: '0.9rem', color: '#666', paddingRight: '1rem' }}>
                    Placeholder tests page
                </div>
            </div>
            <div style={{ padding: '1.5rem 0' }}>
                <p style={{ fontFamily: 'SF Mono, monospace', fontSize: '0.95rem' }}>
                    This is a placeholder for the Tests page. Implement test summaries or filtering UI here.
                </p>
            </div>
        </div>
    );
}

export default Tests;
