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

function initConfigurator(root) {
    const previewText = root.querySelector('[data-preview-text]');
    const textInput = root.querySelector('[data-text-input]');
    const fontSelect = root.querySelector('[data-font-select]');
    const swatches = root.querySelectorAll('[data-colour-swatches] .neon-configurator__swatch');
    const colourNameLabel = root.querySelector('[data-colour-name-label]');
    const sizeSelect = root.querySelector('[data-size-select]');
    const backboardStyleSelect = root.querySelector('[data-backboard-style-select]');
    const backboardColourSelect = root.querySelector('[data-backboard-colour-select]');
    const addonCheckboxes = root.querySelectorAll('[data-addon-checkbox]');
    const totalPriceEl = root.querySelector('[data-total-price]');
    const previewInner = root.querySelector('[data-preview-inner]');
    const previewStage = root.querySelector('[data-preview-stage]');
    const widthLabel = root.querySelector('[data-width-label]');
    const heightLabel = root.querySelector('[data-height-label]');
    const powerToggle = root.querySelector('[data-power-toggle]');
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
    const BACKBOARD_SHAPES = ['rectangle', 'cut-around', 'cut-to-letter', 'naked'];

    const powerAdapterSelect = root.querySelector('[data-power-adapter-select]');
    const addToCartBtn = root.querySelector('[data-add-to-cart]');
    const addToCartStatus = root.querySelector('[data-add-to-cart-status]');
    let textOffsetX = 0;
    let textOffsetY = 0;
    let textRotation = 0;

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

    function renderMulticolourText() {
        previewText.innerHTML = '';
        const value = textInput.value.trim() || 'Your Text';
        const hexList = swatches.length ? Array.from(swatches).map((s) => s.dataset.colourHex) : ['#ffffff'];
        value.split('').forEach((ch, i) => {
            if (!letterColours[i]) letterColours[i] = hexList[0];
            const span = document.createElement('span');
            span.textContent = ch;
            span.style.color = letterColours[i];
            span.addEventListener('click', (event) => {
                event.stopPropagation();
                openLetterPopup(i, span, ch);
            });
            previewText.appendChild(span);
        });
        closeLetterPopup();
    }

    function updatePreviewText() {
        if (currentEffectMode === 'multicolour') {
            renderMulticolourText();
        } else {
            const value = textInput.value.trim();
            previewText.textContent = value.length ? value : 'Your Text';
        }
    }

    function updatePreviewFont() {
        previewText.style.fontFamily = fontSelect.value;
    }

    function updatePreviewTransform() {
        previewText.style.transform = 'translate(' + textOffsetX + 'px, ' + textOffsetY + 'px) rotate(' + textRotation + 'deg)';
    }

    function updateRotationLabel() {
        if (rotationValueLabel) rotationValueLabel.textContent = textRotation + '°';
    }

    function enableTextDrag() {
        if (!previewText || !previewStage) return;

        let dragStartX = 0;
        let dragStartY = 0;
        let initialOffsetX = 0;
        let initialOffsetY = 0;

        previewText.addEventListener('pointerdown', (event) => {
            // In Multicoloured Text mode, letters must be individually clickable —
            // skip capturing the pointer so per-letter click events aren't intercepted.
            if (currentEffectMode === 'multicolour') return;

            event.preventDefault();
            previewText.setPointerCapture(event.pointerId);
            previewText.classList.add('is-dragging');
            dragStartX = event.clientX;
            dragStartY = event.clientY;
            initialOffsetX = textOffsetX;
            initialOffsetY = textOffsetY;
        });

        previewText.addEventListener('pointermove', (event) => {
            if (!previewText.hasPointerCapture(event.pointerId)) return;
            textOffsetX = initialOffsetX + event.clientX - dragStartX;
            textOffsetY = initialOffsetY + event.clientY - dragStartY;
            updatePreviewTransform();
        });

        const stopDragging = (event) => {
            if (previewText.hasPointerCapture(event.pointerId)) previewText.releasePointerCapture(event.pointerId);
            previewText.classList.remove('is-dragging');
        };

        previewText.addEventListener('pointerup', stopDragging);
        previewText.addEventListener('pointercancel', stopDragging);
    }
    function updatePreviewColour() {
        if (currentEffectMode !== 'multicolour') {
            previewText.style.color = selectedColourHex;
        }
        if (iconsContainer) {
            iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((el) => {
                el.style.color = selectedColourHex;
            });
        }
    }

    function renderIcons() {
        if (!iconsContainer) return;
        iconsContainer.innerHTML = '';
        selectedSymbols.forEach((sym) => {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'neon-configurator__preview-icon';
            iconSpan.style.webkitMaskImage = 'url("' + sym.url + '")';
            iconSpan.style.maskImage = 'url("' + sym.url + '")';
            iconSpan.style.color = selectedColourHex;
            iconSpan.title = sym.label;
            iconsContainer.appendChild(iconSpan);
        });
    }

    function updatePreviewScale() {
        let widthCm;
        let heightCm;
        let unit = 'cm';

        if (customSizeActive && customSizeSlider) {
            widthCm = parseFloat(customSizeSlider.value) || 60;
            const heightRatio = parseFloat(customSizeSlider.dataset.heightRatio) || 2.6;
            heightCm = Math.round((widthCm / heightRatio) * 10) / 10;
            unit = customSizeSlider.dataset.unit || 'cm';

            if (sliderWidthLabel) sliderWidthLabel.textContent = 'Width: ' + widthCm + ' ' + unit;
            if (sliderHeightLabel) sliderHeightLabel.textContent = 'Height: ' + heightCm + ' ' + unit;
        } else {
            const sizeOption = sizeSelect.options[sizeSelect.selectedIndex];
            widthCm = parseFloat(sizeOption?.value) || 60;
            heightCm = parseFloat(sizeOption?.dataset.height) || Math.round(widthCm / 2.6);
        }

        // Scale font size proportionally to width, clamped to a sensible range
        const fontSize = Math.min(90, Math.max(22, widthCm * 0.42));
        previewText.style.fontSize = fontSize + 'px';

        if (widthLabel) {
            widthLabel.textContent = widthCm + ' ' + unit;
        }
        if (heightLabel) {
            heightLabel.textContent = heightCm + ' ' + unit;
        }
    }

    function updateBackboardPanel() {
        if (!previewInner) return;

        const styleOption = backboardStyleSelect?.options[backboardStyleSelect.selectedIndex];
        const shape = styleOption?.dataset.shape || 'rectangle';

        BACKBOARD_SHAPES.forEach((s) => previewInner.classList.remove('backboard--' + s));
        previewInner.classList.add('backboard--' + shape);

        const colourOption = backboardColourSelect?.options[backboardColourSelect.selectedIndex];
        const hex = colourOption?.dataset.hex || '#e8e8e8';
        previewInner.style.backgroundColor = hex;
    }

    function updatePowerState() {
        if (!previewInner) return;
        if (powerToggle && !powerToggle.checked) {
            previewInner.classList.add('is-off');
        } else {
            previewInner.classList.remove('is-off');
        }
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

    enableTextDrag();

    textInput.addEventListener('input', () => {
        updatePreviewText();
    });

    fontSelect.addEventListener('change', () => {
        updatePreviewFont();
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
                'Text Position': 'X: ' + Math.round(textOffsetX) + 'px, Y: ' + Math.round(textOffsetY) + 'px',
                'Text Rotation': textRotation + '°'
            };

            if (powerAdapterSelect) {
                properties['Power Adapter'] = powerAdapterSelect.options[powerAdapterSelect.selectedIndex].textContent.trim();
            }

            properties['Quick Symbols'] = selectedSymbols.length
                ? selectedSymbols.map((s) => s.label).join(', ')
                : 'None';

            addToCartBtn.disabled = true;
            addToCartBtn.textContent = 'Syncing price...';

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

                // Step 2: Add that exact-price variant to the cart
                addToCartBtn.textContent = 'Adding...';
                const routesRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

                // Mirror the theme's own product-form flow: ask cart/add.js to also render
                // any cart-items-component sections present on the page, so the theme's cart
                // drawer/icon can update themselves without a manual page refresh.
                const cartItemsComponents = document.querySelectorAll('cart-items-component');
                const sectionIds = [];
                cartItemsComponents.forEach((el) => {
                    if (el.dataset && el.dataset.sectionId) sectionIds.push(el.dataset.sectionId);
                });

                const response = await fetch(routesRoot + 'cart/add.js', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items: [{ id: parseInt(priceMatchedVariantId, 10), quantity: 1, properties }],
                        sections: sectionIds.join(',')
                    })
                });

                if (!response.ok) throw new Error('Add to cart failed');

                const addResult = await response.json();

                addToCartBtn.textContent = 'Added ✓';
                if (addToCartStatus) {
                    addToCartStatus.textContent = 'Added to cart at the correct configured price!';
                }

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
                if (addToCartStatus) {
                    addToCartStatus.textContent = 'Something went wrong. Please try again.';
                }
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
    updateBackboardPanel();
    calculateTotal();
}
