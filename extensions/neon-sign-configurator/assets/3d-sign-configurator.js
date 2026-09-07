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
    const moveBadge = root.querySelector('[data-move-badge]');
    const alignButtons = root.querySelectorAll('[data-align-btn]');
    let textOffsetX = 0;
    let textOffsetY = 0;

    let selectedColourHex = swatches.length ? swatches[0].dataset.colourHex : '#ffffff';
    let selectedColourPrice = swatches.length ? parseFloat(swatches[0].dataset.colourPrice) || 0 : 0;
    let currentTotal = 0;

    function updatePreviewText() {
        const value = textInput.value.trim();
        previewText.textContent = value.length ? value : 'Your Brand';
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
        if (fontSelect) previewText.style.fontFamily = fontSelect.value;
    }

    function updatePreviewTransform() {
        previewText.style.transform = 'translate(' + textOffsetX + 'px, ' + textOffsetY + 'px)';
    }

    function updatePreviewScale() {
        const sizeOption = sizeSelect.options[sizeSelect.selectedIndex];
        const widthCm = parseFloat(sizeOption?.value) || 60;
        const heightCm = parseFloat(sizeOption?.dataset.height) || Math.round(widthCm / 2.6);

        const fontSize = Math.min(80, Math.max(20, widthCm * 0.4));
        previewText.style.fontSize = fontSize + 'px';

        if (widthLabel) widthLabel.textContent = widthCm + ' cm';
        if (heightLabel) heightLabel.textContent = heightCm + ' cm';
    }

    function enableTextDrag() {
        if (!previewText || !previewStage) return;

        let dragStartX = 0;
        let dragStartY = 0;
        let initialOffsetX = 0;
        let initialOffsetY = 0;

        previewText.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            previewText.setPointerCapture(event.pointerId);
            previewText.classList.add('is-dragging');
            if (previewInner) previewInner.classList.add('is-selected');
            if (moveBadge) moveBadge.hidden = false;
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

        document.addEventListener('click', (event) => {
            if (previewText.contains(event.target)) return;
            if (previewInner) previewInner.classList.remove('is-selected');
            if (moveBadge) moveBadge.hidden = true;
        });
    }

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

    textInput.addEventListener('input', updatePreviewText);

    if (fontSelect) {
        fontSelect.addEventListener('change', updatePreviewFont);
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
        });
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

    [illuminationSelect, sizeSelect, materialSelect, thicknessSelect, finishSelect, mountingSelect].forEach((select) => {
        select.addEventListener('change', calculateTotal);
    });

    sizeSelect.addEventListener('change', updatePreviewScale);

    enableTextDrag();

    alignButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            alignButtons.forEach((b) => b.classList.remove('is-selected'));
            btn.classList.add('is-selected');
            previewText.style.textAlign = btn.dataset.align;
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

    updatePreviewText();
    updatePreviewFont();
    updatePreviewColour();
    updatePreviewScale();
    calculateTotal();
}