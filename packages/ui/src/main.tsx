import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './lib/i18n';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('UI root element not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
