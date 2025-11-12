import * as cornerstoneTools from '@cornerstonejs/tools';



export function createSegmentationGUI (_this)
{
	if (_this.segmentation_dropdown)
	{
		_this.segmentation_dropdown.parentNode?.removeChild(_this.segmentation_dropdown);
		_this.segmentation_dropdown = null;
	}

	const parent = document.createElement('div');
	parent.className = 'segmentation-dropdown';
	parent.style.cssText = `
		position: absolute;
		z-index: 999999;
		top: 2px;
		left: 2px;
		min-width: 180px;
	`;

	// Dropdown button
	const dropdownButton = document.createElement('div');
	dropdownButton.className = 'segmentation-dropdown-button';
	dropdownButton.style.cssText = `
		background: rgba(20, 20, 20, 0.9);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 4px;
		padding: 8px 12px;
		cursor: pointer;
		color: #fff;
		font-size: 12px;
		user-select: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	`;
	dropdownButton.innerHTML = '<span class="dropdown-label">Segmentations</span><span class="dropdown-arrow">▼</span>';

	// Dropdown menu (hidden by default)
	const dropdownMenu = document.createElement('div');
	dropdownMenu.className = 'segmentation-dropdown-menu';
	dropdownMenu.style.cssText = `
		display: none;
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background: rgba(20, 20, 20, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-top: none;
		border-radius: 0 0 4px 4px;
		overflow-y: auto;
		flex-direction: column;
		margin-top: 2px;
	`;

	// Add segmentation button in dropdown
	const addButton = document.createElement('div');
	addButton.className = 'segmentation-item -add';
	addButton.style.cssText = `
		padding: 8px 12px;
		cursor: pointer;
		color: #4a90e2;
		font-size: 11px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		transition: background 0.2s;
	`;
	addButton.innerHTML = '+ Add Segmentation';
	addButton.addEventListener('mouseenter', () => addButton.style.background = 'rgba(74, 144, 226, 0.1)');
	addButton.addEventListener('mouseleave', () => addButton.style.background = 'transparent');
	addButton.addEventListener('click', (evt) =>
	{
		evt.stopPropagation();
		evt.stopImmediatePropagation();
		_this.addSegmentation();
	});

	// Toggle dropdown
	let isOpen = false;
	const toggleDropdown = (evt) =>
	{
		evt.stopPropagation();
		evt.stopImmediatePropagation();
		isOpen = !isOpen;
		dropdownMenu.style.display = isOpen ? 'flex' : 'none';
		dropdownButton.style.borderRadius = isOpen ? '4px 4px 0 0' : '4px';
		const arrow = dropdownButton.querySelector('.dropdown-arrow');
		arrow.textContent = isOpen ? '▲' : '▼';
	};
	dropdownButton.addEventListener('click', toggleDropdown);

	// Close dropdown when clicking outside
	document.addEventListener('click', (evt) =>
	{
		if (isOpen && !parent.contains(evt.target))
		{
			isOpen = false;
			dropdownMenu.style.display = 'none';
			dropdownButton.style.borderRadius = '4px';
			dropdownButton.querySelector('.dropdown-arrow').textContent = '▼';
		}
	});

	dropdownMenu.appendChild(addButton);
	parent.appendChild(dropdownButton);
	parent.appendChild(dropdownMenu);

	_this.viewport_inputs[0].element.appendChild(parent);

	_this.dat_gui_segm = parent;
	_this.segmentation_dropdown_menu = dropdownMenu;
	_this.segmentation_dropdown_button = dropdownButton;
	_this.segmentation_dropdown = parent;
	_this.segmentation_items = {}; // Store references to segmentation items



	// if (_this.dat_gui_segm?.destroy)
	// {
	// 	_this.dat_gui_segm.domElement.parentNode.removeChild(_this.dat_gui_segm.domElement);

	// 	_this.dat_gui_segm.destroy();

	// 	_this.dat_gui_segm = null;
	// }

	// const dat_gui_segm = new dat.GUI({ autoPlace: false });

	// if (!window.__CONFIG__.features?.includes('web'))
	// {
	// 	dat_gui_segm.domElement.style.display = 'none';
	// }

	// dat_gui_segm.domElement.style.position = 'absolute';
	// dat_gui_segm.domElement.style.zIndex = 999999;
	// dat_gui_segm.domElement.style.top = '0px';
	// dat_gui_segm.domElement.style.left = '-87px';

	// dat_gui_segm.domElement
	// 	.addEventListener
	// 	(
	// 		'mousedown',

	// 		evt =>
	// 		{
	// 			evt.preventDefault();
	// 			evt.stopPropagation();
	// 			evt.stopImmediatePropagation();
	// 		},
	// 	);

	// // _this.viewport_inputs.find(viewport_input => (viewport_input.orientation === 'axial')).element.appendChild(dat_gui_segm.domElement);
	// // document.body.appendChild(dat_gui_segm.domElement);
	// _this.viewport_inputs[0].element.appendChild(dat_gui_segm.domElement);

	// dat_gui_segm
	// 	.add
	// 	(
	// 		{ 'add segmentation': () => _this.addSegmentation() },

	// 		'add segmentation',
	// 	);

	// _this.dat_gui_segm = dat_gui_segm;
}

export function addSegmentationGUI (_this, segm, segm_index, segm_name)
{
	const viewport = _this.renderingEngine.getViewport(_this.viewport_inputs[0].viewportId);

	// Create segmentation item for dropdown
	const segmentationItem = document.createElement('div');
	segmentationItem.className = 'segmentation-item';
	segmentationItem.dataset.segmIndex = segm_index;
	segmentationItem.style.cssText = `
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		cursor: pointer;
		border-left: 3px solid transparent;
		transition: background 0.2s, border-color 0.2s;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	`;
	segmentationItem.addEventListener('mouseenter', () =>
	{
		if (!segmentationItem.classList.contains('-active'))
		{
			segmentationItem.style.background = 'rgba(255, 255, 255, 0.05)';
		}
	});
	segmentationItem.addEventListener('mouseleave', () =>
	{
		if (!segmentationItem.classList.contains('-active'))
		{
			segmentationItem.style.background = 'transparent';
		}
	});
	segmentationItem.addEventListener('click', (evt) =>
	{
		evt.stopPropagation();
		evt.stopImmediatePropagation();
		if (evt.target.type !== 'color' && evt.target.tagName !== 'INPUT')
		{
			_this.activateSegmentation(segm_index);
		}
	});

	// Color input
	const color_input = document.createElement('input');
	color_input.type = 'color';
	color_input.style.cssText = `
		width: 24px;
		height: 24px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 3px;
		cursor: pointer;
		flex-shrink: 0;
	`;

	const hexToRGB = hex => [ parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16) ];

	const updateColor = evt =>
	{
		evt.stopPropagation();
		evt.stopImmediatePropagation();
		cornerstoneTools.segmentation.config.color.setSegmentIndexColor(viewport.id, _this.volume_segm.volumeId, segm_index + 2, [ ...hexToRGB(evt.target.value), 50 ]);
	};

	color_input.addEventListener('input', updateColor);
	color_input.addEventListener('change', updateColor);
	color_input.addEventListener('click', evt => { evt.stopPropagation(); evt.stopImmediatePropagation(); });

	const color = cornerstoneTools.segmentation.config.color.getSegmentIndexColor(viewport.id, _this.volume_segm.volumeId, segm_index + 2);

	const componentToHex = comp =>
	{
		const hex = comp.toString(16);
		return hex.length === 1 ? '0' + hex : hex;
	};

	const rgbToHex = (r, g, b) => `#${ componentToHex(r) }${ componentToHex(g) }${ componentToHex(b) }`;

	color_input.value = color ? rgbToHex(...color.slice(0, 3)) : '#ffffff';

	// Name input (editable on double-click)
	const name_wrapper = document.createElement('div');
	name_wrapper.style.cssText = `
	position: relative;
	width: 100%;
	`;
	const nameInput = document.createElement('input');
	nameInput.type = 'text';
	nameInput.value = segm_name;
	// nameInput.disabled = true;
	nameInput.style.cssText = `
		flex: 1;
		background: transparent;
		border: 1px solid transparent;
		color: #fff;
		font-size: 11px;
		padding: 2px 4px;
		border-radius: 2px;
		outline: none;
		width: 100%;
	`;

	// nameInput.addEventListener('dblclick', (evt) =>
	// {
	// 	evt.stopPropagation();
	// 	alert(1)
	// 	nameInput.style.border = '1px solid rgba(74, 144, 226, 0.5)';
	// 	nameInput.style.background = 'rgba(20, 20, 20, 0.8)';
	// 	// nameInput.disabled = false;
	// 	nameInput.select();
	// });
	nameInput.addEventListener('blur', () =>
	{
		nameInput.style.border = '1px solid transparent';
		nameInput.style.background = 'transparent';
		// nameInput.disabled = true;
		segm.name = nameInput.value;

		// Update dropdown label if _this is the active segmentation
		if (_this.current_segm === segm_index)
		{
			const labelElement = _this.segmentation_dropdown_button?.querySelector('.dropdown-label');
			if (labelElement)
			{
				labelElement.textContent = segm.name || `Segmentation ${segm_index}`;
			}
		}
		name_overlay.style.display = 'block';
	});
	nameInput.addEventListener('keydown', (evt) =>
	{
		if (evt.key === 'Enter')
		{
			nameInput.blur();
			name_overlay.style.display = 'block';
		}
	});
	// nameInput.addEventListener('click', evt => evt.stopPropagation());

	segmentationItem.appendChild(color_input);
	name_wrapper.appendChild(nameInput);
	const name_overlay = document.createElement('div');
	name_overlay.style.cssText = `
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	`;
	name_overlay.addEventListener('dblclick', (evt) =>
	{
		name_overlay.style.display = 'none';
		evt.stopPropagation();
		evt.stopImmediatePropagation();
		nameInput.style.border = '1px solid rgba(74, 144, 226, 0.5)';
		nameInput.style.background = 'rgba(20, 20, 20, 0.8)';
		// nameInput.disabled = false;
		nameInput.select();
	});
	name_wrapper.appendChild(nameInput);
	name_wrapper.appendChild(name_overlay);
	segmentationItem.appendChild(name_wrapper);

	// Add to dropdown menu (before the add button)
	const dropdownMenu = _this.segmentation_dropdown_menu || _this.dat_gui_segm?.querySelector('.segmentation-dropdown-menu');
	if (dropdownMenu)
	{
		const addButton = dropdownMenu.querySelector('.-add');
		if (addButton)
		{
			dropdownMenu.insertBefore(segmentationItem, addButton);
		}
		else
		{
			dropdownMenu.appendChild(segmentationItem);
		}
	}

	// Store reference
	if (!_this.segmentation_items)
	{
		_this.segmentation_items = {};
	}
	_this.segmentation_items[segm_index] = segmentationItem;

	// domElement.parentNode.parentNode.style.position = 'relative';
	// domElement.parentNode.parentNode.style.cursor = 'pointer';

	// domElement
	// 	.parentNode
	// 		.parentNode
	// 			.onclick = () => _this.activateSegmentation(segm_index);

	// domElement.getElementsByTagName('INPUT')[0].addEventListener
	// (
	// 	'dblclick',

	// 	evt => evt.target.focus(),
	// );

	// domElement.getElementsByTagName('INPUT')[0].addEventListener
	// (
	// 	'input',

	// 	evt => { segm.name = evt.target.value; },
	// );

	// domElement
	// 	.parentNode
	// 	.getElementsByClassName('property-name')[0].style.display = 'none';

	// domElement.onclick = evt => evt.stopImmediatePropagation();
}

export function activateSegmentationGUI (_this, segm, segm_index)
{
	// Update active state in dropdown UI
	if (_this.segmentation_items)
	{
		// Remove active class from all items
		Object.values(_this.segmentation_items).forEach(item =>
		{
			item.classList.remove('-active');
			item.style.borderLeftWidth = '3px';
			item.style.borderLeftColor = 'transparent';
			item.style.background = 'transparent';
		});

		// Add active class to current item
		const activeItem = _this.segmentation_items[segm_index];
		if (activeItem)
		{
			activeItem.classList.add('-active');
			activeItem.style.borderLeftWidth = '10px';
			activeItem.style.borderLeftColor = '#4a90e2';
			activeItem.style.background = 'rgba(74, 144, 226, 0.15)';

			// Update dropdown button label with active segmentation name
			const labelElement = _this.segmentation_dropdown_button?.querySelector('.dropdown-label');
			if (labelElement)
			{
				labelElement.textContent = segm.name || `Segmentation ${segm_index}`;
			}
		}
	}
}