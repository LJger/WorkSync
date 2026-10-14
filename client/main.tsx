import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import { UIProvider } from './ui';
import { App } from './app';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: {
  retry: 1, staleTime: 15_000, refetchOnWindowFocus: true,
}, mutations: { retry: false } } });

createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}>
  <UIProvider><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></UIProvider>
</QueryClientProvider></StrictMode>);
