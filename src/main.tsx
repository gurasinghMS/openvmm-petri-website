import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/main.css';
import { Routes, Route } from 'react-router-dom';
import { Runs } from './runs';
import { Tests } from './tests';
import { RunDetailsView } from './run_details';
import { Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/openvmm-petri-website/dist">
      <QueryClientProvider client={queryClient}>
        {/* <Header /> */}
        <Content />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);

function Content() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/runs" replace />} />
      <Route path="runs" element={<Runs />} />
      {/* Route for individual run details */}
      <Route path="runs/:runId" element={<RunDetailsRouteWrapper />} />
      <Route path="tests" element={<Tests />} />
    </Routes>
  );
}

// Lightweight wrapper to adapt route params to existing RunDetailsView component props
function RunDetailsRouteWrapper() {
  const { runId } = useParams();
  if (!runId) {
    return <div style={{ padding: '1rem' }}>Run ID is missing.</div>;
  }
  return <RunDetailsView runId={runId} searchFilter="" />;
}
