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
                console.error('Bundle Deals Configurator Add to Cart error:', error);
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

    calculateTotal();
}