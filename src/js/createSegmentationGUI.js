import * as cornerstoneTools from '@cornerstonejs/tools';

import locale from '../locale.json';



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
		position: relative;
		display: inline-block;
	`;

	// Dropdown button
	const dropdownButton = document.createElement('div');
	dropdownButton.className = 'topbar-button';
	dropdownButton.innerHTML = `<span class="dropdown-label">${locale['Segmentations'][window.__LANG__]}</span>`;

	// Dropdown menu (hidden by default)
	const dropdownMenu = document.createElement('div');
	dropdownMenu.className = 'segmentation-dropdown-menu';
	dropdownMenu.style.cssText = `
		display: none;
		position: absolute;
		top: 100%;
		left: 0;
		background: #2a2a2a;
		border: 1px solid #444;
		border-radius: 4px;
		box-shadow: 0 4px 8px rgba(0,0,0,0.3);
		z-index: 1000;
		min-width: 350px;
		width: max-content;
		max-width: 500px;
		max-height: 500px;
		overflow-y: auto;
		flex-direction: column;
		margin-top: 4px;
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
	addButton.innerHTML = locale['+ Add Segmentation'][window.__LANG__];
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

		// Close other dropdowns
		Array.from(document.getElementsByClassName('topbar-button-settings_menu')).forEach(el => el.style.display = 'none');
		Array.from(document.getElementsByClassName('segmentation-dropdown-menu')).forEach(el => {
			if (el !== dropdownMenu) el.style.display = 'none';
		});
		Array.from(document.getElementsByClassName('interpolation-dropdown-menu')).forEach(el => el.style.display = 'none');

		isOpen = !isOpen;
		dropdownMenu.style.display = isOpen ? 'flex' : 'none';
		dropdownButton.classList.toggle('-active', isOpen);
	};
	dropdownButton.addEventListener('click', toggleDropdown);

	// Close dropdown when clicking outside
	document.addEventListener('click', (evt) =>
	{
		if (isOpen && !parent.contains(evt.target))
		{
			isOpen = false;
			dropdownMenu.style.display = 'none';
			dropdownButton.classList.remove('-active');
		}
	});

	dropdownMenu.appendChild(addButton);
	parent.appendChild(dropdownButton);
	parent.appendChild(dropdownMenu);

	// Append to topbar instead of viewport
	const topbar = document.getElementsByClassName('topbar')[0];
	if (topbar) {
		topbar.appendChild(parent);
	} else {
		// Fallback to viewport if topbar doesn't exist
		_this.viewport_inputs[0].element.appendChild(parent);
	}

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
		min-width: 0;
		white-space: nowrap;
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
		flex: 1;
		min-width: 0;
		overflow: visible;
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
		min-width: 0;
		white-space: nowrap;
		overflow: visible;
		text-overflow: clip;
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

	// Viewport visibility toggles for this specific segment index
	const viewportTogglesWrapper = document.createElement('div');
	viewportTogglesWrapper.style.cssText = `
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	`;

	// Initialize visibility state for this segmentation index (default: all visible)
	const segmentIndex = segm_index + 2;
	if (!_this.segmentation_visibility)
	{
		_this.segmentation_visibility = {};
	}
	if (!_this.segmentation_visibility[segm_index])
	{
		_this.segmentation_visibility[segm_index] = {};
		_this.viewport_inputs.forEach(vp => {
			_this.segmentation_visibility[segm_index][vp.viewportId] = true;
		});
	}

	// Master toggle for all viewports and 3D scene
	const masterToggleWrapper = document.createElement('div');
	masterToggleWrapper.style.cssText = `
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: rgba(255, 255, 255, 0.9);
		margin-bottom: 8px;
		padding-bottom: 8px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.15);
	`;

	const masterToggleCheckbox = document.createElement('input');
	masterToggleCheckbox.type = 'checkbox';

	// Check if all viewports and 3D are visible
	const allViewportsVisible = _this.viewport_inputs.every(vp =>
		_this.segmentation_visibility[segm_index][vp.viewportId] !== false
	);
	masterToggleCheckbox.checked = allViewportsVisible;

	masterToggleCheckbox.style.cssText = `
		width: 16px;
		height: 16px;
		cursor: pointer;
		margin: 0;
	`;

	const masterToggleLabel = document.createElement('label');
	masterToggleLabel.textContent = 'Show All';
	masterToggleLabel.style.cssText = `
		cursor: pointer;
		user-select: none;
		flex: 1;
		font-weight: 600;
	`;

	// Function to update master toggle state based on individual toggles
	const updateMasterToggleState = () => {
		const allViewportsVisible = _this.viewport_inputs.every(vp =>
			_this.segmentation_visibility[segm_index][vp.viewportId] !== false
		);
		masterToggleCheckbox.checked = allViewportsVisible;
	};

	masterToggleCheckbox.addEventListener('change', (evt) =>
	{
		evt.stopPropagation();
		evt.stopImmediatePropagation();

		const isVisible = masterToggleCheckbox.checked;
		const segmentationId = _this.volume_segm.volumeId;

		// Update all 2D viewports
		_this.viewport_inputs.forEach(viewport_input => {
			_this.segmentation_visibility[segm_index][viewport_input.viewportId] = isVisible;

			cornerstoneTools.segmentation.config.visibility.setSegmentIndexVisibility(
				viewport_input.viewportId,
				segmentationId,
				segmentIndex,
				isVisible
			);

			_this.renderingEngine.renderViewport(viewport_input.viewportId);
		});
	});

	masterToggleLabel.addEventListener('click', (evt) =>
	{
		evt.stopPropagation();
		evt.stopImmediatePropagation();
		masterToggleCheckbox.checked = !masterToggleCheckbox.checked;
		masterToggleCheckbox.dispatchEvent(new Event('change'));
	});

	masterToggleWrapper.appendChild(masterToggleCheckbox);
	masterToggleWrapper.appendChild(masterToggleLabel);
	viewportTogglesWrapper.appendChild(masterToggleWrapper);

	segmentationItem.appendChild(viewportTogglesWrapper);

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
		}
	}
}