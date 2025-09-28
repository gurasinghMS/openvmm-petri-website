import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Header } from './header';
import './styles/main.css';
import { Routes, Route } from 'react-router-dom';
import { Runs } from './runs';
import { Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <Header />
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
    </Routes>
  );
}
