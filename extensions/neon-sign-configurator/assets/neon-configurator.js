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

// Shopify can take a brief moment to make a brand-new variant (created via the Admin API)
// fully available to the storefront cart endpoint. Retrying a couple of times with a short
// delay — only for freshly-created variants — avoids showing the customer a false error.
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
            // Wait a bit longer each retry (900ms, then 1400ms, then 1900ms) —
            // a brand-new variant needs a moment to fully propagate to the storefront cart endpoint.
            const delay = 900 + (attempt * 500);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

// Shows a spinning loader inside the button next to the given text.
function setButtonLoadingText(button, text) {
    button.innerHTML = '<span class="neon-configurator__spinner"></span><span>' + text + '</span>';
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

// Builds Font cards + Quick Symbol buttons from compact JSON (instead of large repeated
// Liquid markup) — keeps the .liquid file's byte size well under the Theme App Extension's
// 100KB total limit while keeping everything fully dynamic from the same metaobject data.
function renderNeonFontsAndSymbols(root) {
    const fontsDataEl = root.querySelector('[data-neon-fonts-data]');
    const symbolsDataEl = root.querySelector('[data-neon-symbols-data]');
    const fontSelectEl = root.querySelector('[data-font-select]');
    const fontCardsEl = root.querySelector('[data-font-cards]');
    const fontPreviewEl = root.querySelector('[data-font-dropdown-preview]');
    const symbolButtonsEl = root.querySelector('[data-symbol-buttons]');

    if (fontsDataEl && fontSelectEl && fontCardsEl) {
        let fonts = [];
        try { fonts = JSON.parse(fontsDataEl.textContent) || []; } catch (err) { console.error('Neon Configurator: failed to parse fonts JSON.', err); }
        fonts.forEach((font, i) => {
            const option = document.createElement('option');
            option.value = font.value;
            option.dataset.name = font.name;
            option.textContent = font.name;
            if (i === 0) option.selected = true;
            fontSelectEl.appendChild(option);

            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'neon-configurator__font-card' + (i === 0 ? ' is-selected' : '');
            card.dataset.fontValue = font.value;
            let inner = '';
            if (font.isNew) inner += '<span class="neon-configurator__font-card-badge">NEW</span>';
            inner += '<span class="neon-configurator__font-card-thumb">';
            inner += font.previewImage
                ? '<img src="' + font.previewImage + '" alt="' + font.name + '" width="100" height="40" loading="lazy">'
                : '<span class="neon-configurator__font-card-sample" style="font-family: ' + font.value + ';">Your Text</span>';
            inner += '</span><span class="neon-configurator__font-card-label">' + font.name + '</span>';
            card.innerHTML = inner;
            fontCardsEl.appendChild(card);
        });
        if (fontPreviewEl && fonts.length) {
            fontPreviewEl.textContent = fonts[0].name;
            fontPreviewEl.style.fontFamily = fonts[0].value;
        }
    }

    if (symbolsDataEl && symbolButtonsEl) {
        let symbols = [];
        try { symbols = JSON.parse(symbolsDataEl.textContent) || []; } catch (err) { console.error('Neon Configurator: failed to parse symbols JSON.', err); }
        symbols.forEach((sym) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'neon-configurator__symbol-btn';
            btn.dataset.symbolUrl = sym.url;
            btn.dataset.symbolLabel = sym.label;
            btn.dataset.iconTransparentBg = sym.transparentBg ? 'true' : 'false';
            btn.title = sym.label;
            btn.setAttribute('aria-label', sym.label);
            btn.innerHTML = '<img src="' + sym.url + '" alt="' + sym.label + '" width="18" height="18" loading="lazy">';
            symbolButtonsEl.appendChild(btn);
        });
    }
}

// Re-orders a container's children by their data-sort-order (Admin "Sort Order"), because
// Liquid returns metaobjects in creation order, not sort order. Stable; blank = last.
function sortBySortOrder(container) {
    if (!container) return;
    const items = Array.from(container.children);
    items
        .map((el, idx) => ({ el, idx, so: Number(el.dataset.sortOrder) }))
        .map((x) => ({ ...x, so: Number.isFinite(x.so) ? x.so : 999999 }))
        .sort((a, b) => (a.so - b.so) || (a.idx - b.idx))
        .forEach((x) => container.appendChild(x.el));
}

// Decides the acrylic finish for a Backboard Colour option: clear / gloss / shiny / frosted.
// Admin "Finish Type" wins; otherwise auto-detected from the colour name.
function resolveBackboardFinish(option) {
    if (!option) return 'gloss';
    if (option.dataset.isClear === 'true') return 'clear';
    const explicit = (option.dataset.finish || '').trim().toLowerCase();
    if (['clear', 'gloss', 'shiny', 'frosted'].indexOf(explicit) > -1) return explicit;
    const label = (option.textContent || '').toLowerCase();
    if (label.indexOf('frost') > -1 || label.indexOf('matte') > -1) return 'frosted';
    if (label.indexOf('shiny') > -1 || label.indexOf('mirror') > -1 || label.indexOf('chrome') > -1) return 'shiny';
    return 'gloss';
}

// Builds the 4 SVG filters used for Cut Around / Cut to Letter / Acrylic Stand.
// Clear = thin grey outline with a faint glass tint. Gloss = reflective edge highlights.
// Shiny = mirror-like (two lights + sheen). Frosted = dull/matte with fine grain.
function buildBackboardFilters(blockId, hex, finish, fontSize) {

    // never gets clipped at the SVG filter's own bounding box.
    const fs = fontSize || 48;
    const outlineInner = Math.min(120, Math.max(10, fs * 0.30));
    const outlineOuter = outlineInner + Math.min(26, Math.max(3, fs * 0.07));
    const outlineInnerTight = Math.min(70, Math.max(6, fs * 0.17));
    const outlineOuterTight = outlineInnerTight + Math.min(18, Math.max(2, fs * 0.045));
    const fillRadiusLoose = Math.min(150, Math.max(16, fs * 0.42));
    const fillRadiusTight = Math.min(90, Math.max(10, fs * 0.24));
    const regionLoose = Math.min(140, Math.max(60, fs * 1.3));
    const regionTight = Math.min(110, Math.max(45, fs * 1.0));

    const region = (p) => 'x="-' + p + '%" y="-' + p + '%" width="' + (100 + p * 2) + '%" height="' + (100 + p * 2) + '%"';

    const outline = (id, innerR, outerR, p) =>
        '<filter id="' + id + '" ' + region(p) + ' color-interpolation-filters="sRGB">' +
        '<feMorphology in="SourceAlpha" operator="dilate" radius="' + innerR + '" result="inner"/>' +
        '<feMorphology in="SourceAlpha" operator="dilate" radius="' + outerR + '" result="outer"/>' +
        '<feComposite in="outer" in2="inner" operator="out" result="ring"/>' +
        '<feFlood flood-color="#9a9a9a" result="ringFlood"/>' +
        '<feComposite in="ringFlood" in2="ring" operator="in" result="ringColour"/>' +
        '<feFlood flood-color="#ffffff" flood-opacity="0.07" result="tint"/>' +
        '<feComposite in="tint" in2="inner" operator="in" result="tintIn"/>' +
        '<feMerge><feMergeNode in="tintIn"/><feMergeNode in="ringColour"/></feMerge>' +
        '</filter>';

    const fill = (id, radius, p) => {
        let s = '<filter id="' + id + '" ' + region(p) + ' color-interpolation-filters="sRGB">' +
            '<feMorphology in="SourceAlpha" operator="dilate" radius="' + radius + '" result="shape"/>' +
            '<feFlood flood-color="' + hex + '" result="col"/>' +
            '<feComposite in="col" in2="shape" operator="in" result="base"/>';

        if (finish === 'frosted') {
            s += '<feFlood flood-color="#ffffff" flood-opacity="0.10" result="sheen"/>' +
                '<feComposite in="sheen" in2="shape" operator="in" result="sheenIn"/>' +
                '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="noise"/>' +
                '<feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 -0.12" result="grain"/>' +
                '<feComposite in="grain" in2="shape" operator="in" result="grainIn"/>' +
                '<feMerge><feMergeNode in="base"/><feMergeNode in="sheenIn"/><feMergeNode in="grainIn"/></feMerge>';
        } else {
            // GLOSS + SHINY: realistic metallic/acrylic sheen using the SAME recipe already
            // proven on the CSS-driven Rectangle/Open Box backboards (soft-light highlight +
            // multiply shadow, via diagonal gradient bands) — now reproduced inside the SVG
            // filter so Cut Around / Cut to Letter / Acrylic Stand get an identical,
            // hue-preserving look. The previous feSpecularLighting + "arithmetic add" approach
            // washed most of the interior toward white, leaving only the dilated edge/ring
            // showing the true colour (the client's "gold only on the border" bug) and made
            // the overall shape look flat. soft-light/multiply can only ever subtly
            // lighten/darken — they can never wash the base colour out — so Gold (or any
            // colour) now stays visible and solid across the WHOLE filled shape, with a
            // gentle, premium-looking sheen on top.
            const isShiny = finish === 'shiny';
            const hlStops = isShiny
                ? "<stop offset='0%25' stop-color='white' stop-opacity='0'/><stop offset='14%25' stop-color='white' stop-opacity='0.55'/><stop offset='28%25' stop-color='white' stop-opacity='0'/><stop offset='45%25' stop-color='white' stop-opacity='0'/><stop offset='60%25' stop-color='white' stop-opacity='0.45'/><stop offset='76%25' stop-color='white' stop-opacity='0'/><stop offset='92%25' stop-color='white' stop-opacity='0.3'/>"
                : "<stop offset='0%25' stop-color='white' stop-opacity='0.5'/><stop offset='32%25' stop-color='white' stop-opacity='0.06'/><stop offset='55%25' stop-color='white' stop-opacity='0'/>";
            const shStops = isShiny
                ? "<stop offset='0%25' stop-color='black' stop-opacity='0.4'/><stop offset='14%25' stop-color='black' stop-opacity='0'/><stop offset='28%25' stop-color='black' stop-opacity='0.3'/><stop offset='45%25' stop-color='black' stop-opacity='0.5'/><stop offset='60%25' stop-color='black' stop-opacity='0'/><stop offset='76%25' stop-color='black' stop-opacity='0.35'/><stop offset='100%25' stop-color='black' stop-opacity='0.25'/>"
                : "<stop offset='45%25' stop-color='black' stop-opacity='0'/><stop offset='78%25' stop-color='black' stop-opacity='0.28'/><stop offset='100%25' stop-color='black' stop-opacity='0.5'/>";
            const svgGrad = (stops, gid) =>
                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'>" +
                "<defs><linearGradient id='" + gid + "' x1='0%25' y1='0%25' x2='90%25' y2='100%25'>" + stops + "</linearGradient></defs>" +
                "<rect width='100' height='100' fill='url(%23" + gid + ")'/></svg>";

            s += '<feImage href="' + svgGrad(hlStops, 'h') + '" result="hlImg" preserveAspectRatio="none"/>' +
                '<feComposite in="hlImg" in2="shape" operator="in" result="hlIn"/>' +
                '<feBlend in="base" in2="hlIn" mode="soft-light" result="lit"/>' +
                '<feImage href="' + svgGrad(shStops, 's') + '" result="shImg" preserveAspectRatio="none"/>' +
                '<feComposite in="shImg" in2="shape" operator="in" result="shIn"/>' +
                '<feBlend in="lit" in2="shIn" mode="multiply"/>';
        }

        return s + '</filter>';
    };

    return outline('moz-outline-loose-' + blockId, outlineInner, outlineOuter, regionLoose) +
        outline('moz-outline-tight-' + blockId, outlineInnerTight, outlineOuterTight, regionTight) +
        fill('moz-solid-fill-loose-' + blockId, fillRadiusLoose, regionLoose) +
        fill('moz-solid-fill-tight-' + blockId, fillRadiusTight, regionTight);
}

// Builds Colour swatches, Backboard Colour/Style options, Size cards, and Add-ons from
// compact JSON instead of large repeated Liquid markup — same purpose as
// renderNeonFontsAndSymbols above, needed to stay under the extension's 100KB Liquid cap.
function renderNeonDynamicOptions(root) {
    const coloursDataEl = root.querySelector('[data-neon-colours-data]');
    const swatchesEl = root.querySelector('[data-colour-swatches]');
    const colourNameLabelEl = root.querySelector('[data-colour-name-label]');
    if (coloursDataEl && swatchesEl) {
        let colours = [];
        try { colours = JSON.parse(coloursDataEl.textContent) || []; } catch (err) { console.error('Neon Configurator: failed to parse colours JSON.', err); }
        colours.forEach((c, i) => {
            const item = document.createElement('div');
            item.className = 'neon-configurator__swatch-item';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'neon-configurator__swatch' + (i === 0 ? ' is-selected' : '');
            btn.style.backgroundColor = c.hex;
            btn.dataset.colourHex = c.hex;
            btn.dataset.colourPrice = c.price;
            btn.dataset.colourName = c.name;
            btn.title = c.name;
            btn.setAttribute('aria-label', c.name);
            item.appendChild(btn);
            const nameSpan = document.createElement('span');
            nameSpan.className = 'neon-configurator__swatch-name';
            nameSpan.textContent = c.name;
            item.appendChild(nameSpan);
            swatchesEl.appendChild(item);
        });
        if (colourNameLabelEl && colours.length) {
            colourNameLabelEl.textContent = 'Selected: ' + colours[0].name;
        }
    }

    const backboardColoursDataEl = root.querySelector('[data-neon-backboard-colours-data]');
    const backboardColourSelectEl = root.querySelector('[data-backboard-colour-select]');
    if (backboardColoursDataEl && backboardColourSelectEl) {
        let bColours = [];
        try { bColours = JSON.parse(backboardColoursDataEl.textContent) || []; } catch (err) { console.error('Neon Configurator: failed to parse backboard colours JSON.', err); }
        let defaultLabel = null;
        let minSort = Infinity;
        bColours.forEach((c) => { if (c.sortOrder < minSort) { minSort = c.sortOrder; defaultLabel = c.label; } });
        bColours.forEach((c) => {
            const option = document.createElement('option');
            option.value = c.label;
            option.dataset.price = c.price;
            option.dataset.hex = c.hex;
            option.dataset.isClear = c.isClear ? 'true' : 'false';
            option.dataset.finish = c.finish;
            option.dataset.sortOrder = c.sortOrder;
            option.textContent = c.label;
            if (c.label === defaultLabel) option.selected = true;
            backboardColourSelectEl.appendChild(option);
        });
    }

    const sizesDataEl = root.querySelector('[data-neon-sizes-data]');
    const sizeCardsEl = root.querySelector('[data-size-cards]');
    const sizeSelectEl = root.querySelector('[data-size-select]');
    if (sizesDataEl && sizeCardsEl && sizeSelectEl) {
        let sizes = [];
        try { sizes = JSON.parse(sizesDataEl.textContent) || []; } catch (err) { console.error('Neon Configurator: failed to parse sizes JSON.', err); }
        let defaultWidth = null;
        let minSort = Infinity;
        sizes.forEach((s) => { if (s.sortOrder < minSort) { minSort = s.sortOrder; defaultWidth = s.width; } });
        sizes.forEach((s) => {
            const isDefault = s.width === defaultWidth;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'neon-configurator__size-card' + (isDefault ? ' is-selected' : '');
            card.dataset.sortOrder = s.sortOrder;
            card.dataset.sizeWidth = s.width;
            let inner = '';
            if (s.badge) inner += '<span class="neon-configurator__size-card-badge">' + s.badge + '</span>';
            inner += '<span class="neon-configurator__size-card-label">' + s.label + '</span>';
            inner += '<span class="neon-configurator__size-card-price">$' + s.price + '</span>';
            inner += '<span class="neon-configurator__size-card-meta">Length: ' + s.width + 'cm</span>';
            card.innerHTML = inner;
            sizeCardsEl.appendChild(card);

            const option = document.createElement('option');
            option.value = s.width;
            option.dataset.price = s.price;
            option.dataset.height = s.height;
            option.dataset.sortOrder = s.sortOrder;
            option.textContent = s.label;
            if (isDefault) option.selected = true;
            sizeSelectEl.appendChild(option);
        });
    }

    const stylesDataEl = root.querySelector('[data-neon-backboard-styles-data]');
    const styleCardsEl = root.querySelector('[data-backboard-style-cards]');
    const styleSelectEl = root.querySelector('[data-backboard-style-select]');
    if (stylesDataEl && styleCardsEl && styleSelectEl) {
        let styles = [];
        try { styles = JSON.parse(stylesDataEl.textContent) || []; } catch (err) { console.error('Neon Configurator: failed to parse backboard styles JSON.', err); }
        let defaultLabel = null;
        let minSort = Infinity;
        styles.forEach((s) => { if (s.sortOrder < minSort) { minSort = s.sortOrder; defaultLabel = s.label; } });
        styles.forEach((s) => {
            const isDefault = s.label === defaultLabel;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'neon-configurator__style-card' + (isDefault ? ' is-selected' : '');
            card.dataset.sortOrder = s.sortOrder;
            card.dataset.styleLabel = s.label;
            const thumb = s.previewImage
                ? '<img src="' + s.previewImage + '" alt="' + s.label + '" width="80" height="60" loading="lazy">'
                : '<span class="neon-configurator__style-card-fallback" data-shape-fallback="' + s.shape + '">Hello</span>';
            card.innerHTML = '<span class="neon-configurator__style-card-thumb">' + thumb + '</span>' +
                '<span class="neon-configurator__style-card-label">' + s.label + '</span>' +
                '<span class="neon-configurator__style-card-price">' + (s.price ? '+$' + s.price : 'FREE') + '</span>';
            styleCardsEl.appendChild(card);

            const option = document.createElement('option');
            option.value = s.label;
            option.dataset.price = s.price;
            option.dataset.shape = s.shape;
            option.dataset.sortOrder = s.sortOrder;
            option.dataset.shelfImage = s.shelfImage || '';
            option.textContent = s.label;
            if (isDefault) option.selected = true;
            styleSelectEl.appendChild(option);
        });
    }

    const addonsDataEl = root.querySelector('[data-neon-addons-data]');
    const optionalField = root.querySelector('[data-optional-addons-field]');
    const optionalList = root.querySelector('[data-optional-addons-list]');
    const includedListEl = root.querySelector('[data-included-list]');
    if (addonsDataEl) {
        let addons = [];
        try { addons = JSON.parse(addonsDataEl.textContent) || []; } catch (err) { console.error('Neon Configurator: failed to parse addons JSON.', err); }
        const paidAddons = addons.filter((a) => !a.isFree);
        const freeAddons = addons.filter((a) => a.isFree);

        if (paidAddons.length && optionalField && optionalList) {
            optionalField.hidden = false;
            paidAddons.forEach((a) => {
                const label = document.createElement('label');
                label.className = 'neon-configurator__checkbox-row';
                label.innerHTML = '<input type="checkbox" data-addon-checkbox data-addon-label="' + a.label + '" data-price="' + a.price + '"><span>' + a.label + ' (+$' + a.price + ')</span>';
                optionalList.appendChild(label);
            });
        }

        if (includedListEl) {
            freeAddons.forEach((a) => {
                const li = document.createElement('li');
                li.textContent = a.label;
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.setAttribute('data-addon-checkbox', '');
                cb.dataset.addonLabel = a.label;
                cb.dataset.price = a.price;
                cb.checked = true;
                cb.disabled = true;
                cb.hidden = true;
                li.appendChild(cb);
                includedListEl.appendChild(li);
            });
        }
    }
}

// Measures the theme's sticky/fixed header (stuck position + height) so the preview can sit
// exactly below it instead of hiding its top part under the header. Returns 0 if none found.
function detectStickyHeaderHeight() {
    const selectors = 'header, header-component, .header-wrapper, .shopify-section-group-header-group, [id*="header" i]';
    let maxBottom = 0;
    document.querySelectorAll(selectors).forEach((el) => {
        if (el.closest('.neon-configurator')) return;
        const cs = window.getComputedStyle(el);
        if (cs.position !== 'sticky' && cs.position !== 'fixed') return;
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const height = el.getBoundingClientRect().height;
        if (height <= 0 || height > window.innerHeight / 2) return;
        const stuckTop = parseFloat(cs.top) || 0;
        maxBottom = Math.max(maxBottom, stuckTop + height);
    });
    return Math.round(maxBottom);
}

// Only runs when "Auto-detect sticky header height" is ON in the block settings.
// When OFF, the manual "Sticky header height" setting (set in Liquid) is used as-is.
function setupAutoHeaderOffset(root) {
    if (root.dataset.autoHeaderOffset !== 'true') return;
    const apply = () => {
        root.style.setProperty('--moz-header-offset', detectStickyHeaderHeight() + 'px');
    };
    apply();
    window.addEventListener('load', apply);
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(apply, 150);
    });
}

function initConfigurator(root) {
    renderNeonFontsAndSymbols(root);
    renderNeonDynamicOptions(root);
    // Admin "Sort Order" drives the on-screen order (first item = default).
    sortBySortOrder(root.querySelector('[data-backboard-style-cards]'));
    sortBySortOrder(root.querySelector('[data-backboard-style-select]'));
    sortBySortOrder(root.querySelector('[data-backboard-colour-select]'));
    sortBySortOrder(root.querySelector('[data-unit-tabs]'));
    sortBySortOrder(root.querySelector('[data-effect-modes]'));
    sortBySortOrder(root.querySelector('[data-size-cards]'));
    sortBySortOrder(root.querySelector('[data-size-select]'));
    (function sortPowerAdapter() {
        const select = root.querySelector('[data-power-adapter-select]');
        if (!select) return;
        sortBySortOrder(select);
        // Default to the first option in the Admin-defined "most popular first" order
        // (e.g. Australia, then USA) after reordering.
        select.selectedIndex = 0;
    })();
    const textFlex = root.querySelector('[data-text-flex]');
    const textInput = root.querySelector('[data-text-input]');
    const fontSelect = root.querySelector('[data-font-select]');
    const fontCards = root.querySelectorAll('[data-font-cards] .neon-configurator__font-card');
    const fontDropdownTrigger = root.querySelector('[data-font-dropdown-trigger]');
    const fontDropdownPanel = root.querySelector('[data-font-dropdown-panel]');
    const fontDropdownPreview = root.querySelector('[data-font-dropdown-preview]');
    const symbolDropdownTrigger = root.querySelector('[data-symbol-dropdown-trigger]');
    const symbolDropdownPanel = root.querySelector('[data-symbol-dropdown-panel]');
    const symbolDropdownPreview = root.querySelector('[data-symbol-dropdown-preview]');
    const symbolPositionRadios = root.querySelectorAll('[data-symbol-position-radio]');
    const contentFlex = root.querySelector('[data-content-flex]');
    const shapeText = root.querySelector('[data-shape-text]');
    const shapeIcons = root.querySelector('[data-shape-icons]');
    const sizeCards = root.querySelectorAll('[data-size-cards] .neon-configurator__size-card');
    const oversizedNotice = root.querySelector('[data-oversized-notice]');
    const outdoorWarningModal = root.querySelector('[data-outdoor-warning-modal]');
    const outdoorWarningCloseBtn = root.querySelector('[data-outdoor-warning-close]');
    let outdoorUnavailableShown = false;

    // Outdoor acrylic neon only fits 60cm+. Indoor (flex neon) works at every size.
    function isOutdoorAllowed() { return currentWidthCm >= 60; }

    function updateOutdoorAvailability() {
        const allowed = isOutdoorAllowed();
        neonTypeCards.forEach((card) => {
            if (card.dataset.neonTypeKey === 'outdoor') {
                card.disabled = !allowed;
                card.classList.toggle('is-disabled', !allowed);
            }
        });
        if (allowed) {
            outdoorUnavailableShown = false;
            return;
        }
        if (currentNeonType === 'outdoor') {
            const indoorCard = Array.from(neonTypeCards).find((c) => c.dataset.neonTypeKey === 'indoor');
            if (indoorCard) {
                neonTypeCards.forEach((c) => c.classList.remove('is-selected'));
                indoorCard.classList.add('is-selected');
                currentNeonType = 'indoor';
                currentNeonTypePrice = parseFloat(indoorCard.dataset.neonTypePrice) || 0;
                updateOutdoorThicknessVisibility();
                updateSizeFieldsVisibility();
                calculateTotal();
            }
            if (outdoorWarningModal && !outdoorUnavailableShown) {
                outdoorWarningModal.hidden = false;
                outdoorUnavailableShown = true;
            }
        }
    }
    if (outdoorWarningCloseBtn && outdoorWarningModal) {
        outdoorWarningCloseBtn.addEventListener('click', () => { outdoorWarningModal.hidden = true; });
    }
    const includedPowerAdapterLi = root.querySelector('[data-included-power-adapter]');
    let currentSymbolPosition = 'left';
    const swatches = root.querySelectorAll('[data-colour-swatches] .neon-configurator__swatch');
    const colourNameLabel = root.querySelector('[data-colour-name-label]');
    const sizeSelect = root.querySelector('[data-size-select]');
    const backboardStyleSelect = root.querySelector('[data-backboard-style-select]');
    const backboardStyleCards = root.querySelectorAll('[data-backboard-style-cards] .neon-configurator__style-card');
    const backboardColourSelect = root.querySelector('[data-backboard-colour-select]');
    const backboardColourCardsEl = root.querySelector('[data-backboard-colour-cards]');
    const addonCheckboxes = root.querySelectorAll('[data-addon-checkbox]');
    const totalPriceEl = root.querySelector('[data-total-price]');
    const previewInner = root.querySelector('[data-preview-inner]');
    const shapeSource = root.querySelector('[data-shape-source]');
    const backboardDefs = root.querySelector('[data-backboard-defs]');
    let shapeFilterValue = 'none';
    const textWrap = root.querySelector('[data-text-wrap]');
    const BACKBOARD_SOLID_SHAPES = ['rectangle', 'open-box', 'acrylic-stand-middle'];
    const previewStage = root.querySelector('[data-preview-stage]');
    const widthLabel = root.querySelector('[data-width-label]');
    const heightLabel = root.querySelector('[data-height-label]');
    const widthDimLine = root.querySelector('.neon-configurator__dim-line--width');
    const heightDimLine = root.querySelector('.neon-configurator__dim-line--height');
    const powerToggle = root.querySelector('[data-power-toggle]');
    const powerLabel = root.querySelector('[data-power-label]');
    const measurementsToggle = root.querySelector('[data-measurements-toggle]');
    const measurementsLabel = root.querySelector('[data-measurements-label]');
    const wallpaperToggle = root.querySelector('[data-wallpaper-toggle]');
    const wallpaperLabel = root.querySelector('[data-wallpaper-label]');
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
    let iconColours = [];
    const symbolButtons = root.querySelectorAll('[data-symbol-buttons] .neon-configurator__symbol-btn');
    const iconsContainer = root.querySelector('[data-preview-icons]');
    let selectedSymbols = [];
    const previewBox = root.querySelector('[data-preview-box]');
    const bgThumbs = root.querySelectorAll('[data-bg-thumbs] .neon-configurator__bg-thumb');
    let selectedColourHex = swatches.length ? swatches[0].dataset.colourHex : '#ffffff';
    let selectedColourPrice = swatches.length ? parseFloat(swatches[0].dataset.colourPrice) || 0 : 0;
    let currentTotal = 0;
    let currentWidthCm = 0;
    let currentHeightCm = 0;
    const BACKBOARD_SHAPES = ['rectangle', 'cut-around', 'cut-to-letter', 'naked', 'open-box', 'acrylic-stand-middle'];

    const powerAdapterSelect = root.querySelector('[data-power-adapter-select]');
    const addToCartBtn = root.querySelector('[data-add-to-cart]');
    const addToCartStatus = root.querySelector('[data-add-to-cart-status]');
    let textRotation = 0;

    // --- Installation Option + Booking ---
    const installRadios = root.querySelectorAll('[data-install-radio]');
    const installBooking = root.querySelector('[data-install-booking]');
    const installDateInput = root.querySelector('[data-install-date]');
    const installTimeSelect = root.querySelector('[data-install-time]');
    const installAddressInput = root.querySelector('[data-install-address]');
    let installationSelected = false;
    let installationPrice = 0;

    function populateInstallTimeSlots() {
        if (!installTimeSelect || !installBooking) return;
        const earliest = installBooking.dataset.earliestTime || '10:00';
        const latest = installBooking.dataset.latestTime || '17:00';
        const interval = parseInt(installBooking.dataset.slotInterval, 10) || 60;

        const [startH, startM] = earliest.split(':').map(Number);
        const [endH, endM] = latest.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        installTimeSelect.innerHTML = '';
        for (let m = startMinutes; m <= endMinutes; m += interval) {
            const h24 = Math.floor(m / 60);
            const mm = m % 60;
            const period = h24 >= 12 ? 'PM' : 'AM';
            const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
            const label = h12 + ':' + String(mm).padStart(2, '0') + ' ' + period;
            const option = document.createElement('option');
            option.value = label;
            option.textContent = label;
            installTimeSelect.appendChild(option);
        }
    }

    function setInstallMinDate() {
        if (!installDateInput || !installBooking) return;
        const leadDays = parseInt(installBooking.dataset.minLeadDays, 10) || 14;
        const minDate = new Date();
        minDate.setDate(minDate.getDate() + leadDays);
        const isoMin = minDate.toISOString().split('T')[0];
        installDateInput.min = isoMin;
        if (!installDateInput.value) installDateInput.value = isoMin;
    }

    installRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            installationSelected = radio.value === 'yes';
            installationPrice = installationSelected ? (parseFloat(radio.dataset.installPrice) || 0) : 0;
            if (installBooking) installBooking.hidden = !installationSelected;
            if (installationSelected) {
                setInstallMinDate();
                if (installTimeSelect && !installTimeSelect.options.length) populateInstallTimeSlots();
            }
            calculateTotal();
        });
    });

    if (installBooking) populateInstallTimeSlots();

    // --- Neon Type (Indoor/Outdoor) + Outdoor Thickness + Size Visibility ---
    const neonTypeCards = root.querySelectorAll('[data-neon-type-cards] .neon-configurator__neon-type-card');
    const outdoorThicknessField = root.querySelector('[data-outdoor-thickness-field]');
    const outdoorThicknessSelect = root.querySelector('[data-outdoor-thickness-select]');
    const sizeVisibilityFields = root.querySelectorAll('[data-size-field]');
    const initiallySelectedNeonTypeCard = Array.from(neonTypeCards).find((c) => c.classList.contains('is-selected'));
    let currentNeonType = initiallySelectedNeonTypeCard ? initiallySelectedNeonTypeCard.dataset.neonTypeKey : 'indoor';
    let currentNeonTypePrice = initiallySelectedNeonTypeCard ? (parseFloat(initiallySelectedNeonTypeCard.dataset.neonTypePrice) || 0) : 0;

    function updateOutdoorThicknessVisibility() {
        if (!outdoorThicknessField) return;
        outdoorThicknessField.hidden = currentNeonType !== 'outdoor';
    }

    function updateSizeFieldsVisibility() {
        sizeVisibilityFields.forEach((field) => {
            const attr = currentNeonType === 'outdoor' ? 'visibleOutdoor' : 'visibleIndoor';
            const isVisible = field.dataset[attr] !== 'false';
            field.hidden = !isVisible;

            // If the Custom Size Slider just got hidden while it was the active size source,
            // fall back to the preset "Choose Size" dropdown so pricing/preview stays correct.
            if (field.dataset.sizeField === 'custom-slider' && !isVisible && customSizeActive) {
                customSizeActive = false;
                updatePreviewScale();
                calculateTotal();
            }
        });
    }

    function selectNeonType(card) {
        if (card.dataset.neonTypeKey === 'outdoor' && !isOutdoorAllowed()) {
            if (outdoorWarningModal) outdoorWarningModal.hidden = false;
            return;
        }
        neonTypeCards.forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        currentNeonType = card.dataset.neonTypeKey;
        currentNeonTypePrice = parseFloat(card.dataset.neonTypePrice) || 0;
        updateOutdoorThicknessVisibility();
        updateSizeFieldsVisibility();
        calculateTotal();
    }

    neonTypeCards.forEach((card) => {
        card.addEventListener('click', () => selectNeonType(card));
    });

    if (outdoorThicknessSelect) {
        outdoorThicknessSelect.addEventListener('change', calculateTotal);
    }

    const selectionBox = root.querySelector('[data-selection-box]');
    let groupOffsetX = 0;
    let groupOffsetY = 0;
    let letterOffsets = [];
    let letterScales = [];
    let groupScale = 1;
    let baseFontSize = 48;
    let selectedLetterIndex = null;
    // Keeps Quick Symbol icon size proportional to the current text size — same ratio as
    // the original fixed 48px font / 42px icon default — so icons scale up/down together
    // with Choose Size / the custom slider / whole-group resize, instead of staying fixed.
    const ICON_SIZE_RATIO = 42 / 48;
    function updateIconSize() {
        const size = Math.max(16, baseFontSize * groupScale * ICON_SIZE_RATIO);
        root.style.setProperty('--neon-icon-size', size + 'px');
    }

    // 'letter' | 'icon' | null — tracks which system currently owns the shared selection box
    let activeSelectionKind = null;
    let iconOffsets = [];
    let iconScales = [];
    let iconGroupScale = 1;
    let selectedIconIndex = null;

    const letterPopup = root.querySelector('[data-letter-popup]');
    const letterPopupTitle = root.querySelector('[data-letter-popup-title]');
    const letterPopupSwatches = root.querySelector('[data-letter-popup-swatches]');
    let activeLetterIndex = null;
    let activeLetterSpan = null;
    let activeIconIndex = null;
    let activeIconSpan = null;

    function showColourJumpPin(targetEl) {
        if (!targetEl || !previewInner) return;
        const innerRect = previewInner.getBoundingClientRect();
        const elRect = targetEl.getBoundingClientRect();
        const pin = document.createElement('span');
        pin.className = 'neon-configurator__colour-pin';
        pin.textContent = '📍';
        pin.style.left = (elRect.left - innerRect.left + elRect.width / 2) + 'px';
        pin.style.top = (elRect.top - innerRect.top - 22) + 'px';
        previewInner.appendChild(pin);
        setTimeout(() => { pin.remove(); }, 550);
    }

    function closeLetterPopup() {
        if (letterPopup) letterPopup.hidden = true;
        activeLetterIndex = null;
        activeLetterSpan = null;
        activeIconIndex = null;
        activeIconSpan = null;
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
                if (activeLetterSpan) {
                    activeLetterSpan.style.color = hex;
                    showColourJumpPin(activeLetterSpan);
                }
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

    // Same shared popup, used when Multicoloured Text is active and the customer clicks a
    // Quick Symbol icon instead of a letter — lets each symbol also get its own colour.
    function openIconColourPopup(index, span) {
        if (!letterPopup || !letterPopupSwatches || !previewStage) return;
        activeLetterIndex = null;
        activeLetterSpan = null;
        activeIconIndex = index;
        activeIconSpan = span;

        if (letterPopupTitle) {
            letterPopupTitle.textContent = 'Set colour for symbol';
        }

        const hexList = swatches.length ? Array.from(swatches).map((s) => s.dataset.colourHex) : ['#ffffff'];
        letterPopupSwatches.innerHTML = '';
        hexList.forEach((hex) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'neon-configurator__letter-popup-swatch';
            btn.style.backgroundColor = hex;
            if (iconColours[index] === hex) btn.classList.add('is-selected');
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                iconColours[index] = hex;
                if (activeIconSpan) {
                    activeIconSpan.style.color = hex;
                    showColourJumpPin(activeIconSpan);
                }
                closeLetterPopup();
            });
            letterPopupSwatches.appendChild(btn);
        });

        const stageRect = previewStage.getBoundingClientRect();
        const iconRect = span.getBoundingClientRect();
        letterPopup.style.left = (iconRect.left - stageRect.left + iconRect.width / 2) + 'px';
        letterPopup.style.top = (iconRect.top - stageRect.top) + 'px';
        letterPopup.hidden = false;
    }

    document.addEventListener('click', (event) => {
        if (!letterPopup || letterPopup.hidden) return;
        if (letterPopup.contains(event.target)) return;
        if (activeLetterSpan && activeLetterSpan.contains(event.target)) return;
        if (activeIconSpan && activeIconSpan.contains(event.target)) return;
        closeLetterPopup();
    });

    function computeLetterTransform(i) {
        const off = letterOffsets[i] || { x: 0, y: 0 };
        const scale = letterScales[i] || 1;
        return 'translate(' + (groupOffsetX + off.x) + 'px, ' + (groupOffsetY + off.y) + 'px) scale(' + scale + ')';
    }

    function applyLetterTransform(span, i) {
        const transformStr = computeLetterTransform(i);
        span.style.transform = transformStr;
        // Keep the hidden shape-source clone's matching letter perfectly aligned —
        // same index, same transform — so the outline always hugs the real letter's
        // exact position, even after dragging/resizing an individual letter.
        if (shapeText && shapeText.children[i]) {
            shapeText.children[i].style.transform = transformStr;
        }
    }

    function refreshAllLetterTransforms() {
        if (!textFlex) return;
        textFlex.querySelectorAll('.neon-configurator__letter').forEach((span) => {
            applyLetterTransform(span, Number(span.dataset.letterIndex));
        });
    }

    function hideSelectionBox() {
        if (selectionBox) selectionBox.hidden = true;
        if (textFlex) {
            textFlex.querySelectorAll('.neon-configurator__letter').forEach((s) => s.classList.remove('is-selected'));
        }
        if (iconsContainer) {
            iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((s) => s.classList.remove('is-selected'));
        }
        activeSelectionKind = null;
    }

    function showSelectionBoxAround(el) {
        if (!selectionBox || !previewInner || !el) return;
        // Positioned relative to previewInner, NOT previewStage — selectionBox is a direct
        // DOM child of previewInner (its real containing block, since previewInner has
        // position:relative). Using a different, non-parent ancestor here was what produced
        // the fixed offset between the box and the actually-clicked letter/icon.
        const innerRect = previewInner.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        selectionBox.style.left = (elRect.left - innerRect.left - 6) + 'px';
        selectionBox.style.top = (elRect.top - innerRect.top - 6) + 'px';
        selectionBox.style.width = (elRect.width + 12) + 'px';
        selectionBox.style.height = (elRect.height + 12) + 'px';
        selectionBox.hidden = false;
    }

    function selectLetter(index) {
        hideSelectionBox();
        activeSelectionKind = 'letter';
        selectedLetterIndex = index;
        textFlex.querySelectorAll('.neon-configurator__letter').forEach((s) => {
            s.classList.toggle('is-selected', Number(s.dataset.letterIndex) === index);
        });
        const target = textFlex.querySelector('[data-letter-index="' + index + '"]');
        showSelectionBoxAround(target);
    }

    function selectGroup() {
        hideSelectionBox();
        activeSelectionKind = 'letter';
        selectedLetterIndex = null;
        showSelectionBoxAround(textFlex);
    }

    function applyIconTransform(span, i) {
        const off = iconOffsets[i] || { x: 0, y: 0 };
        const scale = iconScales[i] || 1;
        span.style.transform = 'translate(' + off.x + 'px, ' + off.y + 'px) scale(' + scale + ')';
    }

    function refreshAllIconTransforms() {
        if (!iconsContainer) return;
        iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((span) => {
            applyIconTransform(span, Number(span.dataset.iconIndex));
        });
    }

    function updateIconsContainerTransform() {
        if (!iconsContainer) return;
        iconsContainer.style.transform = 'rotate(' + textRotation + 'deg) scale(' + iconGroupScale + ')';
    }

    function selectIcon(index) {
        hideSelectionBox();
        activeSelectionKind = 'icon';
        selectedIconIndex = index;
        iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((s) => {
            s.classList.toggle('is-selected', Number(s.dataset.iconIndex) === index);
        });
        const target = iconsContainer.querySelector('[data-icon-index="' + index + '"]');
        showSelectionBoxAround(target);
    }

    function selectIconGroup() {
        hideSelectionBox();
        activeSelectionKind = 'icon';
        selectedIconIndex = null;
        showSelectionBoxAround(iconsContainer);
    }


























    function attachIconDrag(span, i) {
        let startX = 0;
        let startY = 0;
        let startOffX = 0;
        let startOffY = 0;
        let moved = false;

        span.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            span.setPointerCapture(event.pointerId);
            moved = false;
            const off = iconOffsets[i] || { x: 0, y: 0 };
            startOffX = off.x;
            startOffY = off.y;
            startX = event.clientX;
            startY = event.clientY;
        });

        span.addEventListener('pointermove', () => {
            // "Move Sign" removed per client request — icons stay fixed.
            return;
        });

        span.addEventListener('pointerup', (event) => {
            if (span.hasPointerCapture(event.pointerId)) span.releasePointerCapture(event.pointerId);
            if (!moved) {
                if (currentEffectMode === 'multicolour') {
                    openIconColourPopup(i, span);
                    return;
                }
                selectIcon(i);
            }
        });
    }

    function attachLetterDrag(span, i, ch) {
        let startX = 0;
        let startY = 0;
        let startOffX = 0;
        let startOffY = 0;
        let moved = false;
        let draggingWholeGroup = false;

        span.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            span.setPointerCapture(event.pointerId);
            moved = false;
            draggingWholeGroup = selectedLetterIndex !== i;
            startX = event.clientX;
            startY = event.clientY;
            if (draggingWholeGroup) {
                startOffX = groupOffsetX;
                startOffY = groupOffsetY;
            } else {
                const off = letterOffsets[i] || { x: 0, y: 0 };
                startOffX = off.x;
                startOffY = off.y;
            }
        });

        span.addEventListener('pointermove', () => {
            // "Move Sign" removed per client request — letters stay fixed; dragging no
            // longer repositions anything. Click (pointerup below, moved===false) still
            // opens the Multicoloured Text colour popup as before.
            return;
        });

        span.addEventListener('pointerup', (event) => {
            if (span.hasPointerCapture(event.pointerId)) span.releasePointerCapture(event.pointerId);
            if (!moved) {
                if (currentEffectMode === 'multicolour') {
                    openLetterPopup(i, span, ch);
                    return;
                }
                if (selectedLetterIndex === i) {
                    selectGroup();
                } else {
                    selectLetter(i);
                }
            }
        });
    }

    function renderLetters() {
        if (!textFlex) return;
        const value = textInput.value.trim() || 'Your Text';

        if (letterOffsets.length !== value.length) {
            letterOffsets = value.split('').map(() => ({ x: 0, y: 0 }));
            letterScales = value.split('').map(() => 1);
            letterColours = value.split('').map((_, i) => letterColours[i] || (swatches.length ? swatches[0].dataset.colourHex : '#ffffff'));
            selectedLetterIndex = null;
        }

        textFlex.innerHTML = '';
        if (shapeText) shapeText.innerHTML = '';

        value.split('').forEach((ch, i) => {
            const span = document.createElement('span');
            span.className = 'neon-configurator__letter';
            span.textContent = ch === ' ' ? '\u00A0' : ch;
            span.dataset.letterIndex = i;
            span.style.color = currentEffectMode === 'multicolour' ? letterColours[i] : '';
            applyLetterTransform(span, i);
            attachLetterDrag(span, i, ch);
            textFlex.appendChild(span);

            if (shapeText) {
                const shapeSpan = document.createElement('span');
                shapeSpan.className = 'neon-configurator__shape-letter';
                shapeSpan.textContent = ch === ' ' ? '\u00A0' : ch;
                shapeSpan.style.transform = computeLetterTransform(i);
                shapeText.appendChild(shapeSpan);
            }
        });

        hideSelectionBox();
        closeLetterPopup();
        syncShapeSourceStyle();
    }

    function updatePreviewText() {
        renderLetters();
        updateBackboardPanel();
    }

    function updatePreviewFont() {
        if (textFlex) textFlex.style.fontFamily = fontSelect.value;
        syncShapeSourceStyle();
        updateBackboardPanel();
    }

    function updatePreviewTransform() {
        // Rotating the shared wrapper (text-wrap) rotates BOTH the real text and the hidden
        // outline clone together as one unit — simpler and guaranteed in sync.
        if (textWrap) textWrap.style.transform = 'rotate(' + textRotation + 'deg)';
        updateIconsContainerTransform();
    }

    // Keeps the hidden shape-source clone's font/size in sync with the REAL text — purely so
    // the outline always hugs the customer's actual current text/font/size. The clone's WIDTH
    // is no longer copied manually here: it lives inside .neon-configurator__text-wrap (CSS
    // Grid), which forces shape-source and text-flex to always share the identical rendered
    // width automatically — this is what guarantees identical text wrapping between the two
    // (fixes ghost/misaligned outline on wrapped multi-line text). Fully dynamic: called
    // automatically whenever text, font, size, or scale changes.
    function syncShapeSourceStyle() {
        if (!shapeText) return;
        shapeText.style.fontFamily = fontSelect.value;
        shapeText.style.fontSize = (baseFontSize * groupScale) + 'px';
    }

    // The backboard copy (shape-source) is absolutely positioned exactly over the REAL text box,
    // with the identical pixel width, so both always wrap into the same lines (any text length,
    // spaces included). It no longer takes part in the grid sizing.
    function syncShapeSourceBox() {
        if (!shapeSource || !contentFlex || !textWrap) return;
        const c = contentFlex.getBoundingClientRect();
        const w = textWrap.getBoundingClientRect();
        if (!c.width) return;
        shapeSource.style.width = c.width + 'px';
        shapeSource.style.left = (c.left - w.left) + 'px';
        shapeSource.style.top = (c.top - w.top) + 'px';
    }

    // Re-applies the SVG filter so the browser recomputes it against the current layout.
    function applyShapeFilter() {
        if (!shapeSource) return;
        shapeSource.style.filter = 'none';
        void shapeSource.offsetHeight;
        requestAnimationFrame(() => {
            shapeSource.style.filter = shapeFilterValue;
        });
    }

    function setupShapeSourceObserver() {
        if (!contentFlex || typeof ResizeObserver === 'undefined') return;
        let queued = false;
        const ro = new ResizeObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                syncShapeSourceBox();
                applyShapeFilter();
            });
        });
        ro.observe(contentFlex);
    }

    function updateRotationLabel() {
        if (rotationValueLabel) rotationValueLabel.textContent = textRotation + '°';
    }

    if (previewInner) {
        previewInner.addEventListener('pointerdown', (event) => {
            if (event.target === previewInner || event.target === textFlex || event.target === textWrap) {
                selectGroup();
            }
        });
        document.addEventListener('pointerdown', (event) => {
            if (!previewInner.contains(event.target)) {
                hideSelectionBox();
            }
        });
    }

    function attachResizeHandles() {
        if (!selectionBox) return;
        const handles = selectionBox.querySelectorAll('[data-resize-handle]');
        handles.forEach((handle) => {
            handle.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                event.stopPropagation();
                handle.setPointerCapture(event.pointerId);

                const boxRect = selectionBox.getBoundingClientRect();
                const centerX = boxRect.left + boxRect.width / 2;
                const centerY = boxRect.top + boxRect.height / 2;
                const startDist = Math.hypot(event.clientX - centerX, event.clientY - centerY) || 1;
                const startScale = activeSelectionKind === 'icon'
                    ? (selectedIconIndex !== null ? (iconScales[selectedIconIndex] || 1) : iconGroupScale)
                    : (selectedLetterIndex !== null ? (letterScales[selectedLetterIndex] || 1) : groupScale);

                const onMove = (moveEvent) => {
                    const dist = Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY) || 1;
                    const factor = dist / startDist;
                    const newScale = Math.min(3, Math.max(0.3, startScale * factor));

                    if (activeSelectionKind === 'icon') {
                        if (selectedIconIndex !== null) {
                            iconScales[selectedIconIndex] = newScale;
                            const span = iconsContainer.querySelector('[data-icon-index="' + selectedIconIndex + '"]');
                            applyIconTransform(span, selectedIconIndex);
                            showSelectionBoxAround(span);
                        } else {
                            iconGroupScale = newScale;
                            updateIconsContainerTransform();
                            showSelectionBoxAround(iconsContainer);
                        }
                    } else if (selectedLetterIndex !== null) {
                        letterScales[selectedLetterIndex] = newScale;
                        const span = textFlex.querySelector('[data-letter-index="' + selectedLetterIndex + '"]');
                        applyLetterTransform(span, selectedLetterIndex);
                        showSelectionBoxAround(span);
                    } else {
                        groupScale = newScale;
                        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';
                        showSelectionBoxAround(textFlex);
                        syncShapeSourceStyle();
                        updateIconSize();
                        updateBackboardPanel();
                    }
                };

                const onUp = (upEvent) => {
                    handle.releasePointerCapture(upEvent.pointerId);
                    handle.removeEventListener('pointermove', onMove);
                    handle.removeEventListener('pointerup', onUp);
                };

                handle.addEventListener('pointermove', onMove);
                handle.addEventListener('pointerup', onUp);
            });
        });
    }

    function updatePreviewColour() {
        if (currentEffectMode !== 'multicolour' && textFlex) {
            textFlex.style.color = selectedColourHex;
        }
        if (currentEffectMode !== 'multicolour' && iconsContainer) {
            iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((el) => {
                el.style.color = selectedColourHex;
            });
        }
    }

    function renderIcons() {
        if (!iconsContainer) return;

        if (iconOffsets.length !== selectedSymbols.length) {
            iconOffsets = selectedSymbols.map(() => ({ x: 0, y: 0 }));
            iconScales = selectedSymbols.map(() => 1);
            iconColours = selectedSymbols.map((_, i) => iconColours[i] || (swatches.length ? swatches[0].dataset.colourHex : '#ffffff'));
            selectedIconIndex = null;
        }

        iconsContainer.innerHTML = '';
        if (shapeIcons) shapeIcons.innerHTML = '';

        selectedSymbols.forEach((sym, i) => {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'neon-configurator__preview-icon';
            iconSpan.dataset.iconIndex = i;
            iconSpan.style.webkitMaskImage = 'url("' + sym.url + '")';
            iconSpan.style.maskImage = 'url("' + sym.url + '")';
            iconSpan.style.color = currentEffectMode === 'multicolour' ? (iconColours[i] || selectedColourHex) : selectedColourHex;
            iconSpan.title = sym.label;
            applyIconTransform(iconSpan, i);
            attachIconDrag(iconSpan, i);
            iconsContainer.appendChild(iconSpan);

            // Mirror into shape-icons (solid black, no glow/mask-position offset) so the
            // backboard outline/fill silhouette also wraps around the icons, not just text.
            if (shapeIcons) {
                const shapeIconSpan = document.createElement('span');
                shapeIconSpan.className = 'neon-configurator__preview-icon';
                shapeIconSpan.style.webkitMaskImage = 'url("' + sym.url + '")';
                shapeIconSpan.style.maskImage = 'url("' + sym.url + '")';
                shapeIconSpan.style.backgroundColor = '#050505';
                shapeIconSpan.style.filter = 'none';
                shapeIconSpan.style.transform = 'translate(' + (iconOffsets[i]?.x || 0) + 'px, ' + (iconOffsets[i]?.y || 0) + 'px) scale(' + (iconScales[i] || 1) + ')';
                shapeIcons.appendChild(shapeIconSpan);
            }
        });

        if (activeSelectionKind === 'icon') hideSelectionBox();
        updatePowerState();
        updateIconSize();
        updateBackboardPanel();
    }

    function updateSymbolPositionClass() {
        [contentFlex, shapeSource].forEach((el) => {
            if (!el) return;
            ['symbols-left', 'symbols-right', 'symbols-top', 'symbols-bottom'].forEach((cls) => el.classList.remove(cls));
            el.classList.add('symbols-' + currentSymbolPosition);
        });
    }

    symbolPositionRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            currentSymbolPosition = radio.value;
            updateSymbolPositionClass();
        });
    });

    function updatePreviewScale() {
        let widthValue;
        let heightValue;
        let unit = 'cm';

        if (customSizeActive && customSizeSlider) {
            widthValue = parseFloat(customSizeSlider.value) || 60;
            const heightRatio = parseFloat(customSizeSlider.dataset.heightRatio) || 2.6;
            heightValue = Math.round((widthValue / heightRatio) * 10) / 10;
            unit = customSizeSlider.dataset.unit || 'cm';

            if (sliderWidthLabel) sliderWidthLabel.textContent = 'Width: ' + widthValue + ' ' + unit;
            if (sliderHeightLabel) sliderHeightLabel.textContent = 'Height: ' + heightValue + ' ' + unit;
        } else {
            const sizeOption = sizeSelect.options[sizeSelect.selectedIndex];
            widthValue = parseFloat(sizeOption?.value) || 60;
            heightValue = parseFloat(sizeOption?.dataset.height) || Math.round(widthValue / 2.6);
        }

        // Non-linear (sqrt-based) scaling instead of a flat multiplier: keeps very small
        // sizes (e.g. 40cm) readable in the preview — the client flagged 40cm text as too
        // tiny to read — while still growing sensibly for large signs without the text
        // becoming huge relative to the fixed-size preview stage.
        baseFontSize = Math.min(130, Math.max(34, Math.sqrt(widthValue) * 6.3));
        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';
        syncShapeSourceStyle();
        updateIconSize();

        if (widthLabel) {
            widthLabel.textContent = widthValue + ' ' + unit;
        }
        if (heightLabel) {
            heightLabel.textContent = heightValue + ' ' + unit;
        }

        // The manufacturer blueprint PDF always expects width/height in centimetres,
        // regardless of which unit the customer used on the custom size slider.
        const UNIT_TO_CM = { cm: 1, mm: 0.1, inch: 2.54, ft: 30.48 };
        const cmFactor = UNIT_TO_CM[unit] || 1;
        currentWidthCm = Math.round(widthValue * cmFactor * 10) / 10;
        currentHeightCm = Math.round(heightValue * cmFactor * 10) / 10;

        if (oversizedNotice) oversizedNotice.hidden = currentWidthCm <= 200;
        updateBackboardPanel();
        updateOutdoorAvailability();
    }

    // Keeps the Width/Height dimension lines hugging the ACTUAL rendered sign box
    // (previewInner) instead of a fixed CSS position — so the width line grows/shrinks
    // exactly with the customer's real text length (including after wrapping to a new
    // line), and the height line reflects the real rendered height instead of a fixed
    // oversized line. Driven by a ResizeObserver on previewInner so it stays correct
    // automatically for every cause of a size change (typing, font, wrap, backboard
    // style/padding, size slider) without needing a manual call at every call site.
    function updateDimensionLines() {
        if (!previewStage || !previewInner) return;
        const stageRect = previewStage.getBoundingClientRect();
        const innerRect = previewInner.getBoundingClientRect();
        if (!innerRect.width || !innerRect.height) return;

        if (widthDimLine) {
            widthDimLine.style.left = (innerRect.left - stageRect.left) + 'px';
            widthDimLine.style.width = innerRect.width + 'px';
            widthDimLine.style.top = (innerRect.bottom - stageRect.top + 14) + 'px';
        }
        if (heightDimLine) {
            heightDimLine.style.top = (innerRect.top - stageRect.top) + 'px';
            heightDimLine.style.height = innerRect.height + 'px';
            heightDimLine.style.left = (innerRect.right - stageRect.left + 14) + 'px';
        }
    }

    let dimResizeObserver = null;
    function setupDimensionObserver() {
        if (!previewInner || typeof ResizeObserver === 'undefined') return;
        dimResizeObserver = new ResizeObserver(() => updateDimensionLines());
        dimResizeObserver.observe(previewInner);
        window.addEventListener('resize', updateDimensionLines);
    }

    let wallShelfEl = null;
    function ensureWallShelf() {
        if (wallShelfEl || !previewInner) return;
        wallShelfEl = document.createElement('div');
        wallShelfEl.className = 'neon-configurator__wall-shelf';
        wallShelfEl.setAttribute('aria-hidden', 'true');
        wallShelfEl.hidden = true;
        previewInner.appendChild(wallShelfEl);
    }

    function updateBackboardPanel() {
        if (!previewInner) return;

        const styleOption = backboardStyleSelect?.options[backboardStyleSelect.selectedIndex];
        const shape = styleOption?.dataset.shape || 'rectangle';

        BACKBOARD_SHAPES.forEach((s) => previewInner.classList.remove('backboard--' + s));
        previewInner.classList.add('backboard--' + shape);

        const colourOption = backboardColourSelect?.options[backboardColourSelect.selectedIndex];
        const hex = colourOption?.dataset.hex || '#e8e8e8';
        const isClear = colourOption?.dataset.isClear === 'true';

        // Clear/Transparent -> forced neutral grey outline (never the stored hex, so a
        // wrongly-entered admin colour on the "Clear" row can never show as bold/pink).
        // Any other colour -> its real hex, used for a SOLID filled backing.
        root.style.setProperty('--moz-backboard-color', isClear ? '#9a9a9a' : hex);
        previewInner.classList.toggle('is-solid-fill', !isClear && BACKBOARD_SOLID_SHAPES.includes(shape));

        const finish = resolveBackboardFinish(colourOption);
        ['clear', 'gloss', 'shiny', 'frosted'].forEach((f) => previewInner.classList.remove('finish--' + f));
        previewInner.classList.add('finish--' + finish);

        const blockId = root.dataset.blockId;
        // Rounded to the nearest 4px so tiny drag-resize movements don't rebuild the SVG
        // filter on every pointermove — only rebuilds when the size changes enough to
        // actually matter for how far the connecting shape needs to bridge.
        const currentFontSizePx = Math.round((baseFontSize * groupScale) / 4) * 4;
        if (backboardDefs) {
            const defsHex = isClear ? '#9a9a9a' : hex;
            const defsKey = blockId + '|' + finish + '|' + defsHex + '|' + currentFontSizePx;
            if (backboardDefs.dataset.key !== defsKey) {
                backboardDefs.innerHTML = buildBackboardFilters(blockId, defsHex, finish, currentFontSizePx);
                backboardDefs.dataset.key = defsKey;
            }
        }
        let filterValue = 'none';
        let isActive = false;

        // The SVG outline/fill filter is ONLY for the shape-hugging styles (Cut Around, Cut
        // to Letter, Acrylic Stand). It must NEVER apply to Rectangle/Open Box/Naked, which
        // already render their own backboard entirely via CSS (border or solid background).
        // Previously `isClear` was checked BEFORE the shape, so selecting Clear Colour on
        // Rectangle also painted the Cut Around-style outline underneath it, making it look
        // like two backboard styles were selected at once.
        const isShapeHugging = shape === 'cut-around' || shape === 'cut-to-letter' || shape === 'acrylic-stand-middle';

        if (shape === 'naked' || !isShapeHugging) {
            filterValue = 'none';
            isActive = false;
        } else if (isClear) {
            // Thin outline only, hugging text + icons together.
            const filterId = shape === 'cut-to-letter' ? 'moz-outline-tight-' : 'moz-outline-loose-';
            filterValue = 'url(#' + filterId + blockId + ')';
            isActive = true;
        } else {
            // Solid coloured backing following the exact silhouette of text + icons.
            const fillId = shape === 'cut-to-letter' ? 'moz-solid-fill-tight-' : 'moz-solid-fill-loose-';
            filterValue = 'url(#' + fillId + blockId + ')';
            isActive = true;
        }

        shapeFilterValue = filterValue;
        if (shapeSource) {
            shapeSource.classList.toggle('is-active', isActive);
            shapeSource.style.display = isActive ? '' : 'none';
            syncShapeSourceBox();
            applyShapeFilter();
        }

        // Floating wood shelf under the sign — only for Acrylic Stand. Uses the Admin-
        // uploaded photo (Backboard Style -> Stand Shelf Photo) if present for an exact
        // match to the client's reference; otherwise falls back to the CSS wood gradient.
        ensureWallShelf();
        if (wallShelfEl) {
            const isStand = shape === 'acrylic-stand-middle';
            wallShelfEl.hidden = !isStand;
            const shelfUrl = styleOption?.dataset.shelfImage || '';
            if (isStand && shelfUrl) {
                wallShelfEl.style.backgroundImage = "url('" + shelfUrl + "')";
            } else {
                wallShelfEl.style.backgroundImage = '';
            }
        }
    }

    function updatePowerState() {
        if (!previewInner) return;
        const isOn = !powerToggle || powerToggle.checked;
        previewInner.classList.toggle('is-off', !isOn);
        if (powerLabel) powerLabel.textContent = isOn ? 'LED On' : 'LED Off';

        // Defensive redundancy: also set glow directly via inline style on every
        // symbol icon currently in the preview, so the on/off difference is
        // guaranteed to apply immediately even for icons added after this toggle
        // was last changed (e.g. a symbol clicked while LED was already off).
        if (iconsContainer) {
            iconsContainer.querySelectorAll('.neon-configurator__preview-icon').forEach((el) => {
                if (isOn) {
                    // Written out explicitly (not just cleared to '') so the glow is
                    // GUARANTEED to render exactly like the text's glow, regardless
                    // of any other CSS on the page — inline styles set here always win.
                    // Same blur radii as the text's own text-shadow (5/15/30/60px).
                    el.style.filter = 'drop-shadow(0 0 5px #ffffff) drop-shadow(0 0 15px #ffffff) drop-shadow(0 0 30px currentColor) drop-shadow(0 0 60px currentColor)';
                    el.style.opacity = '1';
                } else {
                    // Off = plain colour only, no dimming — matches the text's off state exactly.
                    el.style.filter = 'none';
                    el.style.opacity = '1';
                }
            });
        }
    }

    // Measurements toggle: shows/hides the dimension lines and the selection box.
    function updateMeasurementsState() {
        if (!previewStage) return;
        const isOn = !measurementsToggle || measurementsToggle.checked;
        previewStage.classList.toggle('no-measurements', !isOn);
        if (measurementsLabel) measurementsLabel.textContent = isOn ? 'Measurements On' : 'Measurements Off';
        if (!isOn) hideSelectionBox();
    }

    // Wallpaper toggle: hides the selected background photo behind a clean, professional
    // gradient fallback. Toggling back ON restores the photo instantly — the inline
    // background-image set by applyDefaultBackground()/the bg-thumb clicks is never
    // removed, just visually overridden by CSS while this class is present.
    function updateWallpaperState() {
        if (!previewBox) return;
        const isOn = !wallpaperToggle || wallpaperToggle.checked;
        previewBox.classList.toggle('no-wallpaper', !isOn);
        if (wallpaperLabel) wallpaperLabel.textContent = isOn ? 'Wallpaper On' : 'Wallpaper Off';
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

        total += currentNeonTypePrice;
        if (currentNeonType === 'outdoor' && outdoorThicknessSelect) {
            const thicknessOption = outdoorThicknessSelect.options[outdoorThicknessSelect.selectedIndex];
            total += parseFloat(thicknessOption?.dataset.price) || 0;
        }

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

        total += installationPrice;

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

    // attachResizeHandles(); // "Move Sign" / resize feature removed per client request.

    textInput.addEventListener('input', () => {
        updatePreviewText();
    });
    // The text field is now a <textarea> (2 lines tall, per client request) purely for a
    // more comfortable typing box — it should still behave as one line of neon text, so
    // Enter is swallowed instead of inserting a newline that would render as a broken
    // "letter" in the preview.
    textInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') event.preventDefault();
    });

    function syncFontCards() {
        const selectedValue = fontSelect.value;
        fontCards.forEach((card) => {
            card.classList.toggle('is-selected', card.dataset.fontValue === selectedValue);
        });
    }

    fontCards.forEach((card) => {
        card.addEventListener('click', () => {
            const value = card.dataset.fontValue;
            const options = Array.from(fontSelect.options);
            const matchIndex = options.findIndex((opt) => opt.value === value);
            if (matchIndex === -1) return;
            fontSelect.selectedIndex = matchIndex;
            fontSelect.dispatchEvent(new Event('change'));
            if (fontDropdownPanel) fontDropdownPanel.hidden = true;
            if (fontDropdownTrigger) fontDropdownTrigger.classList.remove('is-open');
        });
    });

    fontSelect.addEventListener('change', () => {
        updatePreviewFont();
        syncFontCards();
        const selectedOption = fontSelect.options[fontSelect.selectedIndex];
        if (fontDropdownPreview && selectedOption) {
            fontDropdownPreview.textContent = selectedOption.dataset.name || selectedOption.textContent.trim();
            fontDropdownPreview.style.fontFamily = fontSelect.value;
        }
    });

    if (fontDropdownTrigger && fontDropdownPanel) {
        fontDropdownTrigger.addEventListener('click', () => {
            const isOpen = !fontDropdownPanel.hidden;
            fontDropdownPanel.hidden = isOpen;
            fontDropdownTrigger.classList.toggle('is-open', !isOpen);
        });
    }

    if (symbolDropdownTrigger && symbolDropdownPanel) {
        symbolDropdownTrigger.addEventListener('click', () => {
            const isOpen = !symbolDropdownPanel.hidden;
            symbolDropdownPanel.hidden = isOpen;
            symbolDropdownTrigger.classList.toggle('is-open', !isOpen);
        });
    }

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
    buildBackboardColourCards();

    // Reference-site-style cards: name + price on the left, a realistic finish swatch on the
    // right, pink border when selected. The hidden <select> stays the single source of truth
    // for pricing/cart/preview — clicking a card just drives that select's value and change
    // event, so nothing about the pricing/preview logic changes.
    function buildBackboardColourCards() {
        if (!backboardColourSelect || !backboardColourCardsEl) return;
        backboardColourCardsEl.innerHTML = '';
        Array.from(backboardColourSelect.options).forEach((opt, i) => {
            const isClear = opt.dataset.isClear === 'true';
            const finish = isClear ? 'clear' : (opt.dataset.finish || 'gloss');
            const price = parseFloat(opt.dataset.price) || 0;

            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'neon-configurator__colour-card' + (opt.selected ? ' is-selected' : '');
            card.dataset.colourLabel = opt.value;
            card.title = opt.textContent.trim();
            card.setAttribute('aria-label', opt.textContent.trim());

            const info = document.createElement('span');
            info.className = 'neon-configurator__colour-card-info';
            const nameEl = document.createElement('span');
            nameEl.className = 'neon-configurator__colour-card-name';
            nameEl.textContent = opt.textContent.trim();
            const priceEl = document.createElement('span');
            priceEl.className = 'neon-configurator__colour-card-price';
            priceEl.textContent = price > 0 ? ('+$' + price) : 'FREE';
            info.appendChild(nameEl);
            info.appendChild(priceEl);

            const swatch = document.createElement('span');
            swatch.className = 'neon-configurator__colour-card-swatch finish--' + finish;
            swatch.style.setProperty('--swatch-colour', isClear ? '#9a9a9a' : (opt.dataset.hex || '#888888'));

            card.appendChild(info);
            card.appendChild(swatch);

            card.addEventListener('click', () => {
                backboardColourSelect.selectedIndex = i;
                backboardColourSelect.dispatchEvent(new Event('change'));
                backboardColourCardsEl.querySelectorAll('.neon-configurator__colour-card').forEach((c) => c.classList.remove('is-selected'));
                card.classList.add('is-selected');
            });

            backboardColourCardsEl.appendChild(card);
        });
    }

    // Keep the visible cards in sync with the hidden select (single source of truth for pricing/cart)
    function syncBackboardStyleCards() {
        const selectedLabel = backboardStyleSelect.value;
        backboardStyleCards.forEach((card) => {
            card.classList.toggle('is-selected', card.dataset.styleLabel === selectedLabel);
        });
    }

    backboardStyleCards.forEach((card) => {
        card.addEventListener('click', () => {
            const label = card.dataset.styleLabel;
            const options = Array.from(backboardStyleSelect.options);
            const matchIndex = options.findIndex((opt) => opt.value === label);
            if (matchIndex === -1) return;
            backboardStyleSelect.selectedIndex = matchIndex;
            backboardStyleSelect.dispatchEvent(new Event('change'));
            syncBackboardStyleCards();
        });
    });

    backboardStyleSelect.addEventListener('change', syncBackboardStyleCards);

    sizeSelect.addEventListener('change', () => {
        customSizeActive = false;
        updatePreviewScale();
        calculateTotal();
        syncSizeCards();
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
    if (measurementsToggle) {
        measurementsToggle.addEventListener('change', updateMeasurementsState);
    }
    if (wallpaperToggle) {
        wallpaperToggle.addEventListener('change', updateWallpaperState);
    }

    const multicolourInfo = root.querySelector('[data-multicolour-info]');

    effectModeRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            currentEffectMode = radio.value;
            previewInner.classList.remove('effect--rgb', 'effect--multicolour');
            if (currentEffectMode === 'rgb') previewInner.classList.add('effect--rgb');
            if (currentEffectMode === 'multicolour') previewInner.classList.add('effect--multicolour');
            if (colourField) {
                colourField.style.display = currentEffectMode === 'multicolour' ? 'none' : '';
            }
            if (multicolourInfo) multicolourInfo.hidden = currentEffectMode !== 'multicolour';
            updatePreviewText();
            updatePreviewColour();
            renderIcons();
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
            if (symbolDropdownPreview) {
                symbolDropdownPreview.textContent = selectedSymbols.length
                    ? selectedSymbols.map((s) => s.label).join(', ')
                    : 'Select icons';
            }
        });
    });

    function syncSizeCards() {
        const selectedWidth = sizeSelect.value;
        sizeCards.forEach((card) => {
            card.classList.toggle('is-selected', card.dataset.sizeWidth === selectedWidth);
        });
    }

    sizeCards.forEach((card) => {
        card.addEventListener('click', () => {
            const width = card.dataset.sizeWidth;
            const options = Array.from(sizeSelect.options);
            const matchIndex = options.findIndex((opt) => opt.value === width);
            if (matchIndex === -1) return;
            customSizeActive = false;
            sizeSelect.selectedIndex = matchIndex;
            sizeSelect.dispatchEvent(new Event('change'));
            syncSizeCards();
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
                .map((checkbox) => checkbox.dataset.addonLabel || '')
                .filter(Boolean)
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
                'Text Position': 'Group X: ' + Math.round(groupOffsetX) + 'px, Y: ' + Math.round(groupOffsetY) + 'px',
                'Text Rotation': textRotation + '°',
                '_blueprint_width_cm': currentWidthCm,
                '_blueprint_height_cm': currentHeightCm
            };

            if (neonTypeCards.length) {
                const selectedCard = Array.from(neonTypeCards).find((c) => c.classList.contains('is-selected'));
                properties['Neon Type'] = selectedCard ? selectedCard.dataset.neonTypeLabel : 'Indoor';
                if (currentNeonType === 'outdoor' && outdoorThicknessSelect) {
                    properties['Outdoor Thickness'] = outdoorThicknessSelect.options[outdoorThicknessSelect.selectedIndex].textContent.trim();
                }
            }

            if (powerAdapterSelect) {
                properties['Power Adapter'] = powerAdapterSelect.options[powerAdapterSelect.selectedIndex].textContent.trim();
            }

            properties['Quick Symbols'] = selectedSymbols.length
                ? selectedSymbols.map((s) => s.label).join(', ')
                : 'None';

            if (installationSelected) {
                properties['Installation'] = 'Yes, professional installation requested';
                properties['Installation Date'] = installDateInput ? installDateInput.value : '';
                properties['Installation Time'] = installTimeSelect ? installTimeSelect.value : '';
                properties['Installation Address'] = (installAddressInput && installAddressInput.value.trim())
                    ? installAddressInput.value.trim()
                    : 'Same as shipping address';
            } else {
                properties['Installation'] = 'No installation — customer will arrange';
            }

            addToCartBtn.disabled = true;
            setButtonLoadingText(addToCartBtn, 'Syncing price...');

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
                const isNewVariant = proxyData.reused === false;

                // Step 2: Add that exact-price variant to the cart
                setButtonLoadingText(addToCartBtn, 'Adding...');
                const routesRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

                // Mirror the theme's own product-form flow: ask cart/add.js to also render
                // any cart-items-component sections present on the page, so the theme's cart
                // drawer/icon can update themselves without a manual page refresh.
                const cartItemsComponents = document.querySelectorAll('cart-items-component');
                const sectionIds = [];
                cartItemsComponents.forEach((el) => {
                    if (el.dataset && el.dataset.sectionId) sectionIds.push(el.dataset.sectionId);
                });

                // A brand-new variant can take a moment to become available to this endpoint —
                // retry a couple of times automatically before treating it as a real failure.
                const addResult = await addItemToCartWithRetry(
                    routesRoot,
                    priceMatchedVariantId,
                    properties,
                    sectionIds,
                    isNewVariant ? 3 : 0
                );

                addToCartBtn.textContent = 'Added ✓';
                showTemporaryStatus(addToCartStatus, 'Added to cart at the correct configured price!', 4000);

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
                showTemporaryStatus(addToCartStatus, 'Something went wrong. Please try again.', 5000);
            } finally {
                setTimeout(() => {
                    addToCartBtn.disabled = false;
                    addToCartBtn.textContent = 'Add to Cart';
                }, 2000);
            }
        });
    }

    function updateIncludedPowerAdapterText() {
        if (includedPowerAdapterLi && powerAdapterSelect && powerAdapterSelect.options.length) {
            includedPowerAdapterLi.textContent = powerAdapterSelect.options[powerAdapterSelect.selectedIndex].textContent.trim();
        }
    }
    if (powerAdapterSelect) {
        powerAdapterSelect.addEventListener('change', updateIncludedPowerAdapterText);
    }

    // Initial render
    applyDefaultBackground();
    updatePreviewText();
    updatePreviewFont();
    updatePreviewColour();
    updatePreviewScale();
    updatePowerState();
    updateMeasurementsState();
    updateWallpaperState();
    syncShapeSourceStyle();
    updateBackboardPanel();
    syncBackboardStyleCards();
    syncFontCards();
    syncSizeCards();
    updateSymbolPositionClass();
    updateIncludedPowerAdapterText();
    updateOutdoorThicknessVisibility();
    updateSizeFieldsVisibility();
    calculateTotal();
    updateOutdoorAvailability();
    setupDimensionObserver();
    setupShapeSourceObserver();
    setupAutoHeaderOffset(root);
    updateDimensionLines();
}
