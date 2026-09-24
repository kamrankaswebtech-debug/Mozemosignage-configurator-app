// Mozemo Signage - Neon Configurator: live preview + dynamic pricing
function initAllNeonConfigurators() {
    document.querySelectorAll('.neon-configurator').forEach((root) => {
        if (root.dataset.neonConfiguratorInitialized === 'true') return;
        try {
            initConfigurator(root);
            root.dataset.neonConfiguratorInitialized = 'true';
        } catch (err) {
            console.error('Neon Configurator: init failed for this block:', err, root);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllNeonConfigurators);
} else {
    // Script loaded after DOMContentLoaded already fired (e.g. dynamic section re-render)
    initAllNeonConfigurators();
}

// Re-run whenever theme dynamically swaps content (variant change, section re-render, etc.)
document.addEventListener('shopify:section:load', initAllNeonConfigurators);
document.addEventListener('cart:refresh', initAllNeonConfigurators);

// Shopify can take a brief moment to make a brand-new variant (created via the Admin API)
// fully available to the storefront cart endpoint. Retrying a couple of times with a short
// delay — only for freshly-created variants — avoids showing the customer a false error.
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
            // Wait a bit longer each retry (900ms, then 1400ms, then 1900ms) —
            // a brand-new variant needs a moment to fully propagate to the storefront cart endpoint.
            const delay = 900 + (attempt * 500);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

// Shows a spinning loader inside the button next to the given text.
function setButtonLoadingText(button, text) {
    button.innerHTML = '<span class="neon-configurator__spinner"></span><span>' + text + '</span>';
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

function initConfigurator(root) {
    const textFlex = root.querySelector('[data-text-flex]');
    const textInput = root.querySelector('[data-text-input]');
    const fontSelect = root.querySelector('[data-font-select]');
    const fontCards = root.querySelectorAll('[data-font-cards] .neon-configurator__font-card');
    const swatches = root.querySelectorAll('[data-colour-swatches] .neon-configurator__swatch');
    const colourNameLabel = root.querySelector('[data-colour-name-label]');
    const sizeSelect = root.querySelector('[data-size-select]');
    const backboardStyleSelect = root.querySelector('[data-backboard-style-select]');
    const backboardStyleCards = root.querySelectorAll('[data-backboard-style-cards] .neon-configurator__style-card');
    const backboardColourSelect = root.querySelector('[data-backboard-colour-select]');
    const addonCheckboxes = root.querySelectorAll('[data-addon-checkbox]');
    const totalPriceEl = root.querySelector('[data-total-price]');
    const previewInner = root.querySelector('[data-preview-inner]');
    const shapeSource = root.querySelector('[data-shape-source]');
    const textWrap = root.querySelector('[data-text-wrap]');
    const previewStage = root.querySelector('[data-preview-stage]');
    const widthLabel = root.querySelector('[data-width-label]');
    const heightLabel = root.querySelector('[data-height-label]');
    const widthDimLine = root.querySelector('.neon-configurator__dim-line--width');
    const heightDimLine = root.querySelector('.neon-configurator__dim-line--height');
    const powerToggle = root.querySelector('[data-power-toggle]');
    const powerLabel = root.querySelector('[data-power-label]');
    const measurementsToggle = root.querySelector('[data-measurements-toggle]');
    const measurementsLabel = root.querySelector('[data-measurements-label]');
    const wallpaperToggle = root.querySelector('[data-wallpaper-toggle]');
    const wallpaperLabel = root.querySelector('[data-wallpaper-label]');
    const customSizeSlider = root.querySelector('[data-custom-size-slider]');
    const sliderWidthLabel = root.querySelector('[data-slider-width-value]');
    const sliderHeightLabel = root.querySelector('[data-slider-height-value]');
    const sliderUnitLabel = root.querySelector('[data-slider-unit-label]');
    const unitTabs = root.querySelectorAll('[data-unit-tab]');
    const rotationSlider = root.querySelector('[data-rotation-slider]');
    const rotationValueLabel = root.querySelector('[data-rotation-value]');
    let customSizeActive = false;
    const effectModeRadios = root.querySelectorAll('[data-effect-mode-radio]');
    const colourField = root.querySelector('[data-colour-field]');
    // Read whichever radio is actually checked in the DOM — not just the first one in loop order —
    // so JS state always matches what the customer visually sees.
    const initiallyCheckedRadio = root.querySelector('[data-effect-mode-radio]:checked');
    let currentEffectMode = initiallyCheckedRadio ? initiallyCheckedRadio.value : (effectModeRadios.length ? effectModeRadios[0].value : 'single');
    let letterColours = [];
    const symbolButtons = root.querySelectorAll('[data-symbol-buttons] .neon-configurator__symbol-btn');
    const iconsContainer = root.querySelector('[data-preview-icons]');
    let selectedSymbols = [];
    const previewBox = root.querySelector('[data-preview-box]');
    const bgThumbs = root.querySelectorAll('[data-bg-thumbs] .neon-configurator__bg-thumb');
    let selectedColourHex = swatches.length ? swatches[0].dataset.colourHex : '#ffffff';
    let selectedColourPrice = swatches.length ? parseFloat(swatches[0].dataset.colourPrice) || 0 : 0;
    let currentTotal = 0;
    let currentWidthCm = 0;
    let currentHeightCm = 0;
    const BACKBOARD_SHAPES = ['rectangle', 'cut-around', 'cut-to-letter', 'naked', 'open-box', 'acrylic-stand-middle'];

    const powerAdapterSelect = root.querySelector('[data-power-adapter-select]');
    const addToCartBtn = root.querySelector('[data-add-to-cart]');
    const addToCartStatus = root.querySelector('[data-add-to-cart-status]');
    let textRotation = 0;

    // --- Installation Option + Booking ---
    const installRadios = root.querySelectorAll('[data-install-radio]');
    const installBooking = root.querySelector('[data-install-booking]');
    const installDateInput = root.querySelector('[data-install-date]');
    const installTimeSelect = root.querySelector('[data-install-time]');
    const installAddressInput = root.querySelector('[data-install-address]');
    let installationSelected = false;
    let installationPrice = 0;

    function populateInstallTimeSlots() {
        if (!installTimeSelect || !installBooking) return;
        const earliest = installBooking.dataset.earliestTime || '10:00';
        const latest = installBooking.dataset.latestTime || '17:00';
        const interval = parseInt(installBooking.dataset.slotInterval, 10) || 60;

        const [startH, startM] = earliest.split(':').map(Number);
        const [endH, endM] = latest.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        installTimeSelect.innerHTML = '';
        for (let m = startMinutes; m <= endMinutes; m += interval) {
            const h24 = Math.floor(m / 60);
            const mm = m % 60;
            const period = h24 >= 12 ? 'PM' : 'AM';
            const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
            const label = h12 + ':' + String(mm).padStart(2, '0') + ' ' + period;
            const option = document.createElement('option');
            option.value = label;
            option.textContent = label;
            installTimeSelect.appendChild(option);
        }
    }

    function setInstallMinDate() {
        if (!installDateInput || !installBooking) return;
        const leadDays = parseInt(installBooking.dataset.minLeadDays, 10) || 14;
        const minDate = new Date();
        minDate.setDate(minDate.getDate() + leadDays);
        const isoMin = minDate.toISOString().split('T')[0];
        installDateInput.min = isoMin;
        if (!installDateInput.value) installDateInput.value = isoMin;
    }

    installRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            installationSelected = radio.value === 'yes';
            installationPrice = installationSelected ? (parseFloat(radio.dataset.installPrice) || 0) : 0;
            if (installBooking) installBooking.hidden = !installationSelected;
            if (installationSelected) {
                setInstallMinDate();
                if (installTimeSelect && !installTimeSelect.options.length) populateInstallTimeSlots();
            }
            calculateTotal();
        });
    });

    if (installBooking) populateInstallTimeSlots();

    // --- Neon Type (Indoor/Outdoor) + Outdoor Thickness + Size Visibility ---
    const neonTypeCards = root.querySelectorAll('[data-neon-type-cards] .neon-configurator__neon-type-card');
    const outdoorThicknessField = root.querySelector('[data-outdoor-thickness-field]');
    const outdoorThicknessSelect = root.querySelector('[data-outdoor-thickness-select]');
    const sizeVisibilityFields = root.querySelectorAll('[data-size-field]');
    const initiallySelectedNeonTypeCard = Array.from(neonTypeCards).find((c) => c.classList.contains('is-selected'));
    let currentNeonType = initiallySelectedNeonTypeCard ? initiallySelectedNeonTypeCard.dataset.neonTypeKey : 'indoor';
    let currentNeonTypePrice = initiallySelectedNeonTypeCard ? (parseFloat(initiallySelectedNeonTypeCard.dataset.neonTypePrice) || 0) : 0;

    function updateOutdoorThicknessVisibility() {
        if (!outdoorThicknessField) return;
        outdoorThicknessField.hidden = currentNeonType !== 'outdoor';
    }

    function updateSizeFieldsVisibility() {
        sizeVisibilityFields.forEach((field) => {
            const attr = currentNeonType === 'outdoor' ? 'visibleOutdoor' : 'visibleIndoor';
            const isVisible = field.dataset[attr] !== 'false';
            field.hidden = !isVisible;

            // If the Custom Size Slider just got hidden while it was the active size source,
            // fall back to the preset "Choose Size" dropdown so pricing/preview stays correct.
            if (field.dataset.sizeField === 'custom-slider' && !isVisible && customSizeActive) {
                customSizeActive = false;
                updatePreviewScale();
                calculateTotal();
            }
        });
    }

    function selectNeonType(card) {
        neonTypeCards.forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        currentNeonType = card.dataset.neonTypeKey;
        currentNeonTypePrice = parseFloat(card.dataset.neonTypePrice) || 0;
        updateOutdoorThicknessVisibility();
        updateSizeFieldsVisibility();
        calculateTotal();
    }

    neonTypeCards.forEach((card) => {
        card.addEventListener('click', () => selectNeonType(card));
    });

    if (outdoorThicknessSelect) {
        outdoorThicknessSelect.addEventListener('change', calculateTotal);
    }

    const selectionBox = root.querySelector('[data-selection-box]');
    let groupOffsetX = 0;
    let groupOffsetY = 0;
    let letterOffsets = [];
    let letterScales = [];
    let groupScale = 1;
    let baseFontSize = 48;
    let selectedLetterIndex = null;

    // 'letter' | 'icon' | null — tracks which system currently owns the shared selection box
    let activeSelectionKind = null;
    let iconOffsets = [];
    let iconScales = [];
    let iconGroupScale = 1;
    let selectedIconIndex = null;

    const letterPopup = root.querySelector('[data-letter-popup]');
    const letterPopupTitle = root.querySelector('[data-letter-popup-title]');
    const letterPopupSwatches = root.querySelector('[data-letter-popup-swatches]');
    let activeLetterIndex = null;
    let activeLetterSpan = null;

    function closeLetterPopup() {
        if (letterPopup) letterPopup.hidden = true;
        activeLetterIndex = null;
        activeLetterSpan = null;
    }

    function openLetterPopup(index, span, ch) {
        if (!letterPopup || !letterPopupSwatches || !previewStage) return;
        activeLetterIndex = index;
        activeLetterSpan = span;

        if (letterPopupTitle) {
            letterPopupTitle.textContent = 'Set colour for ' + ch;
        }

        const hexList = swatches.length ? Array.from(swatches).map((s) => s.dataset.colourHex) : ['#ffffff'];
        letterPopupSwatches.innerHTML = '';
        hexList.forEach((hex) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'neon-configurator__letter-popup-swatch';
            btn.style.backgroundColor = hex;
            if (letterColours[index] === hex) btn.classList.add('is-selected');
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                letterColours[index] = hex;
                if (activeLetterSpan) activeLetterSpan.style.color = hex;
                closeLetterPopup();
            });
            letterPopupSwatches.appendChild(btn);
        });

        const stageRect = previewStage.getBoundingClientRect();
        const letterRect = span.getBoundingClientRect();
        letterPopup.style.left = (letterRect.left - stageRect.left + letterRect.width / 2) + 'px';
        letterPopup.style.top = (letterRect.top - stageRect.top) + 'px';
        letterPopup.hidden = false;
    }

    document.addEventListener('click', (event) => {
        if (!letterPopup || letterPopup.hidden) return;
        if (letterPopup.contains(event.target)) return;
        if (activeLetterSpan && activeLetterSpan.contains(event.target)) return;
        closeLetterPopup();
    });

    function computeLetterTransform(i) {
        const off = letterOffsets[i] || { x: 0, y: 0 };
        const scale = letterScales[i] || 1;
        return 'translate(' + (groupOffsetX + off.x) + 'px, ' + (groupOffsetY + off.y) + 'px) scale(' + scale + ')';
    }

    function applyLetterTransform(span, i) {
        const transformStr = computeLetterTransform(i);
        span.style.transform = transformStr;
        // Keep the hidden shape-source clone's matching letter perfectly aligned —
        // same index, same transform — so the outline always hugs the real letter's
        // exact position, even after dragging/resizing an individual letter.
        if (shapeSource && shapeSource.children[i]) {
            shapeSource.children[i].style.transform = transformStr;
        }
    }

    function refreshAllLetterTransforms() {
        if (!textFlex) return;
        textFlex.querySelectorAll('.neon-configurator__letter').forEach((span) => {
            applyLetterTransform(span, Number(span.dataset.letterIndex));
        });
    }

    function hideSelectionBox() {
        if (selectionBox) selectionBox.hidden = true;
        if (textFlex) {
            textFlex.querySelectorAll('.neon-configurator__letter').forEach((s) => s.classList.remove('is-selected'));
        }
        if (iconsContainer) {
            iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((s) => s.classList.remove('is-selected'));
        }
        activeSelectionKind = null;
    }

    function showSelectionBoxAround(el) {
        if (!selectionBox || !previewStage || !el) return;
        const stageRect = previewStage.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        selectionBox.style.left = (elRect.left - stageRect.left - 6) + 'px';
        selectionBox.style.top = (elRect.top - stageRect.top - 6) + 'px';
        selectionBox.style.width = (elRect.width + 12) + 'px';
        selectionBox.style.height = (elRect.height + 12) + 'px';
        selectionBox.hidden = false;
    }

    function selectLetter(index) {
        hideSelectionBox();
        activeSelectionKind = 'letter';
        selectedLetterIndex = index;
        textFlex.querySelectorAll('.neon-configurator__letter').forEach((s) => {
            s.classList.toggle('is-selected', Number(s.dataset.letterIndex) === index);
        });
        const target = textFlex.querySelector('[data-letter-index="' + index + '"]');
        showSelectionBoxAround(target);
    }

    function selectGroup() {
        hideSelectionBox();
        activeSelectionKind = 'letter';
        selectedLetterIndex = null;
        showSelectionBoxAround(textFlex);
    }

    function applyIconTransform(span, i) {
        const off = iconOffsets[i] || { x: 0, y: 0 };
        const scale = iconScales[i] || 1;
        span.style.transform = 'translate(' + off.x + 'px, ' + off.y + 'px) scale(' + scale + ')';
    }

    function refreshAllIconTransforms() {
        if (!iconsContainer) return;
        iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((span) => {
            applyIconTransform(span, Number(span.dataset.iconIndex));
        });
    }

    function updateIconsContainerTransform() {
        if (!iconsContainer) return;
        iconsContainer.style.transform = 'rotate(' + textRotation + 'deg) scale(' + iconGroupScale + ')';
    }

    function selectIcon(index) {
        hideSelectionBox();
        activeSelectionKind = 'icon';
        selectedIconIndex = index;
        iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((s) => {
            s.classList.toggle('is-selected', Number(s.dataset.iconIndex) === index);
        });
        const target = iconsContainer.querySelector('[data-icon-index="' + index + '"]');
        showSelectionBoxAround(target);
    }

    function selectIconGroup() {
        hideSelectionBox();
        activeSelectionKind = 'icon';
        selectedIconIndex = null;
        showSelectionBoxAround(iconsContainer);
    }


























    function attachIconDrag(span, i) {
        let startX = 0;
        let startY = 0;
        let startOffX = 0;
        let startOffY = 0;
        let moved = false;

        span.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            span.setPointerCapture(event.pointerId);
            moved = false;
            const off = iconOffsets[i] || { x: 0, y: 0 };
            startOffX = off.x;
            startOffY = off.y;
            startX = event.clientX;
            startY = event.clientY;
        });

        span.addEventListener('pointermove', (event) => {
            if (!span.hasPointerCapture(event.pointerId)) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;

            iconOffsets[i] = { x: startOffX + dx, y: startOffY + dy };
            applyIconTransform(span, i);
            showSelectionBoxAround(span);
        });

        span.addEventListener('pointerup', (event) => {
            if (span.hasPointerCapture(event.pointerId)) span.releasePointerCapture(event.pointerId);
            if (!moved) {
                selectIcon(i);
            }
        });
    }

    function attachLetterDrag(span, i, ch) {
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
                if (currentEffectMode === 'multicolour') {
                    openLetterPopup(i, span, ch);
                    return;
                }
                if (selectedLetterIndex === i) {
                    selectGroup();
                } else {
                    selectLetter(i);
                }
            }
        });
    }

    function renderLetters() {
        if (!textFlex) return;
        const value = textInput.value.trim() || 'Your Text';

        if (letterOffsets.length !== value.length) {
            letterOffsets = value.split('').map(() => ({ x: 0, y: 0 }));
            letterScales = value.split('').map(() => 1);
            letterColours = value.split('').map((_, i) => letterColours[i] || (swatches.length ? swatches[0].dataset.colourHex : '#ffffff'));
            selectedLetterIndex = null;
        }

        textFlex.innerHTML = '';
        if (shapeSource) shapeSource.innerHTML = '';

        value.split('').forEach((ch, i) => {
            const span = document.createElement('span');
            span.className = 'neon-configurator__letter';
            span.textContent = ch === ' ' ? '\u00A0' : ch;
            span.dataset.letterIndex = i;
            span.style.color = currentEffectMode === 'multicolour' ? letterColours[i] : '';
            applyLetterTransform(span, i);
            attachLetterDrag(span, i, ch);
            textFlex.appendChild(span);

            // Mirror the exact same letter (same character, same wrapping position, same
            // transform) into the hidden shape-source — this is what makes the outline
            // hug the REAL text pixel-for-pixel instead of drifting/duplicating.
            if (shapeSource) {
                const shapeSpan = document.createElement('span');
                shapeSpan.className = 'neon-configurator__shape-letter';
                shapeSpan.textContent = ch === ' ' ? '\u00A0' : ch;
                shapeSpan.style.transform = computeLetterTransform(i);
                shapeSource.appendChild(shapeSpan);
            }
        });

        hideSelectionBox();
        closeLetterPopup();
        syncShapeSourceStyle();
    }

    function updatePreviewText() {
        renderLetters();
    }

    function updatePreviewFont() {
        if (textFlex) textFlex.style.fontFamily = fontSelect.value;
        syncShapeSourceStyle();
    }

    function updatePreviewTransform() {
        // Rotating the shared wrapper (text-wrap) rotates BOTH the real text and the hidden
        // outline clone together as one unit — simpler and guaranteed in sync.
        if (textWrap) textWrap.style.transform = 'rotate(' + textRotation + 'deg)';
        updateIconsContainerTransform();
    }

    // Keeps the hidden shape-source clone's font/size in sync with the REAL text — purely so
    // the outline always hugs the customer's actual current text/font/size. The clone's WIDTH
    // is no longer copied manually here: it lives inside .neon-configurator__text-wrap (CSS
    // Grid), which forces shape-source and text-flex to always share the identical rendered
    // width automatically — this is what guarantees identical text wrapping between the two
    // (fixes ghost/misaligned outline on wrapped multi-line text). Fully dynamic: called
    // automatically whenever text, font, size, or scale changes.
    function syncShapeSourceStyle() {
        if (!shapeSource) return;
        shapeSource.style.fontFamily = fontSelect.value;
        shapeSource.style.fontSize = (baseFontSize * groupScale) + 'px';
    }

    function updateRotationLabel() {
        if (rotationValueLabel) rotationValueLabel.textContent = textRotation + '°';
    }

    if (previewInner) {
        previewInner.addEventListener('pointerdown', (event) => {
            if (event.target === previewInner || event.target === textFlex || event.target === textWrap) {
                selectGroup();
            }
        });
        document.addEventListener('pointerdown', (event) => {
            if (!previewInner.contains(event.target)) {
                hideSelectionBox();
            }
        });
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
                const startScale = activeSelectionKind === 'icon'
                    ? (selectedIconIndex !== null ? (iconScales[selectedIconIndex] || 1) : iconGroupScale)
                    : (selectedLetterIndex !== null ? (letterScales[selectedLetterIndex] || 1) : groupScale);

                const onMove = (moveEvent) => {
                    const dist = Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY) || 1;
                    const factor = dist / startDist;
                    const newScale = Math.min(3, Math.max(0.3, startScale * factor));

                    if (activeSelectionKind === 'icon') {
                        if (selectedIconIndex !== null) {
                            iconScales[selectedIconIndex] = newScale;
                            const span = iconsContainer.querySelector('[data-icon-index="' + selectedIconIndex + '"]');
                            applyIconTransform(span, selectedIconIndex);
                            showSelectionBoxAround(span);
                        } else {
                            iconGroupScale = newScale;
                            updateIconsContainerTransform();
                            showSelectionBoxAround(iconsContainer);
                        }
                    } else if (selectedLetterIndex !== null) {
                        letterScales[selectedLetterIndex] = newScale;
                        const span = textFlex.querySelector('[data-letter-index="' + selectedLetterIndex + '"]');
                        applyLetterTransform(span, selectedLetterIndex);
                        showSelectionBoxAround(span);
                    } else {
                        groupScale = newScale;
                        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';
                        showSelectionBoxAround(textFlex);
                        syncShapeSourceStyle();
                    }
                };

                const onUp = (upEvent) => {
                    handle.releasePointerCapture(upEvent.pointerId);
                    handle.removeEventListener('pointermove', onMove);
                    handle.removeEventListener('pointerup', onUp);
                };

                handle.addEventListener('pointermove', onMove);
                handle.addEventListener('pointerup', onUp);
            });
        });
    }

    function updatePreviewColour() {
        if (currentEffectMode !== 'multicolour' && textFlex) {
            textFlex.style.color = selectedColourHex;
        }
        if (iconsContainer) {
            iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((el) => {
                el.style.color = selectedColourHex;
            });
        }
    }

    function renderIcons() {
        if (!iconsContainer) return;

        if (iconOffsets.length !== selectedSymbols.length) {
            iconOffsets = selectedSymbols.map(() => ({ x: 0, y: 0 }));
            iconScales = selectedSymbols.map(() => 1);
            selectedIconIndex = null;
        }

        iconsContainer.innerHTML = '';
        selectedSymbols.forEach((sym, i) => {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'neon-configurator__preview-icon';
            iconSpan.dataset.iconIndex = i;
            iconSpan.style.webkitMaskImage = 'url("' + sym.url + '")';
            iconSpan.style.maskImage = 'url("' + sym.url + '")';
            iconSpan.style.color = selectedColourHex;
            iconSpan.title = sym.label;
            applyIconTransform(iconSpan, i);
            attachIconDrag(iconSpan, i);
            iconsContainer.appendChild(iconSpan);
        });

        if (activeSelectionKind === 'icon') hideSelectionBox();
        updatePowerState();
    }

    function updatePreviewScale() {
        let widthValue;
        let heightValue;
        let unit = 'cm';

        if (customSizeActive && customSizeSlider) {
            widthValue = parseFloat(customSizeSlider.value) || 60;
            const heightRatio = parseFloat(customSizeSlider.dataset.heightRatio) || 2.6;
            heightValue = Math.round((widthValue / heightRatio) * 10) / 10;
            unit = customSizeSlider.dataset.unit || 'cm';

            if (sliderWidthLabel) sliderWidthLabel.textContent = 'Width: ' + widthValue + ' ' + unit;
            if (sliderHeightLabel) sliderHeightLabel.textContent = 'Height: ' + heightValue + ' ' + unit;
        } else {
            const sizeOption = sizeSelect.options[sizeSelect.selectedIndex];
            widthValue = parseFloat(sizeOption?.value) || 60;
            heightValue = parseFloat(sizeOption?.dataset.height) || Math.round(widthValue / 2.6);
        }

        // Scale font size proportionally to width, clamped to a sensible range
        baseFontSize = Math.min(90, Math.max(22, widthValue * 0.42));
        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';
        syncShapeSourceStyle();

        if (widthLabel) {
            widthLabel.textContent = widthValue + ' ' + unit;
        }
        if (heightLabel) {
            heightLabel.textContent = heightValue + ' ' + unit;
        }

        // The manufacturer blueprint PDF always expects width/height in centimetres,
        // regardless of which unit the customer used on the custom size slider.
        const UNIT_TO_CM = { cm: 1, mm: 0.1, inch: 2.54, ft: 30.48 };
        const cmFactor = UNIT_TO_CM[unit] || 1;
        currentWidthCm = Math.round(widthValue * cmFactor * 10) / 10;
        currentHeightCm = Math.round(heightValue * cmFactor * 10) / 10;
    }

    // Keeps the Width/Height dimension lines hugging the ACTUAL rendered sign box
    // (previewInner) instead of a fixed CSS position — so the width line grows/shrinks
    // exactly with the customer's real text length (including after wrapping to a new
    // line), and the height line reflects the real rendered height instead of a fixed
    // oversized line. Driven by a ResizeObserver on previewInner so it stays correct
    // automatically for every cause of a size change (typing, font, wrap, backboard
    // style/padding, size slider) without needing a manual call at every call site.
    function updateDimensionLines() {
        if (!previewStage || !previewInner) return;
        const stageRect = previewStage.getBoundingClientRect();
        const innerRect = previewInner.getBoundingClientRect();
        if (!innerRect.width || !innerRect.height) return;

        if (widthDimLine) {
            widthDimLine.style.left = (innerRect.left - stageRect.left) + 'px';
            widthDimLine.style.width = innerRect.width + 'px';
            widthDimLine.style.top = (innerRect.bottom - stageRect.top + 14) + 'px';
        }
        if (heightDimLine) {
            heightDimLine.style.top = (innerRect.top - stageRect.top) + 'px';
            heightDimLine.style.height = innerRect.height + 'px';
            heightDimLine.style.left = (innerRect.right - stageRect.left + 14) + 'px';
        }
    }

    let dimResizeObserver = null;
    function setupDimensionObserver() {
        if (!previewInner || typeof ResizeObserver === 'undefined') return;
        dimResizeObserver = new ResizeObserver(() => updateDimensionLines());
        dimResizeObserver.observe(previewInner);
        window.addEventListener('resize', updateDimensionLines);
    }

    function updateBackboardPanel() {
        if (!previewInner) return;

        const styleOption = backboardStyleSelect?.options[backboardStyleSelect.selectedIndex];
        const shape = styleOption?.dataset.shape || 'rectangle';

        BACKBOARD_SHAPES.forEach((s) => previewInner.classList.remove('backboard--' + s));
        previewInner.classList.add('backboard--' + shape);

        const colourOption = backboardColourSelect?.options[backboardColourSelect.selectedIndex];
        const hex = colourOption?.dataset.hex || '#e8e8e8';

        // Colour is the OUTLINE/edge line only — never a filled block — exactly like the
        // client's reference PDFs. This CSS variable feeds the plain-border shapes
        // (rectangle/open-box/acrylic-stand's base line) AND the SVG filter's flood-colour below.
        root.style.setProperty('--moz-backboard-color', hex);

        // The outline for Cut Around / Cut to Letter / Acrylic Stand is drawn on the hidden,
        // glow-free clone of the text (data-shape-source) — NOT on the real glowing letters —
        // because the neon glow (text-shadow) would otherwise pollute the shape's alpha channel
        // and make the SVG filter render a solid block instead of a thin contour-hugging line.
        const blockId = root.dataset.blockId;
        if (shapeSource) {
            if (shape === 'cut-around' || shape === 'acrylic-stand-middle') {
                shapeSource.style.filter = 'url(#moz-outline-loose-' + blockId + ')';
                shapeSource.classList.add('is-active');
            } else if (shape === 'cut-to-letter') {
                shapeSource.style.filter = 'url(#moz-outline-tight-' + blockId + ')';
                shapeSource.classList.add('is-active');
            } else {
                shapeSource.style.filter = 'none';
                shapeSource.classList.remove('is-active');
            }
        }
    }

    function updatePowerState() {
        if (!previewInner) return;
        const isOn = !powerToggle || powerToggle.checked;
        previewInner.classList.toggle('is-off', !isOn);
        if (powerLabel) powerLabel.textContent = isOn ? 'LED On' : 'LED Off';

        // Defensive redundancy: also set glow directly via inline style on every
        // symbol icon currently in the preview, so the on/off difference is
        // guaranteed to apply immediately even for icons added after this toggle
        // was last changed (e.g. a symbol clicked while LED was already off).
        if (iconsContainer) {
            iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((el) => {
                if (isOn) {
                    // Written out explicitly (not just cleared to '') so the glow is
                    // GUARANTEED to render exactly like the text's glow, regardless
                    // of any other CSS on the page — inline styles set here always win.
                    el.style.filter = 'drop-shadow(0 0 4px #ffffff) drop-shadow(0 0 10px #ffffff) drop-shadow(0 0 20px currentColor) drop-shadow(0 0 40px currentColor)';
                    el.style.opacity = '1';
                } else {
                    // Off = plain colour only, no dimming — matches the text's off state exactly.
                    el.style.filter = 'none';
                    el.style.opacity = '1';
                }
            });
        }
    }

    // Measurements toggle: shows/hides the dimension lines and the selection box.
    function updateMeasurementsState() {
        if (!previewStage) return;
        const isOn = !measurementsToggle || measurementsToggle.checked;
        previewStage.classList.toggle('no-measurements', !isOn);
        if (measurementsLabel) measurementsLabel.textContent = isOn ? 'Measurements On' : 'Measurements Off';
        if (!isOn) hideSelectionBox();
    }

    // Wallpaper toggle: hides the selected background photo behind a clean, professional
    // gradient fallback. Toggling back ON restores the photo instantly — the inline
    // background-image set by applyDefaultBackground()/the bg-thumb clicks is never
    // removed, just visually overridden by CSS while this class is present.
    function updateWallpaperState() {
        if (!previewBox) return;
        const isOn = !wallpaperToggle || wallpaperToggle.checked;
        previewBox.classList.toggle('no-wallpaper', !isOn);
        if (wallpaperLabel) wallpaperLabel.textContent = isOn ? 'Wallpaper On' : 'Wallpaper Off';
    }

    function calculateTotal() {
        let total = 0;

        if (customSizeActive && customSizeSlider) {
            const widthValue = parseFloat(customSizeSlider.value) || 0;
            const pricePerUnit = parseFloat(customSizeSlider.dataset.pricePerUnit) || 0;
            total += widthValue * pricePerUnit;
        } else {
            const sizeOption = sizeSelect.options[sizeSelect.selectedIndex];
            total += parseFloat(sizeOption?.dataset.price) || 0;
        }

        total += selectedColourPrice;

        total += currentNeonTypePrice;
        if (currentNeonType === 'outdoor' && outdoorThicknessSelect) {
            const thicknessOption = outdoorThicknessSelect.options[outdoorThicknessSelect.selectedIndex];
            total += parseFloat(thicknessOption?.dataset.price) || 0;
        }

        const styleOption = backboardStyleSelect.options[backboardStyleSelect.selectedIndex];
        total += parseFloat(styleOption?.dataset.price) || 0;

        const backboardColourOption = backboardColourSelect.options[backboardColourSelect.selectedIndex];
        total += parseFloat(backboardColourOption?.dataset.price) || 0;

        addonCheckboxes.forEach((checkbox) => {
            if (checkbox.checked) {
                total += parseFloat(checkbox.dataset.price) || 0;
            }
        });

        const selectedEffectRadio = root.querySelector('[data-effect-mode-radio]:checked');
        total += parseFloat(selectedEffectRadio?.dataset.price) || 0;

        total += installationPrice;

        totalPriceEl.textContent = '$' + total.toFixed(2);
        currentTotal = total;
    }

    if (rotationSlider) {
        rotationSlider.addEventListener('input', () => {
            textRotation = Number(rotationSlider.value) || 0;
            updateRotationLabel();
            updatePreviewTransform();
        });
    }

    attachResizeHandles();

    textInput.addEventListener('input', () => {
        updatePreviewText();
    });

    function syncFontCards() {
        const selectedValue = fontSelect.value;
        fontCards.forEach((card) => {
            card.classList.toggle('is-selected', card.dataset.fontValue === selectedValue);
        });
    }

    fontCards.forEach((card) => {
        card.addEventListener('click', () => {
            const value = card.dataset.fontValue;
            const options = Array.from(fontSelect.options);
            const matchIndex = options.findIndex((opt) => opt.value === value);
            if (matchIndex === -1) return;
            fontSelect.selectedIndex = matchIndex;
            fontSelect.dispatchEvent(new Event('change'));
        });
    });

    fontSelect.addEventListener('change', () => {
        updatePreviewFont();
        syncFontCards();
    });

    swatches.forEach((swatch) => {
        swatch.addEventListener('click', () => {
            swatches.forEach((s) => s.classList.remove('is-selected'));
            swatch.classList.add('is-selected');
            selectedColourHex = swatch.dataset.colourHex;
            selectedColourPrice = parseFloat(swatch.dataset.colourPrice) || 0;
            colourNameLabel.textContent = swatch.dataset.colourName;
            updatePreviewColour();
            calculateTotal();
        });
    });

    [sizeSelect, backboardStyleSelect, backboardColourSelect].forEach((select) => {
        select.addEventListener('change', calculateTotal);
    });

    backboardStyleSelect.addEventListener('change', updateBackboardPanel);
    backboardColourSelect.addEventListener('change', updateBackboardPanel);

    // Keep the visible cards in sync with the hidden select (single source of truth for pricing/cart)
    function syncBackboardStyleCards() {
        const selectedLabel = backboardStyleSelect.value;
        backboardStyleCards.forEach((card) => {
            card.classList.toggle('is-selected', card.dataset.styleLabel === selectedLabel);
        });
    }

    backboardStyleCards.forEach((card) => {
        card.addEventListener('click', () => {
            const label = card.dataset.styleLabel;
            const options = Array.from(backboardStyleSelect.options);
            const matchIndex = options.findIndex((opt) => opt.value === label);
            if (matchIndex === -1) return;
            backboardStyleSelect.selectedIndex = matchIndex;
            backboardStyleSelect.dispatchEvent(new Event('change'));
            syncBackboardStyleCards();
        });
    });

    backboardStyleSelect.addEventListener('change', syncBackboardStyleCards);

    sizeSelect.addEventListener('change', () => {
        customSizeActive = false;
        updatePreviewScale();
        calculateTotal();
    });

    if (customSizeSlider) {
        customSizeSlider.addEventListener('input', () => {
            customSizeActive = true;
            updatePreviewScale();
            calculateTotal();
        });

        unitTabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                unitTabs.forEach((t) => t.classList.remove('is-selected'));
                tab.classList.add('is-selected');

                const newMin = parseFloat(tab.dataset.min) || 0;
                const newMax = parseFloat(tab.dataset.max) || 100;
                const newUnit = tab.dataset.unit || 'cm';

                customSizeSlider.min = newMin;
                customSizeSlider.max = newMax;
                customSizeSlider.value = newMin;
                customSizeSlider.dataset.unit = newUnit;
                customSizeSlider.dataset.pricePerUnit = tab.dataset.pricePerUnit || '0';
                customSizeSlider.dataset.heightRatio = tab.dataset.heightRatio || '2.6';

                if (sliderUnitLabel) sliderUnitLabel.textContent = newUnit;

                customSizeActive = true;
                updatePreviewScale();
                calculateTotal();
            });
        });

        const sliderDecreaseBtn = root.querySelector('[data-slider-decrease]');
        const sliderIncreaseBtn = root.querySelector('[data-slider-increase]');

        function stepSlider(direction) {
            const min = parseFloat(customSizeSlider.min);
            const max = parseFloat(customSizeSlider.max);
            const step = parseFloat(customSizeSlider.step) || 1;
            const current = parseFloat(customSizeSlider.value) || min;
            const next = Math.min(max, Math.max(min, current + (direction * step)));
            customSizeSlider.value = next;
            customSizeActive = true;
            updatePreviewScale();
            calculateTotal();
        }

        if (sliderDecreaseBtn) {
            sliderDecreaseBtn.addEventListener('click', () => stepSlider(-1));
        }
        if (sliderIncreaseBtn) {
            sliderIncreaseBtn.addEventListener('click', () => stepSlider(1));
        }
    }

    if (powerToggle) {
        powerToggle.addEventListener('change', updatePowerState);
    }
    if (measurementsToggle) {
        measurementsToggle.addEventListener('change', updateMeasurementsState);
    }
    if (wallpaperToggle) {
        wallpaperToggle.addEventListener('change', updateWallpaperState);
    }

    effectModeRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            currentEffectMode = radio.value;
            previewInner.classList.remove('effect--rgb', 'effect--multicolour');
            if (currentEffectMode === 'rgb') previewInner.classList.add('effect--rgb');
            if (currentEffectMode === 'multicolour') previewInner.classList.add('effect--multicolour');
            if (colourField) {
                colourField.style.display = currentEffectMode === 'multicolour' ? 'none' : '';
            }
            updatePreviewText();
            updatePreviewColour();
            calculateTotal();
        });
    });


    function applyDefaultBackground() {
        if (previewBox && bgThumbs.length) {
            previewBox.style.backgroundImage = "url('" + bgThumbs[0].dataset.bgUrl + "')";
        }
    }


    bgThumbs.forEach((thumb) => {
        thumb.addEventListener('click', () => {
            bgThumbs.forEach((t) => t.classList.remove('is-selected'));
            thumb.classList.add('is-selected');
            if (previewBox) {
                previewBox.style.backgroundImage = "url('" + thumb.dataset.bgUrl + "')";
            }
        });
    });

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
        });
    });

    addonCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', calculateTotal);
    });

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', async () => {
            const variantId = addToCartBtn.dataset.variantId;
            if (!variantId) {
                console.error('Neon Configurator: No variant ID found on Add to Cart button.');
                if (addToCartStatus) {
                    addToCartStatus.textContent = 'Unable to add to cart — product variant not found. Please refresh the page.';
                }
                return;
            }

            const selectedAddons = Array.from(addonCheckboxes)
                .filter((checkbox) => checkbox.checked)
                .map((checkbox) => checkbox.closest('label').querySelector('span').textContent.trim())
                .join(', ');

            const properties = {
                'Custom Text': textInput.value.trim() || 'Your Text',
                'Font': fontSelect.options[fontSelect.selectedIndex].textContent.trim(),
                'Colour': colourNameLabel.textContent.trim(),
                'Size': sizeSelect.options[sizeSelect.selectedIndex].textContent.trim(),
                'Backboard Style': backboardStyleSelect.options[backboardStyleSelect.selectedIndex].textContent.trim(),
                'Backboard Colour': backboardColourSelect.options[backboardColourSelect.selectedIndex].textContent.trim(),
                'Add-ons': selectedAddons || 'None',
                'Colour Effect': root.querySelector('[data-effect-mode-radio]:checked')?.nextElementSibling?.textContent.trim() || 'Single Colour',
                'Configured Total': '$' + currentTotal.toFixed(2),
                'Text Position': 'Group X: ' + Math.round(groupOffsetX) + 'px, Y: ' + Math.round(groupOffsetY) + 'px',
                'Text Rotation': textRotation + '°',
                '_blueprint_width_cm': currentWidthCm,
                '_blueprint_height_cm': currentHeightCm
            };

            if (neonTypeCards.length) {
                const selectedCard = Array.from(neonTypeCards).find((c) => c.classList.contains('is-selected'));
                properties['Neon Type'] = selectedCard ? selectedCard.dataset.neonTypeLabel : 'Indoor';
                if (currentNeonType === 'outdoor' && outdoorThicknessSelect) {
                    properties['Outdoor Thickness'] = outdoorThicknessSelect.options[outdoorThicknessSelect.selectedIndex].textContent.trim();
                }
            }

            if (powerAdapterSelect) {
                properties['Power Adapter'] = powerAdapterSelect.options[powerAdapterSelect.selectedIndex].textContent.trim();
            }

            properties['Quick Symbols'] = selectedSymbols.length
                ? selectedSymbols.map((s) => s.label).join(', ')
                : 'None';

            if (installationSelected) {
                properties['Installation'] = 'Yes, professional installation requested';
                properties['Installation Date'] = installDateInput ? installDateInput.value : '';
                properties['Installation Time'] = installTimeSelect ? installTimeSelect.value : '';
                properties['Installation Address'] = (installAddressInput && installAddressInput.value.trim())
                    ? installAddressInput.value.trim()
                    : 'Same as shipping address';
            } else {
                properties['Installation'] = 'No installation — customer will arrange';
            }

            addToCartBtn.disabled = true;
            setButtonLoadingText(addToCartBtn, 'Syncing price...');

            try {
                const productId = addToCartBtn.dataset.productId;

                // Step 1: Get (or create) the variant that matches the exact configured price
                const proxyResponse = await fetch('/apps/neon-pricing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ productId, price: currentTotal })
                });

                if (!proxyResponse.ok) {
                    throw new Error('Pricing sync failed');
                }

                const proxyData = await proxyResponse.json();
                if (proxyData.error || !proxyData.variantId) {
                    throw new Error(proxyData.error || 'No variant returned');
                }

                const priceMatchedVariantId = proxyData.variantId;
                const isNewVariant = proxyData.reused === false;

                // Step 2: Add that exact-price variant to the cart
                setButtonLoadingText(addToCartBtn, 'Adding...');
                const routesRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

                // Mirror the theme's own product-form flow: ask cart/add.js to also render
                // any cart-items-component sections present on the page, so the theme's cart
                // drawer/icon can update themselves without a manual page refresh.
                const cartItemsComponents = document.querySelectorAll('cart-items-component');
                const sectionIds = [];
                cartItemsComponents.forEach((el) => {
                    if (el.dataset && el.dataset.sectionId) sectionIds.push(el.dataset.sectionId);
                });

                // A brand-new variant can take a moment to become available to this endpoint —
                // retry a couple of times automatically before treating it as a real failure.
                const addResult = await addItemToCartWithRetry(
                    routesRoot,
                    priceMatchedVariantId,
                    properties,
                    sectionIds,
                    isNewVariant ? 3 : 0
                );

                addToCartBtn.textContent = 'Added ✓';
                showTemporaryStatus(addToCartStatus, 'Added to cart at the correct configured price!', 4000);

                // Tell the theme's own cart icon / cart drawer to update themselves —
                // same event the theme's native product forms dispatch on a successful add.
                try {
                    const themeEvents = await import('@theme/events');
                    document.dispatchEvent(new themeEvents.CartAddEvent({}, 'neon-configurator', {
                        source: 'product-form-component',
                        itemCount: 1,
                        productId,
                        sections: addResult.sections
                    }));
                } catch (themeEventError) {
                    console.warn('Neon Configurator: could not notify theme cart UI.', themeEventError);
                }

                document.dispatchEvent(new CustomEvent('cart:refresh'));
            } catch (error) {
                console.error('Neon Configurator Add to Cart error:', error);
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

    // Initial render
    applyDefaultBackground();
    updatePreviewText();
    updatePreviewFont();
    updatePreviewColour();
    updatePreviewScale();
    updatePowerState();
    updateMeasurementsState();
    updateWallpaperState();
    syncShapeSourceStyle();
    updateBackboardPanel();
    syncBackboardStyleCards();
    syncFontCards();
    updateOutdoorThicknessVisibility();
    updateSizeFieldsVisibility();
    calculateTotal();
    setupDimensionObserver();
    updateDimensionLines();
}
