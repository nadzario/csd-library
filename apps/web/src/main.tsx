import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Admin } from './Admin';
import './styles.css';

const Page = window.location.pathname.replace(/\/$/, '').endsWith('/admin') ? Admin : App;
createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>);
