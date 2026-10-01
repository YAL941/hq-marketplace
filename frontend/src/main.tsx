import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Must come before App: it reads the stored language and writes lang/dir onto
// <html>, so it has to run before the first render rather than after it.
import './i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);