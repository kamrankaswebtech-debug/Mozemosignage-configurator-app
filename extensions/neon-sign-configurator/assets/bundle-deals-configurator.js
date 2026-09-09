// Mozemo Signage - Bulk & Bundle Deals Configurator: live pricing
function initAllBundleConfigurators() {
    document.querySelectorAll('.bundle-configurator').forEach((root) => {
        if (root.dataset.bundleConfiguratorInitialized === 'true') return;
        try {
            initBundleConfigurator(root);
            root.dataset.bundleConfiguratorInitialized = 'true';
        } catch (err) {
            console.error('Bundle Deals Configurator: init failed for this block:', err, root);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllBundleConfigurators);
} else {
    initAllBundleConfigurators();
}

document.addEventListener('shopify:section:load', initAllBundleConfigurators);
document.addEventListener('cart:refresh', initAllBundleConfigurators);

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
    button.innerHTML = '<span class="bundle-configurator__spinner"></span><span>' + text + '</span>';
}

function showTemporaryStatus(statusEl, text, durationMs) {
    if (!statusEl) return;
    statusEl.textContent = text;
    clearTimeout(statusEl._clearTimeoutId);
    statusEl._clearTimeoutId = setTimeout(() => {
        statusEl.textContent = '';
    }, durationMs);
}

function initBundleConfigurator(root) {
    const packageRadios = root.querySelectorAll('[data-package-radio]');
    const packageCards = root.querySelectorAll('.bundle-configurator__package-card');
    const addonCheckboxes = root.querySelectorAll('[data-addon-checkbox]');
    const totalPriceEl = root.querySelector('[data-total-price]');
    const addToCartBtn = root.querySelector('[data-add-to-cart]');
    const addToCartStatus = root.querySelector('[data-add-to-cart-status]');

    let currentTotal = 0;

    function calculateTotal() {
        let total = 0;
        const selectedPackage = root.querySelector('[data-package-radio]:checked');
        total += parseFloat(selectedPackage?.dataset.price) || 0;
        addonCheckboxes.forEach((checkbox) => {
            if (checkbox.checked) total += parseFloat(checkbox.dataset.price) || 0;
        });
        totalPriceEl.textContent = '$' + total.toFixed(2);
        currentTotal = total;
    }

    packageRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            packageCards.forEach((card) => card.classList.remove('is-selected'));
            radio.closest('.bundle-configurator__package-card')?.classList.add('is-selected');
            calculateTotal();
        });
    });

    addonCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', calculateTotal);
    });

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', async () => {
            const variantId = addToCartBtn.dataset.variantId;
            if (!variantId) {
                console.error('Bundle Deals Configurator: No variant ID found on Add to Cart button.');
                if (addToCartStatus) addToCartStatus.textContent = 'Unable to add to cart — product variant not found. Please refresh the page.';
                return;
            }

            const selectedPackage = root.querySelector('[data-package-radio]:checked');
            const selectedAddons = Array.from(addonCheckboxes)
                .filter((checkbox) => checkbox.checked)
                .map((checkbox) => checkbox.closest('label').querySelector('span').textContent.trim())
                .join(', ');

            const properties = {
                'Package': selectedPackage?.closest('.bundle-configurator__package-card')?.querySelector('.bundle-configurator__package-title')?.textContent.trim() || 'N/A',
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
                    document.dispatchEvent(new themeEvents.CartAddEvent({}, 'bundle-deals-configurator', {
                        source: 'product-form-component',
                        itemCount: 1,
                        productId,
                        sections: addResult.sections
                    }));
                } catch (themeEventError) {
                    console.warn('Bundle Deals Configurator: could not notify theme cart UI.', themeEventError);
                }

                document.dispatchEvent(new CustomEvent('cart:refresh'));
            } catch (error) {
                console.error('Bundle Deals Configurator Add to Cart error:', error);
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