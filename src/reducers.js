
/*
eslint-disable

no-multi-spaces,
*/



import * as actions from './actions';



const reducer =
	(
		state =
		{
			thing: false,
		},

		action,
	) =>
	{
		switch (action.type)
		{
		case actions.TOGGLE_THING: return { ...state, thing: !state.thing };

		default: return { ...state };
		}
	};

export { reducer };
