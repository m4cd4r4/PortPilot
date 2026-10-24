import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createHost } from './host';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App host={createHost()} />);
