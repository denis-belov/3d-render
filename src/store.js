import { createStore } from 'redux';
import { reducer } from './reducers';
// import { createLogger } from 'redux-logger';

let store = null;

store = createStore(reducer);

export default store;
