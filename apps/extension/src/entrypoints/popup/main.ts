import { mount } from 'svelte';

// oxlint-disable-next-line import/no-unassigned-import
import './app.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
