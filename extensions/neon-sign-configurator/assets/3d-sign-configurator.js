// Mozemo Signage - 3D Illuminated Sign Configurator: live preview + dynamic pricing
function initAllSign3dConfigurators() {
    document.querySelectorAll('.sign3d-configurator').forEach((root) => {
        if (root.dataset.sign3dConfiguratorInitialized === 'true') return;
        try {
            initSign3dConfigurator(root);
            root.dataset.sign3dConfiguratorInitialized = 'true';
        } catch (err) {
            console.error('3D Sign Configurator: init failed for this block:', err, root);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllSign3dConfigurators);
} else {
    initAllSign3dConfigurators();
}

document.addEventListener('shopify:section:load', initAllSign3dConfigurators);
document.addEventListener('cart:refresh', initAllSign3dConfigurators);

// Shopify can take a brief moment to make a brand-new variant (created via the Admin API)
// fully available to the storefront cart endpoint. Retrying a couple of times with an
// increasing delay — only for freshly-created variants — avoids showing a false error.
async function addItemToCartWithRetry(routesRoot, variantId, properties, sectionIds, maxRetries) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(routesRoot + 'cart/add.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: [{ id: parseInt(variantId, 10), quantity: 1, properties }],
                    sections: sectionIds.join(',')
                })
            });
            if (response.ok) {
                return await response.json();
            }
            lastError = new Error('Add to cart failed with status ' + response.status);
        } catch (err) {
            lastError = err;
        }
        if (attempt < maxRetries) {
            const delay = 900 + (attempt * 500);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

// Shows a spinning loader inside the button next to the given text.
function setButtonLoadingText(button, text) {
    button.innerHTML = '<span class="sign3d-configurator__spinner"></span><span>' + text + '</span>';
}

// Shows a status message under the button, then clears it automatically after a few seconds.
function showTemporaryStatus(statusEl, text, durationMs) {
    if (!statusEl) return;
    statusEl.textContent = text;
    clearTimeout(statusEl._clearTimeoutId);
    statusEl._clearTimeoutId = setTimeout(() => {
        statusEl.textContent = '';
    }, durationMs);
}

function initSign3dConfigurator(root) {
    const previewText = root.querySelector('[data-preview-text]');
    const textInput = root.querySelector('[data-text-input]');
    const fontSelect = root.querySelector('[data-font-select]');
    const symbolButtons = root.querySelectorAll('[data-symbol-buttons] .sign3d-configurator__symbol-btn');
    const iconsContainer = root.querySelector('[data-preview-icons]');
    let selectedSymbols = [];
    const illuminationSelect = root.querySelector('[data-illumination-select]');
    const sizeSelect = root.querySelector('[data-size-select]');
    const materialSelect = root.querySelector('[data-material-select]');
    const thicknessSelect = root.querySelector('[data-thickness-select]');
    const swatches = root.querySelectorAll('[data-colour-swatches] .sign3d-configurator__swatch');
    const colourNameLabel = root.querySelector('[data-colour-name-label]');
    const finishSelect = root.querySelector('[data-finish-select]');
    const mountingSelect = root.querySelector('[data-mounting-select]');
    const addonCheckboxes = root.querySelectorAll('[data-addon-checkbox]');
    const totalPriceEl = root.querySelector('[data-total-price]');
    const addToCartBtn = root.querySelector('[data-add-to-cart]');
    const addToCartStatus = root.querySelector('[data-add-to-cart-status]');
    const previewStage = root.querySelector('[data-preview-stage]');
    const previewInner = root.querySelector('[data-preview-inner]');
    const widthLabel = root.querySelector('[data-width-label]');
    const heightLabel = root.querySelector('[data-height-label]');
    const textFlex = root.querySelector('[data-text-flex]');
    const selectionBox = root.querySelector('[data-selection-box]');
    const previewBox = root.querySelector('.sign3d-configurator__preview');
    const wallpaperInput = root.querySelector('[data-wallpaper-input]');
    const wallpaperActions = root.querySelector('[data-wallpaper-actions]');
    const wallpaperViewBtn = root.querySelector('[data-wallpaper-view-btn]');
    const wallpaperDeleteBtn = root.querySelector('[data-wallpaper-delete-btn]');
    let wallpaperObjectUrl = null;
    let wallpaperShowingDefault = false;
    const alignButtons = root.querySelectorAll('[data-align-btn]');
    const selectAllBtn = root.querySelector('[data-select-all-btn]');
    const undoBtn = root.querySelector('[data-undo-btn]');
    const redoBtn = root.querySelector('[data-redo-btn]');
    const resetColourBtn = root.querySelector('[data-reset-colour-btn]');
    const resetScaleSizeBtn = root.querySelector('[data-reset-scale-size-btn]');
    const resetFontBtn = root.querySelector('[data-reset-font-btn]');
    let historyStack = [];
    let historyIndex = -1;
    let groupOffsetX = 0;
    let groupOffsetY = 0;
    let letterOffsets = [];
    let letterScales = [];
    let groupScale = 1;
    let baseFontSize = 44;
    let selectedLetterIndex = null;

    let selectedColourHex = swatches.length ? swatches[0].dataset.colourHex : '#ffffff';
    let selectedColourPrice = swatches.length ? parseFloat(swatches[0].dataset.colourPrice) || 0 : 0;
    let currentTotal = 0;

    function applyLetterTransform(span, i) {
        const off = letterOffsets[i] || { x: 0, y: 0 };
        const scale = letterScales[i] || 1;
        span.style.transform = 'translate(' + (groupOffsetX + off.x) + 'px, ' + (groupOffsetY + off.y) + 'px) scale(' + scale + ')';
    }

    function attachResizeHandles() {
        if (!selectionBox) return;
        const handles = selectionBox.querySelectorAll('[data-resize-handle]');
        handles.forEach((handle) => {
            handle.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                event.stopPropagation();
                handle.setPointerCapture(event.pointerId);

                const boxRect = selectionBox.getBoundingClientRect();
                const centerX = boxRect.left + boxRect.width / 2;
                const centerY = boxRect.top + boxRect.height / 2;
                const startDist = Math.hypot(event.clientX - centerX, event.clientY - centerY) || 1;
                const startScale = selectedLetterIndex !== null ? (letterScales[selectedLetterIndex] || 1) : groupScale;

                const onMove = (moveEvent) => {
                    const dist = Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY) || 1;
                    const factor = dist / startDist;
                    const newScale = Math.min(3, Math.max(0.3, startScale * factor));
                    resizeMoved = true;

                    if (selectedLetterIndex !== null) {
                        letterScales[selectedLetterIndex] = newScale;
                        const span = textFlex.querySelector('[data-letter-index="' + selectedLetterIndex + '"]');
                        applyLetterTransform(span, selectedLetterIndex);
                        showSelectionBoxAround(span);
                    } else {
                        groupScale = newScale;
                        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';
                        showSelectionBoxAround(textFlex);
                    }
                };

                let resizeMoved = false;

                const onUp = (upEvent) => {
                    handle.releasePointerCapture(upEvent.pointerId);
                    handle.removeEventListener('pointermove', onMove);
                    handle.removeEventListener('pointerup', onUp);
                    if (resizeMoved) pushHistory();
                };

                handle.addEventListener('pointermove', onMove);
                handle.addEventListener('pointerup', onUp);
            });
        });
    }

    function refreshAllLetterTransforms() {
        if (!textFlex) return;
        textFlex.querySelectorAll('.sign3d-configurator__letter').forEach((span) => {
            applyLetterTransform(span, Number(span.dataset.letterIndex));
        });
    }

    function hideSelectionBox() {
        if (selectionBox) selectionBox.hidden = true;
        if (selectAllBtn) selectAllBtn.hidden = true;
        if (textFlex) {
            textFlex.querySelectorAll('.sign3d-configurator__letter').forEach((s) => s.classList.remove('is-selected'));
        }
    }

    function showSelectionBoxAround(el) {
        if (!selectionBox || !previewStage || !el) return;
        if (!measurementsVisible) return;
        const stageRect = previewStage.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        selectionBox.style.left = (elRect.left - stageRect.left - 6) + 'px';
        selectionBox.style.top = (elRect.top - stageRect.top - 6) + 'px';
        selectionBox.style.width = (elRect.width + 12) + 'px';
        selectionBox.style.height = (elRect.height + 12) + 'px';
        selectionBox.hidden = false;
    }

    function selectLetter(index) {
        selectedLetterIndex = index;
        textFlex.querySelectorAll('.sign3d-configurator__letter').forEach((s) => {
            s.classList.toggle('is-selected', Number(s.dataset.letterIndex) === index);
        });
        const target = textFlex.querySelector('[data-letter-index="' + index + '"]');
        showSelectionBoxAround(target);
        if (selectAllBtn) selectAllBtn.hidden = false;
    }

    function selectGroup() {
        selectedLetterIndex = null;
        hideSelectionBox();
        showSelectionBoxAround(textFlex);
    }

    function attachLetterDrag(span, i) {
        let startX = 0;
        let startY = 0;
        let startOffX = 0;
        let startOffY = 0;
        let moved = false;
        let draggingWholeGroup = false;

        span.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            span.setPointerCapture(event.pointerId);
            moved = false;
            draggingWholeGroup = selectedLetterIndex !== i;
            startX = event.clientX;
            startY = event.clientY;
            if (draggingWholeGroup) {
                startOffX = groupOffsetX;
                startOffY = groupOffsetY;
            } else {
                const off = letterOffsets[i] || { x: 0, y: 0 };
                startOffX = off.x;
                startOffY = off.y;
            }
        });

        span.addEventListener('pointermove', (event) => {
            if (!span.hasPointerCapture(event.pointerId)) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;

            if (draggingWholeGroup) {
                groupOffsetX = startOffX + dx;
                groupOffsetY = startOffY + dy;
                refreshAllLetterTransforms();
                showSelectionBoxAround(textFlex);
            } else {
                letterOffsets[i] = { x: startOffX + dx, y: startOffY + dy };
                applyLetterTransform(span, i);
                showSelectionBoxAround(span);
            }
        });

        span.addEventListener('pointerup', (event) => {
            if (span.hasPointerCapture(event.pointerId)) span.releasePointerCapture(event.pointerId);
            if (!moved) {
                if (selectedLetterIndex === i) {
                    selectGroup();
                } else {
                    selectLetter(i);
                }
            } else {
                pushHistory();
            }
        });
    }

    function rebuildLetterDOM(value) {
        if (!textFlex) return;
        textFlex.innerHTML = '';
        value.split('').forEach((ch, i) => {
            const span = document.createElement('span');
            span.className = 'sign3d-configurator__letter';
            span.textContent = ch === ' ' ? '\u00A0' : ch;
            span.dataset.letterIndex = i;
            applyLetterTransform(span, i);
            attachLetterDrag(span, i);
            textFlex.appendChild(span);
        });

        hideSelectionBox();
    }

    function renderLetters() {
        if (!textFlex) return;
        const value = textInput.value.trim() || 'Your Brand';

        if (letterOffsets.length !== value.length) {
            letterOffsets = value.split('').map(() => ({ x: 0, y: 0 }));
            letterScales = value.split('').map(() => 1);
            selectedLetterIndex = null;
        }

        rebuildLetterDOM(value);
    }

    // ---- Undo / Redo + Reset (Colour, Scale & Size, Font) ----
    function captureState() {
        const selectedAlignBtn = root.querySelector('[data-align-btn].is-selected');
        return {
            text: textInput.value,
            font: fontSelect ? fontSelect.value : '',
            colourHex: selectedColourHex,
            colourPrice: selectedColourPrice,
            colourName: colourNameLabel ? colourNameLabel.textContent : '',
            symbols: selectedSymbols.map((s) => ({ url: s.url, label: s.label })),
            align: selectedAlignBtn ? selectedAlignBtn.dataset.align : 'center',
            letterOffsets: letterOffsets.map((o) => ({ x: o.x, y: o.y })),
            letterScales: letterScales.slice(),
            groupOffsetX,
            groupOffsetY,
            groupScale
        };
    }

    function pushHistory() {
        const snapshot = captureState();
        if (historyIndex >= 0 && JSON.stringify(historyStack[historyIndex]) === JSON.stringify(snapshot)) return;
        historyStack = historyStack.slice(0, historyIndex + 1);
        historyStack.push(snapshot);
        historyIndex = historyStack.length - 1;
        updateUndoRedoButtons();
    }

    function applyState(state) {
        textInput.value = state.text;

        letterOffsets = state.letterOffsets.map((o) => ({ x: o.x, y: o.y }));
        letterScales = state.letterScales.slice();
        groupOffsetX = state.groupOffsetX;
        groupOffsetY = state.groupOffsetY;
        groupScale = state.groupScale;

        if (fontSelect && state.font) {
            fontSelect.value = state.font;
            updatePreviewFont();
        }

        selectedColourHex = state.colourHex;
        selectedColourPrice = state.colourPrice;
        swatches.forEach((swatch) => {
            swatch.classList.toggle('is-selected', swatch.dataset.colourHex === state.colourHex);
        });
        if (colourNameLabel) colourNameLabel.textContent = state.colourName;
        updatePreviewColour();

        selectedSymbols = state.symbols.map((s) => ({ url: s.url, label: s.label }));
        symbolButtons.forEach((btn) => {
            btn.classList.toggle('is-selected', selectedSymbols.some((s) => s.url === btn.dataset.symbolUrl));
        });
        renderIcons();

        alignButtons.forEach((btn) => {
            btn.classList.toggle('is-selected', btn.dataset.align === state.align);
        });
        if (textFlex) textFlex.style.justifyContent = ALIGN_MAP[state.align] || 'center';

        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';
        const value = state.text.trim() || 'Your Brand';
        rebuildLetterDOM(value);

        calculateTotal();
    }

    function updateUndoRedoButtons() {
        if (undoBtn) undoBtn.disabled = historyIndex <= 0;
        if (redoBtn) redoBtn.disabled = historyIndex >= historyStack.length - 1;
    }

    function undo() {
        if (historyIndex <= 0) return;
        historyIndex -= 1;
        applyState(historyStack[historyIndex]);
        updateUndoRedoButtons();
    }

    function redo() {
        if (historyIndex >= historyStack.length - 1) return;
        historyIndex += 1;
        applyState(historyStack[historyIndex]);
        updateUndoRedoButtons();
    }

    function resetColourToDefault() {
        if (!swatches.length) return;
        const defaultSwatch = swatches[0];
        swatches.forEach((s) => s.classList.remove('is-selected'));
        defaultSwatch.classList.add('is-selected');
        selectedColourHex = defaultSwatch.dataset.colourHex;
        selectedColourPrice = parseFloat(defaultSwatch.dataset.colourPrice) || 0;
        if (colourNameLabel) colourNameLabel.textContent = defaultSwatch.dataset.colourName;
        updatePreviewColour();
        calculateTotal();
        pushHistory();
    }

    function resetFontToDefault() {
        if (!fontSelect || !fontSelect.options.length) return;
        fontSelect.selectedIndex = 0;
        updatePreviewFont();
        pushHistory();
    }

    function resetScaleAndSizeToDefault() {
        groupOffsetX = 0;
        groupOffsetY = 0;
        groupScale = 1;
        letterOffsets = letterOffsets.map(() => ({ x: 0, y: 0 }));
        letterScales = letterScales.map(() => 1);
        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';
        refreshAllLetterTransforms();
        selectGroup();
        pushHistory();
    }

    function updatePreviewText() {
        renderLetters();
    }

    function updatePreviewColour() {
        previewText.style.color = selectedColourHex;
        if (iconsContainer) {
            iconsContainer.querySelectorAll('.sign3d-configurator__preview-icon').forEach((el) => {
                el.style.color = selectedColourHex;
            });
        }
    }

    function updatePreviewFont() {
        if (fontSelect && textFlex) textFlex.style.fontFamily = fontSelect.value;
    }

    function updatePreviewScale() {
        const sizeOption = sizeSelect.options[sizeSelect.selectedIndex];
        const widthCm = parseFloat(sizeOption?.value) || 60;
        const heightCm = parseFloat(sizeOption?.dataset.height) || Math.round(widthCm / 2.6);

        baseFontSize = Math.min(80, Math.max(20, widthCm * 0.4));
        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';

        if (widthLabel) widthLabel.textContent = widthCm + ' cm';
        if (heightLabel) heightLabel.textContent = heightCm + ' cm';
    }

    let measurementsVisible = true;
    const hideMeasurementsToggle = root.querySelector('[data-hide-measurements-toggle]');

    if (previewInner) {
        previewInner.addEventListener('pointerdown', (event) => {
            if (event.target === previewInner || event.target === textFlex) {
                selectGroup();
            }
        });
    }

    document.addEventListener('pointerdown', (event) => {
        if (previewInner && !previewInner.contains(event.target)) {
            hideSelectionBox();
        }
    });

    if (hideMeasurementsToggle) {
        hideMeasurementsToggle.addEventListener('change', () => {
            measurementsVisible = hideMeasurementsToggle.checked;
            if (previewStage) previewStage.classList.toggle('no-measurements', !measurementsVisible);
            if (!measurementsVisible) hideSelectionBox();
        });
    }

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => selectGroup());
    }

    attachResizeHandles();

    function renderIcons() {
        if (!iconsContainer) return;
        iconsContainer.innerHTML = '';
        selectedSymbols.forEach((sym) => {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'sign3d-configurator__preview-icon';
            iconSpan.style.webkitMaskImage = 'url("' + sym.url + '")';
            iconSpan.style.maskImage = 'url("' + sym.url + '")';
            iconSpan.style.color = selectedColourHex;
            iconSpan.title = sym.label;
            iconsContainer.appendChild(iconSpan);
        });
    }

    function calculateTotal() {
        let total = 0;
        const selects = [illuminationSelect, sizeSelect, materialSelect, thicknessSelect, finishSelect, mountingSelect];
        selects.forEach((select) => {
            const option = select.options[select.selectedIndex];
            total += parseFloat(option?.dataset.price) || 0;
        });
        total += selectedColourPrice;
        addonCheckboxes.forEach((checkbox) => {
            if (checkbox.checked) total += parseFloat(checkbox.dataset.price) || 0;
        });
        totalPriceEl.textContent = '$' + total.toFixed(2);
        currentTotal = total;
    }

    let textHistoryTimer = null;
    textInput.addEventListener('input', () => {
        updatePreviewText();
        clearTimeout(textHistoryTimer);
        textHistoryTimer = setTimeout(() => {
            pushHistory();
        }, 600);
    });

    if (fontSelect) {
        fontSelect.addEventListener('change', () => {
            updatePreviewFont();
            pushHistory();
        });
    }

    symbolButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const url = btn.dataset.symbolUrl;
            const label = btn.dataset.symbolLabel;
            const existingIndex = selectedSymbols.findIndex((s) => s.url === url);
            if (existingIndex > -1) {
                selectedSymbols.splice(existingIndex, 1);
                btn.classList.remove('is-selected');
            } else {
                selectedSymbols.push({ url, label });
                btn.classList.add('is-selected');
            }
            renderIcons();
            pushHistory();
        });
    });

    function applyWallpaperBackground() {
        if (!previewBox) return;
        if (wallpaperObjectUrl && !wallpaperShowingDefault) {
            previewBox.style.backgroundImage = "url('" + wallpaperObjectUrl + "')";
            previewBox.style.backgroundSize = 'cover';
            previewBox.style.backgroundPosition = 'center';
        } else {
            previewBox.style.backgroundImage = '';
            previewBox.style.backgroundSize = '';
            previewBox.style.backgroundPosition = '';
        }
    }

    function clearWallpaper() {
        if (wallpaperObjectUrl) URL.revokeObjectURL(wallpaperObjectUrl);
        wallpaperObjectUrl = null;
        wallpaperShowingDefault = false;
        if (wallpaperInput) wallpaperInput.value = '';
        if (wallpaperActions) wallpaperActions.hidden = true;
        applyWallpaperBackground();
    }

    if (wallpaperInput) {
        wallpaperInput.addEventListener('change', () => {
            const file = wallpaperInput.files && wallpaperInput.files[0];
            if (!file) return;
            if (wallpaperObjectUrl) URL.revokeObjectURL(wallpaperObjectUrl);
            wallpaperObjectUrl = URL.createObjectURL(file);
            wallpaperShowingDefault = false;
            if (wallpaperActions) wallpaperActions.hidden = false;
            if (wallpaperViewBtn) wallpaperViewBtn.textContent = 'View your Simple Signs';
            applyWallpaperBackground();
        });
    }

    if (wallpaperViewBtn) {
        wallpaperViewBtn.addEventListener('click', () => {
            wallpaperShowingDefault = !wallpaperShowingDefault;
            wallpaperViewBtn.textContent = wallpaperShowingDefault ? 'View my Wallpaper' : 'View your Simple Signs';
            applyWallpaperBackground();
        });
    }

    if (wallpaperDeleteBtn) {
        wallpaperDeleteBtn.addEventListener('click', () => clearWallpaper());
    }

    swatches.forEach((swatch) => {
        swatch.addEventListener('click', () => {
            swatches.forEach((s) => s.classList.remove('is-selected'));
            swatch.classList.add('is-selected');
            selectedColourHex = swatch.dataset.colourHex;
            selectedColourPrice = parseFloat(swatch.dataset.colourPrice) || 0;
            colourNameLabel.textContent = swatch.dataset.colourName;
            updatePreviewColour();
            calculateTotal();
            pushHistory();
        });
    });

    [illuminationSelect, sizeSelect, materialSelect, thicknessSelect, finishSelect, mountingSelect].forEach((select) => {
        select.addEventListener('change', calculateTotal);
    });

    sizeSelect.addEventListener('change', updatePreviewScale);

    const ALIGN_MAP = { left: 'flex-start', center: 'center', right: 'flex-end' };
    alignButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            alignButtons.forEach((b) => b.classList.remove('is-selected'));
            btn.classList.add('is-selected');
            if (textFlex) textFlex.style.justifyContent = ALIGN_MAP[btn.dataset.align] || 'center';
            pushHistory();
        });
    });

    addonCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', calculateTotal);
    });

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', async () => {
            const variantId = addToCartBtn.dataset.variantId;
            if (!variantId) {
                console.error('3D Sign Configurator: No variant ID found on Add to Cart button.');
                if (addToCartStatus) addToCartStatus.textContent = 'Unable to add to cart — product variant not found. Please refresh the page.';
                return;
            }

            const selectedAddons = Array.from(addonCheckboxes)
                .filter((checkbox) => checkbox.checked)
                .map((checkbox) => checkbox.closest('label').querySelector('span').textContent.trim())
                .join(', ');

            const properties = {
                'Custom Text': textInput.value.trim() || 'Your Brand',
                'Illumination Type': illuminationSelect.options[illuminationSelect.selectedIndex].textContent.trim(),
                'Size': sizeSelect.options[sizeSelect.selectedIndex].textContent.trim(),
                'Material': materialSelect.options[materialSelect.selectedIndex].textContent.trim(),
                'Acrylic Thickness': thicknessSelect.options[thicknessSelect.selectedIndex].textContent.trim(),
                'Front Colour': colourNameLabel.textContent.trim(),
                'Finish': finishSelect.options[finishSelect.selectedIndex].textContent.trim(),
                'Mounting': mountingSelect.options[mountingSelect.selectedIndex].textContent.trim(),
                'Add-ons': selectedAddons || 'None',
                'Configured Total': '$' + currentTotal.toFixed(2)
            };

            addToCartBtn.disabled = true;
            setButtonLoadingText(addToCartBtn, 'Syncing price...');

            try {
                const productId = addToCartBtn.dataset.productId;

                const proxyResponse = await fetch('/apps/neon-pricing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ productId, price: currentTotal })
                });

                if (!proxyResponse.ok) throw new Error('Pricing sync failed');

                const proxyData = await proxyResponse.json();
                if (proxyData.error || !proxyData.variantId) throw new Error(proxyData.error || 'No variant returned');

                const priceMatchedVariantId = proxyData.variantId;
                const isNewVariant = proxyData.reused === false;

                setButtonLoadingText(addToCartBtn, 'Adding...');
                const routesRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

                const cartItemsComponents = document.querySelectorAll('cart-items-component');
                const sectionIds = [];
                cartItemsComponents.forEach((el) => {
                    if (el.dataset && el.dataset.sectionId) sectionIds.push(el.dataset.sectionId);
                });

                const addResult = await addItemToCartWithRetry(
                    routesRoot,
                    priceMatchedVariantId,
                    properties,
                    sectionIds,
                    isNewVariant ? 3 : 0
                );

                addToCartBtn.textContent = 'Added ✓';
                showTemporaryStatus(addToCartStatus, 'Added to cart at the correct configured price!', 4000);

                try {
                    const themeEvents = await import('@theme/events');
                    document.dispatchEvent(new themeEvents.CartAddEvent({}, '3d-sign-configurator', {
                        source: 'product-form-component',
                        itemCount: 1,
                        productId,
                        sections: addResult.sections
                    }));
                } catch (themeEventError) {
                    console.warn('3D Sign Configurator: could not notify theme cart UI.', themeEventError);
                }

                document.dispatchEvent(new CustomEvent('cart:refresh'));
            } catch (error) {
                console.error('3D Sign Configurator Add to Cart error:', error);
                addToCartBtn.textContent = 'Error - try again';
                showTemporaryStatus(addToCartStatus, 'Something went wrong. Please try again.', 5000);
            } finally {
                setTimeout(() => {
                    addToCartBtn.disabled = false;
                    addToCartBtn.textContent = 'Add to Cart';
                }, 2000);
            }
        });
    }

    if (undoBtn) undoBtn.addEventListener('click', undo);
    if (redoBtn) redoBtn.addEventListener('click', redo);
    if (resetColourBtn) resetColourBtn.addEventListener('click', resetColourToDefault);
    if (resetScaleSizeBtn) resetScaleSizeBtn.addEventListener('click', resetScaleAndSizeToDefault);
    if (resetFontBtn) resetFontBtn.addEventListener('click', resetFontToDefault);

    updatePreviewText();
    updatePreviewFont();
    updatePreviewColour();
    updatePreviewScale();
    calculateTotal();
    pushHistory();
    updateUndoRedoButtons();
}