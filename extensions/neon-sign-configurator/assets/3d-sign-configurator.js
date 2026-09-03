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
                console.error('3D Sign Configurator Add to Cart error:', error);
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
    updatePreviewFont();
    updatePreviewColour();
    calculateTotal();
}