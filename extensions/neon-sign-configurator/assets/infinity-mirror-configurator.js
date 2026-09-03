// Mozemo Signage - Infinity Mirror Letter Signs Configurator: live preview + dynamic pricing
function initAllInfinityConfigurators() {
    document.querySelectorAll('.infinity-configurator').forEach((root) => {
        if (root.dataset.infinityConfiguratorInitialized === 'true') return;
        try {
            initInfinityConfigurator(root);
            root.dataset.infinityConfiguratorInitialized = 'true';
        } catch (err) {
            console.error('Infinity Mirror Configurator: init failed for this block:', err, root);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllInfinityConfigurators);
} else {
    initAllInfinityConfigurators();
}

document.addEventListener('shopify:section:load', initAllInfinityConfigurators);
document.addEventListener('cart:refresh', initAllInfinityConfigurators);

function initInfinityConfigurator(root) {
    const previewText = root.querySelector('[data-preview-text]');
    const textInput = root.querySelector('[data-text-input]');
    const fontSelect = root.querySelector('[data-font-select]');
    const sizeSelect = root.querySelector('[data-size-select]');
    const swatches = root.querySelectorAll('[data-colour-swatches] .infinity-configurator__swatch');
    const colourNameLabel = root.querySelector('[data-colour-name-label]');
    const frameSelect = root.querySelector('[data-frame-select]');
    const mountingSelect = root.querySelector('[data-mounting-select]');
    const powerSelect = root.querySelector('[data-power-select]');
    const addonCheckboxes = root.querySelectorAll('[data-addon-checkbox]');
    const totalPriceEl = root.querySelector('[data-total-price]');
    const addToCartBtn = root.querySelector('[data-add-to-cart]');
    const addToCartStatus = root.querySelector('[data-add-to-cart-status]');

    let selectedColourHex = swatches.length ? swatches[0].dataset.colourHex : '#ffffff';
    let selectedColourPrice = swatches.length ? parseFloat(swatches[0].dataset.colourPrice) || 0 : 0;
    let currentTotal = 0;

    function updatePreviewText() {
        const value = textInput.value.trim();
        previewText.textContent = value.length ? value : 'Your Text';
    }

    function updatePreviewColour() {
        previewText.style.color = selectedColourHex;
    }

    function updatePreviewFont() {
        previewText.style.fontFamily = fontSelect.value;
    }

    function calculateTotal() {
        let total = 0;
        const selects = [sizeSelect, frameSelect, mountingSelect];
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
    fontSelect.addEventListener('change', updatePreviewFont);

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

    [sizeSelect, frameSelect, mountingSelect].forEach((select) => {
        select.addEventListener('change', calculateTotal);
    });

    addonCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', calculateTotal);
    });

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', async () => {
            const variantId = addToCartBtn.dataset.variantId;
            if (!variantId) {
                console.error('Infinity Mirror Configurator: No variant ID found on Add to Cart button.');
                if (addToCartStatus) addToCartStatus.textContent = 'Unable to add to cart — product variant not found. Please refresh the page.';
                return;
            }

            const selectedAddons = Array.from(addonCheckboxes)
                .filter((checkbox) => checkbox.checked)
                .map((checkbox) => checkbox.closest('label').querySelector('span').textContent.trim())
                .join(', ');

            const properties = {
                'Custom Text': textInput.value.trim() || 'Your Text',
                'Font': fontSelect.options[fontSelect.selectedIndex].textContent.trim(),
                'Size': sizeSelect.options[sizeSelect.selectedIndex].textContent.trim(),
                'LED Colour': colourNameLabel.textContent.trim(),
                'Frame Finish': frameSelect.options[frameSelect.selectedIndex].textContent.trim(),
                'Mounting': mountingSelect.options[mountingSelect.selectedIndex].textContent.trim(),
                'Power Adapter': powerSelect.options[powerSelect.selectedIndex].textContent.trim(),
                'Add-ons': selectedAddons || 'None',
                'Configured Total': '$' + currentTotal.toFixed(2)
            };

            addToCartBtn.disabled = true;
            addToCartBtn.textContent = 'Syncing price...';

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

                addToCartBtn.textContent = 'Adding...';
                const routesRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
                const response = await fetch(routesRoot + 'cart/add.js', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items: [{ id: parseInt(priceMatchedVariantId, 10), quantity: 1, properties }]
                    })
                });

                if (!response.ok) throw new Error('Add to cart failed');

                addToCartBtn.textContent = 'Added ✓';
                if (addToCartStatus) addToCartStatus.textContent = 'Added to cart at the correct configured price!';
                document.dispatchEvent(new CustomEvent('cart:refresh'));
            } catch (error) {
                console.error('Infinity Mirror Configurator Add to Cart error:', error);
                addToCartBtn.textContent = 'Error - try again';
                if (addToCartStatus) addToCartStatus.textContent = 'Something went wrong. Please try again.';
            } finally {
                setTimeout(() => {
                    addToCartBtn.disabled = false;
                    addToCartBtn.textContent = 'Add to Cart';
                }, 2000);
            }
        });
    }

    updatePreviewText();
    updatePreviewColour();
    updatePreviewFont();
    calculateTotal();
}