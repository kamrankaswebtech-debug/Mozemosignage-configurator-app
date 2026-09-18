// Mozemo Signage - Acrylic Neon Bonnet / Wall Sign Configurator: upload + colour + lighting + size + dynamic pricing
function initAllBonnetConfigurators() {
    document.querySelectorAll('.bonnet-configurator').forEach((root) => {
        if (root.dataset.bonnetConfiguratorInitialized === 'true') return;
        try {
            initBonnetConfigurator(root);
            root.dataset.bonnetConfiguratorInitialized = 'true';
        } catch (err) {
            console.error('Bonnet Configurator: init failed for this block:', err, root);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllBonnetConfigurators);
} else {
    initAllBonnetConfigurators();
}

document.addEventListener('shopify:section:load', initAllBonnetConfigurators);
document.addEventListener('cart:refresh', initAllBonnetConfigurators);

async function bonnetAddItemToCartWithRetry(routesRoot, variantId, properties, sectionIds, maxRetries) {
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

function bonnetSetButtonLoadingText(button, text) {
    button.innerHTML = '<span class="bonnet-configurator__spinner"></span><span>' + text + '</span>';
}

function bonnetShowTemporaryStatus(statusEl, text, durationMs) {
    if (!statusEl) return;
    statusEl.textContent = text;
    clearTimeout(statusEl._clearTimeoutId);
    statusEl._clearTimeoutId = setTimeout(() => { statusEl.textContent = ''; }, durationMs);
}

function initBonnetConfigurator(root) {
    const previewInner = root.querySelector('[data-preview-inner]');
    const previewPlaceholder = root.querySelector('[data-preview-placeholder]');
    const previewImage = root.querySelector('[data-preview-image]');
    const powerToggle = root.querySelector('[data-power-toggle]');
    const fileInput = root.querySelector('[data-file-input]');
    const fileStatus = root.querySelector('[data-file-status]');
    const swatches = root.querySelectorAll('[data-colour-swatches] .bonnet-configurator__swatch');
    const colourNameLabel = root.querySelector('[data-colour-name-label]');
    const lightingCards = root.querySelectorAll('[data-lighting-cards] .bonnet-configurator__lighting-card');
    const sizeSelect = root.querySelector('[data-size-select]');
    const useCheckboxes = root.querySelectorAll('[data-use-checkbox]');
    const addonCheckboxes = root.querySelectorAll('[data-addon-checkbox]');
    const totalPriceEl = root.querySelector('[data-total-price]');
    const addToCartBtn = root.querySelector('[data-add-to-cart]');
    const addToCartStatus = root.querySelector('[data-add-to-cart-status]');

    let selectedColourHex = swatches.length ? swatches[0].dataset.colourHex : '#ffffff';
    let selectedColourPrice = swatches.length ? parseFloat(swatches[0].dataset.colourPrice) || 0 : 0;
    const initialLightingCard = Array.from(lightingCards).find((c) => c.classList.contains('is-selected'));
    let currentLightingPrice = initialLightingCard ? (parseFloat(initialLightingCard.dataset.lightingPrice) || 0) : 0;
    let currentTotal = 0;
    let uploadedFileUrl = null;
    let uploadInProgress = false;

    function updatePreviewGlowColour() {
        if (previewImage) previewImage.style.color = selectedColourHex;
    }

    function updatePowerState() {
        if (!previewInner) return;
        previewInner.classList.toggle('is-off', powerToggle ? !powerToggle.checked : false);
    }

    if (powerToggle) {
        powerToggle.addEventListener('change', updatePowerState);
    }

    async function uploadFile(file) {
        uploadInProgress = true;
        fileStatus.textContent = 'Uploading your design...';
        try {
            const formData = new FormData();
            formData.append('file', file);
            const response = await fetch('/apps/neon-pricing', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Upload failed');
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            uploadedFileUrl = data.fileUrl;
            fileStatus.textContent = 'Design uploaded successfully!';
        } catch (err) {
            console.error('Bonnet Configurator upload error:', err);
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
                updatePreviewGlowColour();
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
            updatePreviewGlowColour();
            calculateTotal();
        });
    });

    function selectLighting(card) {
        lightingCards.forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        currentLightingPrice = parseFloat(card.dataset.lightingPrice) || 0;
        calculateTotal();
    }

    lightingCards.forEach((card) => {
        card.addEventListener('click', () => selectLighting(card));
    });

    if (sizeSelect) {
        sizeSelect.addEventListener('change', calculateTotal);
    }

    addonCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', calculateTotal);
    });

    function calculateTotal() {
        let total = 0;
        if (sizeSelect) {
            const sizeOption = sizeSelect.options[sizeSelect.selectedIndex];
            total += parseFloat(sizeOption?.dataset.price) || 0;
        }
        total += selectedColourPrice;
        total += currentLightingPrice;
        addonCheckboxes.forEach((checkbox) => {
            if (checkbox.checked) total += parseFloat(checkbox.dataset.price) || 0;
        });
        totalPriceEl.textContent = '$' + total.toFixed(2);
        currentTotal = total;
    }

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', async () => {
            const variantId = addToCartBtn.dataset.variantId;
            if (!variantId) {
                console.error('Bonnet Configurator: No variant ID found.');
                if (addToCartStatus) addToCartStatus.textContent = 'Unable to add to cart — please refresh the page.';
                return;
            }
            if (uploadInProgress) {
                if (addToCartStatus) addToCartStatus.textContent = 'Please wait, your design is still uploading...';
                return;
            }

            const selectedLightingCard = Array.from(lightingCards).find((c) => c.classList.contains('is-selected'));
            const selectedUses = Array.from(useCheckboxes)
                .filter((cb) => cb.checked)
                .map((cb) => cb.closest('label').querySelector('span').textContent.trim())
                .join(', ');
            const selectedAddons = Array.from(addonCheckboxes)
                .filter((checkbox) => checkbox.checked)
                .map((checkbox) => checkbox.closest('label').querySelector('span').textContent.trim())
                .join(', ');

            const properties = {
                'Uploaded Design': uploadedFileUrl || 'No file uploaded',
                'Face Colour': colourNameLabel ? colourNameLabel.textContent.trim() : '',
                'Lighting Option': selectedLightingCard ? selectedLightingCard.dataset.lightingLabel : '',
                'Size': sizeSelect ? sizeSelect.options[sizeSelect.selectedIndex].textContent.trim() : '',
                'Display Use': selectedUses || 'Bonnet / Hood Display, Wall Display',
                'Add-ons': selectedAddons || 'None',
                'Configured Total': '$' + currentTotal.toFixed(2)
            };

            addToCartBtn.disabled = true;
            bonnetSetButtonLoadingText(addToCartBtn, 'Syncing price...');

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

                bonnetSetButtonLoadingText(addToCartBtn, 'Adding...');
                const routesRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

                const cartItemsComponents = document.querySelectorAll('cart-items-component');
                const sectionIds = [];
                cartItemsComponents.forEach((el) => {
                    if (el.dataset && el.dataset.sectionId) sectionIds.push(el.dataset.sectionId);
                });

                const addResult = await bonnetAddItemToCartWithRetry(
                    routesRoot, priceMatchedVariantId, properties, sectionIds, isNewVariant ? 3 : 0
                );

                addToCartBtn.textContent = 'Added ✓';
                bonnetShowTemporaryStatus(addToCartStatus, 'Added to cart at the correct configured price!', 4000);

                try {
                    const themeEvents = await import('@theme/events');
                    document.dispatchEvent(new themeEvents.CartAddEvent({}, 'bonnet-configurator', {
                        source: 'product-form-component', itemCount: 1, productId, sections: addResult.sections
                    }));
                } catch (themeEventError) {
                    console.warn('Bonnet Configurator: could not notify theme cart UI.', themeEventError);
                }

                document.dispatchEvent(new CustomEvent('cart:refresh'));
            } catch (error) {
                console.error('Bonnet Configurator Add to Cart error:', error);
                addToCartBtn.textContent = 'Error - try again';
                bonnetShowTemporaryStatus(addToCartStatus, 'Something went wrong. Please try again.', 5000);
            } finally {
                setTimeout(() => {
                    addToCartBtn.disabled = false;
                    addToCartBtn.textContent = 'Add to Cart';
                }, 2000);
            }
        });
    }

    updatePreviewGlowColour();
    updatePowerState();
    calculateTotal();
}