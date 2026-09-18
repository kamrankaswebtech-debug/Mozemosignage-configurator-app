// Mozemo Signage - Lightbox Range Configurator: shape + size(sides-aware) + upload + frame colour
function initAllLightboxConfigurators() {
    document.querySelectorAll('.lightbox-configurator').forEach((root) => {
        if (root.dataset.lightboxConfiguratorInitialized === 'true') return;
        try {
            initLightboxConfigurator(root);
            root.dataset.lightboxConfiguratorInitialized = 'true';
        } catch (err) {
            console.error('Lightbox Configurator: init failed for this block:', err, root);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllLightboxConfigurators);
} else {
    initAllLightboxConfigurators();
}

document.addEventListener('shopify:section:load', initAllLightboxConfigurators);
document.addEventListener('cart:refresh', initAllLightboxConfigurators);

async function lightboxAddItemToCartWithRetry(routesRoot, variantId, properties, sectionIds, maxRetries) {
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
            if (response.ok) return await response.json();
            lastError = new Error('Add to cart failed with status ' + response.status);
        } catch (err) {
            lastError = err;
        }
        if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 900 + (attempt * 500)));
        }
    }
    throw lastError;
}

function lightboxSetButtonLoadingText(button, text) {
    button.innerHTML = '<span class="lightbox-configurator__spinner"></span><span>' + text + '</span>';
}

function lightboxShowTemporaryStatus(statusEl, text, durationMs) {
    if (!statusEl) return;
    statusEl.textContent = text;
    clearTimeout(statusEl._clearTimeoutId);
    statusEl._clearTimeoutId = setTimeout(() => { statusEl.textContent = ''; }, durationMs);
}

function initLightboxConfigurator(root) {
    const shapeCards = root.querySelectorAll('[data-shape-cards] .lightbox-configurator__shape-card');
    const shapePreview = root.querySelector('[data-shape-preview]');
    const sidesRadios = root.querySelectorAll('[data-sides-radio]');
    const sizeSelect = root.querySelector('[data-size-select]');
    const fileInput = root.querySelector('[data-file-input]');
    const fileStatus = root.querySelector('[data-file-status]');
    const previewPlaceholder = root.querySelector('[data-preview-placeholder]');
    const previewImage = root.querySelector('[data-preview-image]');
    const swatches = root.querySelectorAll('[data-colour-swatches] .lightbox-configurator__swatch');
    const colourNameLabel = root.querySelector('[data-colour-name-label]');
    const totalPriceEl = root.querySelector('[data-total-price]');
    const addToCartBtn = root.querySelector('[data-add-to-cart]');
    const addToCartStatus = root.querySelector('[data-add-to-cart-status]');

    const initialShapeCard = Array.from(shapeCards).find((c) => c.classList.contains('is-selected'));
    let currentShapeKey = initialShapeCard ? initialShapeCard.dataset.shapeKey : 'circle';
    let currentShapePrice = initialShapeCard ? (parseFloat(initialShapeCard.dataset.shapePrice) || 0) : 0;
    let currentSides = 'single';
    let selectedColourHex = swatches.length ? swatches[0].dataset.colourHex : '#1a1a1a';
    let selectedColourPrice = swatches.length ? parseFloat(swatches[0].dataset.colourPrice) || 0 : 0;
    let currentTotal = 0;
    let uploadedFileUrl = null;
    let uploadInProgress = false;

    function updateShapePreview() {
        if (!shapePreview) return;
        shapePreview.classList.remove(
            'lightbox-configurator__shape--circle',
            'lightbox-configurator__shape--square',
            'lightbox-configurator__shape--rectangle'
        );
        shapePreview.classList.add('lightbox-configurator__shape--' + currentShapeKey);
        shapePreview.style.borderColor = selectedColourHex;
    }

    function selectShape(card) {
        shapeCards.forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        currentShapeKey = card.dataset.shapeKey;
        currentShapePrice = parseFloat(card.dataset.shapePrice) || 0;
        updateShapePreview();
        calculateTotal();
    }

    shapeCards.forEach((card) => {
        card.addEventListener('click', () => selectShape(card));
    });

    // Sides selection filters which Size dropdown options are visible — since single-sided
    // and double-sided lightboxes have entirely different price tables per the client's spec.
    function filterSizeOptionsBySides() {
        if (!sizeSelect) return;
        let firstVisibleIndex = -1;
        Array.from(sizeSelect.options).forEach((opt, i) => {
            const matches = opt.dataset.sides === currentSides;
            opt.hidden = !matches;
            if (matches && firstVisibleIndex === -1) firstVisibleIndex = i;
        });
        if (firstVisibleIndex !== -1 && sizeSelect.options[sizeSelect.selectedIndex]?.hidden) {
            sizeSelect.selectedIndex = firstVisibleIndex;
        }
    }

    sidesRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            currentSides = radio.value;
            filterSizeOptionsBySides();
            calculateTotal();
        });
    });

    async function uploadFile(file) {
        uploadInProgress = true;
        fileStatus.textContent = 'Uploading your design...';
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('action', 'upload');
            const response = await fetch('/apps/neon-pricing', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Upload failed');
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            uploadedFileUrl = data.fileUrl;
            fileStatus.textContent = 'Design uploaded successfully!';
        } catch (err) {
            console.error('Lightbox Configurator upload error:', err);
            fileStatus.textContent = 'Upload failed. You can still add to cart — please contact us with your file if this persists.';
            uploadedFileUrl = null;
        } finally {
            uploadInProgress = false;
        }
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;

            if (file.type.startsWith('image/')) {
                const objectUrl = URL.createObjectURL(file);
                previewImage.src = objectUrl;
                previewImage.style.display = 'block';
                if (previewPlaceholder) previewPlaceholder.style.display = 'none';
            } else if (previewPlaceholder) {
                previewPlaceholder.textContent = 'Selected file: ' + file.name;
                previewPlaceholder.style.display = 'block';
                previewImage.style.display = 'none';
            }

            uploadFile(file);
        });
    }

    swatches.forEach((swatch) => {
        swatch.addEventListener('click', () => {
            swatches.forEach((s) => s.classList.remove('is-selected'));
            swatch.classList.add('is-selected');
            selectedColourHex = swatch.dataset.colourHex;
            selectedColourPrice = parseFloat(swatch.dataset.colourPrice) || 0;
            if (colourNameLabel) colourNameLabel.textContent = swatch.dataset.colourName;
            updateShapePreview();
            calculateTotal();
        });
    });

    if (sizeSelect) {
        sizeSelect.addEventListener('change', calculateTotal);
    }

    function calculateTotal() {
        let total = 0;
        total += currentShapePrice;
        if (sizeSelect) {
            const sizeOption = sizeSelect.options[sizeSelect.selectedIndex];
            total += parseFloat(sizeOption?.dataset.price) || 0;
        }
        total += selectedColourPrice;
        totalPriceEl.textContent = '$' + total.toFixed(2);
        currentTotal = total;
    }

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', async () => {
            const variantId = addToCartBtn.dataset.variantId;
            if (!variantId) {
                console.error('Lightbox Configurator: No variant ID found.');
                if (addToCartStatus) addToCartStatus.textContent = 'Unable to add to cart — please refresh the page.';
                return;
            }
            if (uploadInProgress) {
                if (addToCartStatus) addToCartStatus.textContent = 'Please wait, your design is still uploading...';
                return;
            }

            const selectedShapeCard = Array.from(shapeCards).find((c) => c.classList.contains('is-selected'));

            const properties = {
                'Shape': selectedShapeCard ? selectedShapeCard.querySelector('span:last-child').textContent.trim() : currentShapeKey,
                'Sides': currentSides === 'double' ? 'Double-Sided' : 'Single-Sided',
                'Size': sizeSelect ? sizeSelect.options[sizeSelect.selectedIndex].textContent.trim() : '',
                'Uploaded Design': uploadedFileUrl || 'No file uploaded',
                'Frame Colour': colourNameLabel ? colourNameLabel.textContent.trim() : '',
                'Configured Total': '$' + currentTotal.toFixed(2)
            };

            addToCartBtn.disabled = true;
            lightboxSetButtonLoadingText(addToCartBtn, 'Syncing price...');

            try {
                const productId = addToCartBtn.dataset.productId;
                const proxyResponse = await fetch('/apps/neon-pricing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'price', productId, price: currentTotal })
                });
                if (!proxyResponse.ok) throw new Error('Pricing sync failed');
                const proxyData = await proxyResponse.json();
                if (proxyData.error || !proxyData.variantId) throw new Error(proxyData.error || 'No variant returned');

                const priceMatchedVariantId = proxyData.variantId;
                const isNewVariant = proxyData.reused === false;

                lightboxSetButtonLoadingText(addToCartBtn, 'Adding...');
                const routesRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

                const cartItemsComponents = document.querySelectorAll('cart-items-component');
                const sectionIds = [];
                cartItemsComponents.forEach((el) => {
                    if (el.dataset && el.dataset.sectionId) sectionIds.push(el.dataset.sectionId);
                });

                const addResult = await lightboxAddItemToCartWithRetry(
                    routesRoot, priceMatchedVariantId, properties, sectionIds, isNewVariant ? 3 : 0
                );

                addToCartBtn.textContent = 'Added ✓';
                lightboxShowTemporaryStatus(addToCartStatus, 'Added to cart at the correct configured price!', 4000);

                try {
                    const themeEvents = await import('@theme/events');
                    document.dispatchEvent(new themeEvents.CartAddEvent({}, 'lightbox-configurator', {
                        source: 'product-form-component', itemCount: 1, productId, sections: addResult.sections
                    }));
                } catch (themeEventError) {
                    console.warn('Lightbox Configurator: could not notify theme cart UI.', themeEventError);
                }

                document.dispatchEvent(new CustomEvent('cart:refresh'));
            } catch (error) {
                console.error('Lightbox Configurator Add to Cart error:', error);
                addToCartBtn.textContent = 'Error - try again';
                lightboxShowTemporaryStatus(addToCartStatus, 'Something went wrong. Please try again.', 5000);
            } finally {
                setTimeout(() => {
                    addToCartBtn.disabled = false;
                    addToCartBtn.textContent = 'Add to Cart';
                }, 2000);
            }
        });
    }

    filterSizeOptionsBySides();
    updateShapePreview();
    calculateTotal();
}