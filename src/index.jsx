import React from 'react';
import store from './store';
import { Provider } from 'react-redux';
import { render } from 'react-dom';

import MainView from './views/main';



const _render = (component) =>
	render
	(
		<Provider store={store}>
			{ component }
		</Provider>,

		document.getElementById('root'),
	);

_render(<MainView />);
