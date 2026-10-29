import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createHost } from './host';
import { applyTheme, loadTheme } from './components/Settings';
import { applyPrefs } from './prefs';
import './styles.css';

applyPrefs();
applyTheme(loadTheme() === 'system' ? null : loadTheme());

createRoot(document.getElementById('root')!).render(<App host={createHost()} />);
