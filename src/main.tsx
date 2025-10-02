import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './styles/main.css';
import { Routes, Route } from 'react-router-dom';
import { Runs } from './runs';
import { RunDetails } from './run_details';
import { LogViewer } from './log_viewer';
import { Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchRunData } from './fetch';

const queryClient = new QueryClient();

// Schedule a passive prefetch of the runs list (does not mark as actively used yet).
// Cached ~3 min (fresh) and GC after 5 min idle; will hydrate instantly when a component queries ['runs'].
void queryClient.prefetchQuery({
  queryKey: ['runs'],
  queryFn: () => fetchRunData(queryClient),
  staleTime: 3 * 60 * 1000,
  gcTime: 3 * 60 * 1000,
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <QueryClientProvider client={queryClient}>
        <Content />
      </QueryClientProvider>
    </HashRouter>
  </React.StrictMode>
);

function Content() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/runs" replace />} />
      <Route path="runs" element={<Runs />} />
      {/* Route for individual run details */}
      <Route path="runs/:runId" element={<RunDetailsRouter />} />
      {/* New route structure: /runs/:runId/:architecture/:testName (testName segment has internal slashes encoded) */}
      <Route path="runs/:runId/:architecture/:testName" element={<LogViewer />} />
    </Routes>
  );
}

// Lightweight wrapper to adapt route params to existing RunDetailsView component props
function RunDetailsRouter() {
  const { runId } = useParams();
  if (!runId) {
    return <div style={{ padding: '1rem' }}>Run ID is missing.</div>;
  }
  return <RunDetails runId={runId} />;
}
