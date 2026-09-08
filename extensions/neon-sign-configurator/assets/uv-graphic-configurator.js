// Mozemo Signage - UV Graphic Sign Configurator: file upload + live preview + dynamic pricing
function initAllUvConfigurators() {
    document.querySelectorAll('.uv-configurator').forEach((root) => {
        if (root.dataset.uvConfiguratorInitialized === 'true') return;
        try {
            initUvConfigurator(root);
            root.dataset.uvConfiguratorInitialized = 'true';
        } catch (err) {
            console.error('UV Graphic Configurator: init failed for this block:', err, root);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllUvConfigurators);
} else {
    initAllUvConfigurators();
}

document.addEventListener('shopify:section:load', initAllUvConfigurators);
document.addEventListener('cart:refresh', initAllUvConfigurators);

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

function setButtonLoadingText(button, text) {
    button.innerHTML = '<span class="uv-configurator__spinner"></span><span>' + text + '</span>';
}

function showTemporaryStatus(statusEl, text, durationMs) {
    if (!statusEl) return;
    statusEl.textContent = text;
    clearTimeout(statusEl._clearTimeoutId);
    statusEl._clearTimeoutId = setTimeout(() => {
        statusEl.textContent = '';
    }, durationMs);
}

function initUvConfigurator(root) {
    const fileInput = root.querySelector('[data-file-input]');
    const fileStatus = root.querySelector('[data-file-status]');
    const previewPlaceholder = root.querySelector('[data-preview-placeholder]');
    const previewImage = root.querySelector('[data-preview-image]');
    const sizeSelect = root.querySelector('[data-size-select]');
    const materialSelect = root.querySelector('[data-material-select]');
    const finishSelect = root.querySelector('[data-finish-select]');
    const swatches = root.querySelectorAll('[data-colour-swatches] .uv-configurator__swatch');
    const colourNameLabel = root.querySelector('[data-colour-name-label]');
    const powerAdapterSelect = root.querySelector('[data-power-adapter-select]');
    const addonCheckboxes = root.querySelectorAll('[data-addon-checkbox]');
    const totalPriceEl = root.querySelector('[data-total-price]');
    const addToCartBtn = root.querySelector('[data-add-to-cart]');
    const addToCartStatus = root.querySelector('[data-add-to-cart-status]');

    let selectedColourPrice = swatches.length ? parseFloat(swatches[0].dataset.colourPrice) || 0 : 0;
    let currentTotal = 0;
    let uploadedFileUrl = null;
    let uploadInProgress = false;

    function calculateTotal() {
        let total = 0;
        [sizeSelect, materialSelect, finishSelect].forEach((select) => {
            if (!select) return;
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

    async function uploadFile(file) {
        uploadInProgress = true;
        fileStatus.textContent = 'Uploading your design...';
        try {
            const formData = new FormData();
            formData.append('file', file);
            const response = await fetch('/apps/upload-design', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Upload failed');
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            uploadedFileUrl = data.fileUrl;
            fileStatus.textContent = 'Design uploaded successfully!';
        } catch (err) {
            console.error('UV Graphic Configurator upload error:', err);
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
                previewPlaceholder.style.display = 'none';
            } else {
                previewPlaceholder.textContent = `Selected file: ${file.name}`;
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
            selectedColourPrice = parseFloat(swatch.dataset.colourPrice) || 0;
            colourNameLabel.textContent = swatch.dataset.colourName;
            calculateTotal();
        });
    });

    [sizeSelect, materialSelect, finishSelect].forEach((select) => {
        if (select) select.addEventListener('change', calculateTotal);
    });

    addonCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', calculateTotal);
    });

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', async () => {
            const variantId = addToCartBtn.dataset.variantId;
            if (!variantId) {
                console.error('UV Graphic Configurator: No variant ID found.');
                if (addToCartStatus) addToCartStatus.textContent = 'Unable to add to cart — please refresh the page.';
                return;
            }

            if (uploadInProgress) {
                if (addToCartStatus) addToCartStatus.textContent = 'Please wait, your design is still uploading...';
                return;
            }

            const selectedAddons = Array.from(addonCheckboxes)
                .filter((checkbox) => checkbox.checked)
                .map((checkbox) => checkbox.closest('label').querySelector('span').textContent.trim())
                .join(', ');

            const properties = {
                'Uploaded Design': uploadedFileUrl || 'No file uploaded',
                'Size': sizeSelect.options[sizeSelect.selectedIndex].textContent.trim(),
                'Material': materialSelect.options[materialSelect.selectedIndex].textContent.trim(),
                'Finish': finishSelect.options[finishSelect.selectedIndex].textContent.trim(),
                'Add-ons': selectedAddons || 'None',
                'Configured Total': '$' + currentTotal.toFixed(2)
            };

            if (swatches.length) {
                properties['LED Colour'] = colourNameLabel.textContent.trim();
            }
            if (powerAdapterSelect) {
                properties['Power Adapter'] = powerAdapterSelect.options[powerAdapterSelect.selectedIndex].textContent.trim();
            }

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
                    document.dispatchEvent(new themeEvents.CartAddEvent({}, 'uv-graphic-configurator', {
                        source: 'product-form-component',
                        itemCount: 1,
                        productId,
                        sections: addResult.sections
                    }));
                } catch (themeEventError) {
                    console.warn('UV Graphic Configurator: could not notify theme cart UI.', themeEventError);
                }

                document.dispatchEvent(new CustomEvent('cart:refresh'));
            } catch (error) {
                console.error('UV Graphic Configurator Add to Cart error:', error);
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

    calculateTotal();
}