import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { createRoot } from 'react-dom/client';
import WebsiteApp from './components/WebsiteApp';

createRoot(document.querySelector('#root')!).render(
    <WebsiteApp
        origin={location.pathname}
        logoUrl={`${location.pathname === '/' ? '' : location.pathname}/background-colored.png`}
    />
);
