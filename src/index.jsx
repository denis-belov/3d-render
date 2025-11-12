import React from 'react';
import store from './store';
import { Provider } from 'react-redux';
import { createRoot } from 'react-dom/client';

import MainView from './views/main';



const _render = (component) => {
	const container = document.getElementById('root');
	const root = createRoot(container);
	root.render(
		<Provider store={store}>
			{ component }
		</Provider>
	);
};

_render(<MainView />);
