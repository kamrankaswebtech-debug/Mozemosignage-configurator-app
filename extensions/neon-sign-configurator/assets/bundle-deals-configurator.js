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

// ---- Reliable add of a configured-price line ----
// A brand-new "Config-<price>" variant takes a few seconds before the storefront sells it at
// its real price. Adding it straight away either failed (first click) or put the line in the
// cart at $0.00. So: wait until the storefront lists the new variant at the configured price,
// add it, then check the line's price in the cart — re-adding once if needed. A line at the
// wrong price is never left in the cart.
function CONFIG_SLEEP(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForVariantReady(routesRoot, variantId, expectedPrice) {
    const handle = (window.location.pathname.match(/\/products\/([^/?#]+)/) || [])[1];
    const want = Math.round((Number(expectedPrice) || 0) * 100);
    if (!handle || !want) return;
    for (let attempt = 0; attempt < 12; attempt++) {
        try {
            const res = await fetch(routesRoot + 'products/' + handle + '.js?_=' + Date.now(), { cache: 'no-store' });
            if (res.ok) {
                const product = await res.json();
                const variant = (product.variants || []).find((v) => String(v.id) === String(variantId));
                if (variant && Math.abs(Number(variant.price) - want) <= 1) return;
            }
        } catch (err) {
            /* keep waiting */
        }
        await CONFIG_SLEEP(800);
    }
}

function configLinePriceOk(item, want) {
    return !!item && Number(item.final_price != null ? item.final_price : item.price) >= want - 1;
}

async function configCartLines(routesRoot, variantId) {
    try {
        const cart = await (await fetch(routesRoot + 'cart.js', { cache: 'no-store' })).json();
        return (cart.items || []).filter((item) => String(item.variant_id) === String(variantId));
    } catch (err) {
        return null;
    }
}

async function configRemoveLines(routesRoot, lines) {
    for (const line of lines) {
        try {
            await fetch(routesRoot + 'cart/change.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: line.key, quantity: 0 })
            });
        } catch (err) {
            /* ignore */
        }
    }
}

async function configFreshSections(routesRoot, sectionIds) {
    if (!sectionIds.length) return undefined;
    try {
        return await (await fetch(routesRoot + '?sections=' + encodeURIComponent(sectionIds.join(',')), { cache: 'no-store' })).json();
    } catch (err) {
        return undefined;
    }
}

// Returns the add result (with up-to-date sections) once the line is in the cart at the
// configured price; throws when that can't be achieved.
async function addConfiguredLine(routesRoot, variantId, properties, sectionIds, isNewVariant, expectedPrice) {
    const want = Math.round((Number(expectedPrice) || 0) * 100);
    if (isNewVariant) await waitForVariantReady(routesRoot, variantId, expectedPrice);

    for (let round = 0; round < 2; round++) {
        const addResult = await addItemToCartWithRetry(routesRoot, variantId, properties, sectionIds, isNewVariant ? 3 : 1);
        if (!want) return addResult;
        const added = Array.isArray(addResult && addResult.items)
            ? addResult.items.find((item) => String(item.variant_id) === String(variantId))
            : null;
        if (configLinePriceOk(added, want)) return addResult;

        // Line went in at the wrong price: give Shopify a moment to apply the real price.
        for (let check = 0; check < 6; check++) {
            await CONFIG_SLEEP(1000);
            const lines = await configCartLines(routesRoot, variantId);
            if (lines && lines.length && lines.every((line) => configLinePriceOk(line, want))) {
                addResult.sections = await configFreshSections(routesRoot, sectionIds);
                return addResult;
            }
        }

        // Still wrong: take the wrong-priced line(s) out and try once more.
        const lines = await configCartLines(routesRoot, variantId);
        if (lines && lines.length) await configRemoveLines(routesRoot, lines.filter((line) => !configLinePriceOk(line, want)));
        await waitForVariantReady(routesRoot, variantId, expectedPrice);
    }
    throw new Error('Configured price was not applied in the cart');
}

// A brand-new price variant can show as $0.00 in the cart drawer for a few seconds while
// Shopify finishes setting it up (a refresh / checkout always shows the right price). If the
// line just added isn't at the configured price yet, wait until the cart has the real price,
// then redraw the theme's cart (drawer, totals, icon) with fresh sections.
async function syncCartLinePrice(routesRoot, variantId, expectedPrice, sectionIds, addResult, sourceId) {
    const want = Math.round((Number(expectedPrice) || 0) * 100);
    if (!want) return;
    const lineOk = (item) => !!item && Number(item.final_price != null ? item.final_price : item.price) >= want - 1;
    const added = addResult && Array.isArray(addResult.items)
        ? addResult.items.find((item) => String(item.variant_id) === String(variantId))
        : null;
    if (lineOk(added)) return;

    for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 700 : 1000));
        let cart;
        try {
            cart = await (await fetch(routesRoot + 'cart.js', { cache: 'no-store' })).json();
        } catch (err) {
            continue;
        }
        const lines = (cart.items || []).filter((item) => String(item.variant_id) === String(variantId));
        if (!lines.length || !lines.every(lineOk)) continue;

        let sections;
        if (sectionIds.length) {
            try {
                sections = await (await fetch(routesRoot + '?sections=' + encodeURIComponent(sectionIds.join(',')), { cache: 'no-store' })).json();
            } catch (err) {
                sections = undefined;
            }
        }
        try {
            const themeEvents = await import('@theme/events');
            const UpdateEvent = themeEvents.CartUpdateEvent || themeEvents.CartAddEvent;
            // Not "product-form-component": itemCount is the cart's real total here, not an addition.
            document.dispatchEvent(new UpdateEvent({}, sourceId, {
                source: sourceId,
                itemCount: cart.item_count,
                sections
            }));
        } catch (themeEventError) {
            console.warn('Configurator: could not refresh the theme cart UI.', themeEventError);
        }
        document.dispatchEvent(new CustomEvent('cart:refresh'));
        return;
    }
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

                // Safety: never add a line whose variant price isn't the configured total (e.g. $0.00).
                if (proxyData.price !== undefined && Math.abs(Number(proxyData.price) - Number(currentTotal.toFixed(2))) > 0.005) {
                    throw new Error('Variant price ' + proxyData.price + ' does not match configured total ' + currentTotal.toFixed(2));
                }
                if (isNewVariant) setButtonLoadingText(addToCartBtn, 'Preparing your price...');
                const addResult = await addConfiguredLine(routesRoot, priceMatchedVariantId, properties, sectionIds, isNewVariant, currentTotal);

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

                // Brand-new price variant still showing $0.00? Redraw the cart once Shopify has the price.
                syncCartLinePrice(routesRoot, priceMatchedVariantId, currentTotal, sectionIds, addResult, 'bundle-deals-configurator');

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