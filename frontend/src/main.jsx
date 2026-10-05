import { createRoot } from 'react-dom/client';
import App from './App.jsx';

/* No StrictMode: the portal engine and Google Translate edit the DOM directly, so effects must run once. */
createRoot(document.getElementById('root')).render(<App />);
