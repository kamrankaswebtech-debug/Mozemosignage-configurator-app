// Mozemo Signage - shared configurator engine for UV Graphic Signs (With / Without Neon
// Lighting), Acrylic Neon Bonnet, Lightbox, Infinity Mirror and Event Marquee signs.
// The Liquid blocks only output the Admin data as JSON; this file builds the whole UI
// (same layout and feel as the Neon / 3D configurators), the live preview, the pricing and
// the Add to Cart flow. Everything is scoped inside this function: nothing here touches the
// Neon or 3D configurator scripts.
(function () {
    'use strict';
    if (window.MozConfigurator) return;

    const PRODUCTS = {};

    // ---------- Small helpers ----------
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }
    function num(value, fallback) {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
    }
    function bySort(list) {
        return (Array.isArray(list) ? list : [])
            .map((o, i) => ({ o, i }))
            .sort((a, b) => (num(a.o.s, 999999) - num(b.o.s, 999999)) || (a.i - b.i))
            .map((x) => x.o);
    }
    function money(value) { return '$' + num(value).toFixed(2); }
    function plusMoney(value) { return '+$' + num(value).toFixed(2); }
    function readJson(root, selector, fallback) {
        const node = root.querySelector(selector);
        if (!node) return fallback;
        try { return JSON.parse(node.textContent) || fallback; } catch (err) {
            console.error('Mozemo configurator: bad JSON in ' + selector, err);
            return fallback;
        }
    }
    function cmText(cm) {
        const n = num(cm);
        return (Math.round(n * 10) / 10) + ' cm';
    }
    // First number in a label like "Medium - 60cm" (used when a size has no cm field).
    function cmFromLabel(label) {
        const m = String(label || '').match(/(\d+(?:\.\d+)?)\s*(cm|mm|m\b|")?/i);
        if (!m) return 0;
        const n = num(m[1]);
        const unit = (m[2] || 'cm').toLowerCase();
        if (unit === 'mm') return n / 10;
        if (unit === 'm') return n * 100;
        if (unit === '"') return n * 2.54;
        return n;
    }
    function hexToRgb(hex) {
        let h = String(hex || '').trim().replace('#', '');
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 255, g: 255, b: 255 };
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }
    function rgba(hex, a) { const c = hexToRgb(hex); return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')'; }
    function luminance(hex) { const c = hexToRgb(hex); return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; }
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Metal / material look guessed from a label (frame finish, letter style, panel material).
    function metalFromLabel(label) {
        const l = String(label || '').toLowerCase();
        if (/rose/.test(l)) return 'rose';
        if (/gold|brass|champagne/.test(l)) return 'gold';
        if (/chrome|mirror|silver|stainless|steel|alumin|metal/.test(l)) return 'silver';
        if (/rust|corten|vintage|copper|bronze/.test(l)) return 'rust';
        if (/white/.test(l)) return 'white';
        if (/wood|timber|oak/.test(l)) return 'wood';
        if (/black|matte|dark/.test(l)) return 'black';
        return '';
    }
    const METAL_FILL = {
        gold: 'linear-gradient(180deg,#fff3b0 0%,#e7b84a 35%,#a8761a 55%,#f6d77a 75%,#8c5f12 100%)',
        silver: 'linear-gradient(180deg,#ffffff 0%,#cfd4da 30%,#7d848c 52%,#eef1f4 72%,#6c737b 100%)',
        rose: 'linear-gradient(180deg,#ffe3dc 0%,#e9a99a 35%,#b56f60 55%,#f3c5b9 75%,#94564a 100%)',
        rust: 'linear-gradient(180deg,#c9764a 0%,#8f4424 45%,#6d3218 70%,#a65a32 100%)',
        white: 'linear-gradient(180deg,#ffffff 0%,#eceef1 60%,#d5d8dd 100%)',
        wood: 'linear-gradient(180deg,#c89a66 0%,#9c6b3d 50%,#7a5030 100%)',
        black: 'linear-gradient(180deg,#3a3a40 0%,#141416 55%,#060607 100%)'
    };

    // ---------- Reliable add of a configured-price line (same flow as Neon / 3D) ----------
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
                if (response.ok) return await response.json();
                lastError = new Error('Add to cart failed with status ' + response.status);
            } catch (err) {
                lastError = err;
            }
            if (attempt < maxRetries) await sleep(900 + attempt * 500);
        }
        throw lastError;
    }

    async function waitForVariantReady(routesRoot, variantId, expectedPrice) {
        const handle = (window.location.pathname.match(/\/products\/([^/?#]+)/) || [])[1];
        const want = Math.round(num(expectedPrice) * 100);
        if (!handle || !want) return;
        for (let attempt = 0; attempt < 12; attempt++) {
            try {
                const res = await fetch(routesRoot + 'products/' + handle + '.js?_=' + Date.now(), { cache: 'no-store' });
                if (res.ok) {
                    const product = await res.json();
                    const variant = (product.variants || []).find((v) => String(v.id) === String(variantId));
                    if (variant && Math.abs(Number(variant.price) - want) <= 1) return;
                }
            } catch (err) { /* keep waiting */ }
            await sleep(800);
        }
    }

    function linePriceOk(item, want) {
        return !!item && Number(item.final_price != null ? item.final_price : item.price) >= want - 1;
    }

    async function cartLines(routesRoot, variantId) {
        try {
            const cart = await (await fetch(routesRoot + 'cart.js', { cache: 'no-store' })).json();
            return (cart.items || []).filter((item) => String(item.variant_id) === String(variantId));
        } catch (err) {
            return null;
        }
    }

    async function removeLines(routesRoot, lines) {
        for (const line of lines) {
            try {
                await fetch(routesRoot + 'cart/change.js', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: line.key, quantity: 0 })
                });
            } catch (err) { /* ignore */ }
        }
    }

    async function freshSections(routesRoot, sectionIds) {
        if (!sectionIds.length) return undefined;
        try {
            return await (await fetch(routesRoot + '?sections=' + encodeURIComponent(sectionIds.join(',')), { cache: 'no-store' })).json();
        } catch (err) {
            return undefined;
        }
    }

    // Returns the add result once the line is in the cart at the configured price; throws otherwise.
    async function addConfiguredLine(routesRoot, variantId, properties, sectionIds, isNewVariant, expectedPrice) {
        const want = Math.round(num(expectedPrice) * 100);
        if (isNewVariant) await waitForVariantReady(routesRoot, variantId, expectedPrice);
        for (let round = 0; round < 2; round++) {
            const addResult = await addItemToCartWithRetry(routesRoot, variantId, properties, sectionIds, isNewVariant ? 3 : 1);
            if (!want) return addResult;
            const added = Array.isArray(addResult && addResult.items)
                ? addResult.items.find((item) => String(item.variant_id) === String(variantId))
                : null;
            if (linePriceOk(added, want)) return addResult;
            for (let check = 0; check < 6; check++) {
                await sleep(1000);
                const lines = await cartLines(routesRoot, variantId);
                if (lines && lines.length && lines.every((line) => linePriceOk(line, want))) {
                    addResult.sections = await freshSections(routesRoot, sectionIds);
                    return addResult;
                }
            }
            const lines = await cartLines(routesRoot, variantId);
            if (lines && lines.length) await removeLines(routesRoot, lines.filter((line) => !linePriceOk(line, want)));
            await waitForVariantReady(routesRoot, variantId, expectedPrice);
        }
        throw new Error('Configured price was not applied in the cart');
    }

    // Brand-new price variant still showing $0.00 in the drawer? Redraw once Shopify has the price.
    async function syncCartLinePrice(routesRoot, variantId, expectedPrice, sectionIds, addResult, sourceId) {
        const want = Math.round(num(expectedPrice) * 100);
        if (!want) return;
        const added = addResult && Array.isArray(addResult.items)
            ? addResult.items.find((item) => String(item.variant_id) === String(variantId))
            : null;
        if (linePriceOk(added, want)) return;
        for (let attempt = 0; attempt < 10; attempt++) {
            await sleep(attempt === 0 ? 700 : 1000);
            let cart;
            try { cart = await (await fetch(routesRoot + 'cart.js', { cache: 'no-store' })).json(); } catch (err) { continue; }
            const lines = (cart.items || []).filter((item) => String(item.variant_id) === String(variantId));
            if (!lines.length || !lines.every((line) => linePriceOk(line, want))) continue;
            const sections = await freshSections(routesRoot, sectionIds);
            try {
                const themeEvents = await import('@theme/events');
                const UpdateEvent = themeEvents.CartUpdateEvent || themeEvents.CartAddEvent;
                document.dispatchEvent(new UpdateEvent({}, sourceId, { source: sourceId, itemCount: cart.item_count, sections }));
            } catch (err) { /* theme without @theme/events */ }
            document.dispatchEvent(new CustomEvent('cart:refresh'));
            return;
        }
    }

    // ---------- Image upload (same app proxy as the 3D logo upload) ----------
    const UPLOAD_MAX_DIMENSION = 2000;
    async function downscaleImage(file) {
        const type = file.type || '';
        if (type.indexOf('image/') !== 0 || type === 'image/svg+xml' || type === 'image/gif') return file;
        if (typeof createImageBitmap !== 'function') return file;
        try {
            const bmp = await createImageBitmap(file);
            const scale = Math.min(1, UPLOAD_MAX_DIMENSION / Math.max(bmp.width, bmp.height));
            if (scale === 1 && file.size < 1.5 * 1024 * 1024) { if (bmp.close) bmp.close(); return file; }
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bmp.width * scale));
            canvas.height = Math.max(1, Math.round(bmp.height * scale));
            canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
            if (bmp.close) bmp.close();
            const outType = type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, outType, 0.86));
            if (!blob || blob.size >= file.size) return file;
            return new File([blob], file.name.replace(/\.[^.]+$/, '') + (outType === 'image/jpeg' ? '.jpg' : '.png'), { type: outType });
        } catch (err) {
            return file;
        }
    }
    async function uploadDesign(file) {
        const prepared = await downscaleImage(file);
        const formData = new FormData();
        formData.append('file', prepared);
        const response = await fetch('/apps/neon-pricing', { method: 'POST', body: formData });
        if (!response.ok) throw new Error('Upload failed with status ' + response.status);
        const data = await response.json();
        if (data.error || !data.fileUrl) throw new Error(data.error || 'No file URL returned');
        return data.fileUrl;
    }

    // =====================================================================================
    // Configurator instance
    // =====================================================================================
    function init(root) {
        const product = PRODUCTS[root.dataset.mozCfg];
        if (!product) return;
        const data = readJson(root, '[data-moz-data]', {});
        const walls = bySort(readJson(root, '[data-moz-walls]', []));
        const powerList = bySort(readJson(root, '[data-moz-power]', []));
        const install = readJson(root, '[data-moz-install]', null);
        // Sign font = the 3D configurator's default (first) font, so wording looks the same site-wide.
        const signFonts = bySort(readJson(root, '[data-moz-fonts]', []));
        const signFont = signFonts[0] || null;
        let signFamily = '';
        if (signFont) {
            signFamily = signFont.u ? '"moz-font-' + String(signFont.h || '').replace(/[^a-z0-9_-]/gi, '') + '"' : (signFont.f || '');
            if (signFont.u) {
                const st = el('style');
                st.textContent = '@font-face{font-family:' + signFamily + ';src:url("' + signFont.u + '");font-display:swap;}';
                root.appendChild(st);
            }
        }
        const layout = product.layout || 'neon';

        // ---- Skeleton ----
        root.classList.add('moz-cfg', 'moz-cfg--' + layout);
        const preview = el('div', 'moz-cfg__preview');
        const toggles = el('div', 'moz-cfg__toggles');
        const badge = el('div', 'moz-cfg__badge');
        badge.appendChild(el('p', 'moz-cfg__badge-title', 'Visual Estimate'));
        badge.appendChild(el('p', 'moz-cfg__badge-sub', 'Mock-up for visual estimate only. Final professional artwork supplied for approval before manufacturing.'));
        const stage = el('div', 'moz-cfg__stage');
        const sign = el('div', 'moz-cfg__sign');
        const dimW = el('div', 'moz-cfg__dim moz-cfg__dim--w');
        const dimWLabel = el('span', 'moz-cfg__dim-label');
        dimW.appendChild(dimWLabel);
        const dimH = el('div', 'moz-cfg__dim moz-cfg__dim--h');
        const dimHLabel = el('span', 'moz-cfg__dim-label');
        dimH.appendChild(dimHLabel);
        stage.appendChild(sign);
        stage.appendChild(dimW);
        stage.appendChild(dimH);
        const thumbs = el('div', 'moz-cfg__thumbs');
        preview.appendChild(toggles);
        preview.appendChild(badge);
        preview.appendChild(stage);
        preview.appendChild(thumbs);

        const panel = el('div', 'moz-cfg__panel');
        const hero = el('h2', 'moz-cfg__hero', product.hero || 'Design Your Sign');
        panel.appendChild(hero);
        const steps = el('div', 'moz-cfg__steps');
        panel.appendChild(steps);

        const summary = el('div', 'moz-cfg__summary');
        const breakdown = el('div', 'moz-cfg__breakdown');
        breakdown.appendChild(el('p', 'moz-cfg__breakdown-title', 'Price Breakdown'));
        const breakdownRows = el('div', 'moz-cfg__breakdown-rows');
        breakdown.appendChild(breakdownRows);
        const totalRow = el('div', 'moz-cfg__total');
        totalRow.appendChild(el('span', 'moz-cfg__total-label', 'Total Price'));
        const totalValue = el('span', 'moz-cfg__total-value', '$0.00');
        totalRow.appendChild(totalValue);
        const addBtn = el('button', 'moz-cfg__add', 'Add to Cart');
        addBtn.type = 'button';
        const status = el('p', 'moz-cfg__status');
        status.setAttribute('aria-live', 'polite');
        summary.appendChild(breakdown);
        summary.appendChild(totalRow);
        summary.appendChild(addBtn);
        summary.appendChild(status);
        panel.appendChild(summary);

        const dataNodes = Array.from(root.children);
        root.appendChild(preview);
        root.appendChild(panel);
        dataNodes.forEach((n) => { if (n.tagName === 'SCRIPT') n.hidden = true; });

        // ---- State ----
        const ctx = {
            root, data, install, layout, sign, stage, preview, panel,
            signFamily,
            signFontName: signFont ? signFont.n : '',
            v: {},                 // selected values by key
            ledOn: true,
            showDims: true,
            text: '',
            logo: { src: null, url: null, name: '', promise: null, aspect: 0 },
            lines: [],
            total: 0
        };

        // ---- Steps (auto-numbered) ----
        ctx.step = function (title, opts) {
            const wrap = el('div', 'moz-cfg__step');
            const label = el('p', 'moz-cfg__label');
            const n = el('span', 'moz-cfg__step-num');
            label.appendChild(n);
            label.appendChild(el('span', '', title));
            wrap.appendChild(label);
            if (opts && opts.note) wrap.appendChild(el('p', 'moz-cfg__note', opts.note));
            if (opts && opts.unnumbered) wrap.classList.add('is-unnumbered');
            steps.appendChild(wrap);
            wrap.setTitle = (text) => { label.lastChild.textContent = text; };
            return wrap;
        };
        function renumber() {
            let i = 0;
            steps.querySelectorAll('.moz-cfg__step').forEach((s) => {
                const n = s.querySelector('.moz-cfg__step-num');
                if (s.hidden || s.classList.contains('is-unnumbered')) { n.textContent = ''; return; }
                i += 1;
                n.textContent = i + '. ';
            });
        }
        ctx.renumber = renumber;

        // Single-choice cards. items: [{ label, price, desc, meta, visual(node), badge }]
        ctx.cards = function (key, items, opts) {
            opts = opts || {};
            const grid = el('div', 'moz-cfg__cards' + (opts.compact ? ' moz-cfg__cards--compact' : ''));
            if (opts.cols) grid.style.setProperty('--moz-cols', opts.cols);
            const control = { el: grid, items: [], index: -1 };
            control.setItems = function (list, keepLabel) {
                const prev = control.items[control.index];
                control.items = list.slice();
                grid.innerHTML = '';
                list.forEach((item, idx) => {
                    const card = el('button', 'moz-cfg__card' + (item.disabled ? ' is-disabled' : ''));
                    card.type = 'button';
                    if (item.disabled) card.setAttribute('aria-disabled', 'true');
                    if (item.img) {
                        const vis = el('span', 'moz-cfg__card-visual moz-cfg__card-visual--img');
                        const im = el('img');
                        im.src = item.img;
                        im.alt = '';
                        im.loading = 'lazy';
                        vis.appendChild(im);
                        card.appendChild(vis);
                    } else if (item.visual) {
                        const vis = el('span', 'moz-cfg__card-visual');
                        item.visual(vis);
                        card.appendChild(vis);
                    }
                    card.appendChild(el('span', 'moz-cfg__card-label', item.label));
                    if (item.meta) card.appendChild(el('span', 'moz-cfg__card-meta', item.meta));
                    if (item.desc) card.appendChild(el('span', 'moz-cfg__card-desc', item.desc));
                    const priceMode = opts.price || 'plus';
                    if (priceMode !== 'none') {
                        const p = num(item.price);
                        if (priceMode === 'full') card.appendChild(el('span', 'moz-cfg__card-price', money(p)));
                        else if (p > 0) card.appendChild(el('span', 'moz-cfg__card-price', plusMoney(p)));
                        else if (opts.showIncluded) card.appendChild(el('span', 'moz-cfg__card-price is-included', 'Included'));
                    }
                    if (item.badge) card.appendChild(el('span', 'moz-cfg__card-badge', item.badge));
                    card.addEventListener('click', () => {
                        if (item.disabled) { if (opts.onDisabled) opts.onDisabled(item); return; }
                        control.select(idx);
                    });
                    grid.appendChild(card);
                });
                let next = 0;
                if (keepLabel && prev) {
                    const same = list.findIndex((x) => x.label === prev.label);
                    if (same > -1) next = same;
                }
                control.select(list.length ? next : -1, true);
            };
            control.select = function (idx, silent) {
                control.index = idx;
                Array.from(grid.children).forEach((c, i) => {
                    c.classList.toggle('is-selected', i === idx);
                    c.setAttribute('aria-pressed', i === idx ? 'true' : 'false');
                });
                ctx.v[key] = idx > -1 ? control.items[idx] : null;
                if (opts.onChange) opts.onChange(ctx.v[key]);
                if (!silent) ctx.update();
            };
            control.setItems(items);
            return control;
        };

        // Colour swatches. items: [{ name, hex, price }]
        ctx.swatches = function (key, items, opts) {
            opts = opts || {};
            const wrap = el('div');
            const row = el('div', 'moz-cfg__swatches');
            const label = el('p', 'moz-cfg__selected');
            wrap.appendChild(row);
            wrap.appendChild(label);
            const control = { el: wrap, items: items.slice(), index: -1 };
            items.forEach((item, idx) => {
                const cell = el('div', 'moz-cfg__swatch-item');
                const btn = el('button', 'moz-cfg__swatch');
                btn.type = 'button';
                btn.style.background = item.hex || '#ffffff';
                btn.title = item.name + (num(item.price) > 0 ? ' (' + plusMoney(item.price) + ')' : '');
                btn.setAttribute('aria-label', item.name);
                btn.addEventListener('click', () => control.select(idx));
                cell.appendChild(btn);
                cell.appendChild(el('span', 'moz-cfg__swatch-name', item.name));
                row.appendChild(cell);
            });
            control.select = function (idx, silent) {
                control.index = idx;
                Array.from(row.children).forEach((c, i) => c.firstChild.classList.toggle('is-selected', i === idx));
                const item = items[idx] || null;
                ctx.v[key] = item;
                label.textContent = item ? 'Selected: ' + item.name + (num(item.price) > 0 ? ' (' + plusMoney(item.price) + ')' : '') : '';
                if (opts.onChange) opts.onChange(item);
                if (!silent) ctx.update();
            };
            control.select(items.length ? 0 : -1, true);
            return control;
        };

        // Add-on cards (multi select). Free add-ons are included and locked.
        ctx.addons = function (key, items) {
            const wrap = el('div', 'moz-cfg__addons');
            const control = { el: wrap, items: [] };
            control.setItems = function (list) {
                control.items = list.slice();
                wrap.innerHTML = '';
                list.forEach((item) => {
                    const card = el('label', 'moz-cfg__addon' + (item.free ? ' is-locked is-checked' : ''));
                    const input = el('input');
                    input.type = 'checkbox';
                    input.checked = !!item.free;
                    input.disabled = !!item.free;
                    const tick = el('i', 'moz-cfg__addon-tick');
                    card.appendChild(input);
                    card.appendChild(tick);
                    card.appendChild(el('span', 'moz-cfg__addon-text', item.label));
                    card.appendChild(el('em', 'moz-cfg__addon-price', item.free ? 'Included' : (num(item.price) > 0 ? plusMoney(item.price) : 'Free')));
                    input.addEventListener('change', () => {
                        card.classList.toggle('is-checked', input.checked);
                        read();
                        ctx.update();
                    });
                    item._input = input;
                    wrap.appendChild(card);
                });
                read();
            };
            function read() { ctx.v[key] = control.items.filter((i) => i._input && i._input.checked); }
            control.setItems(items);
            return control;
        };

        // Plain dropdown (power adapter etc.). items: [{ label }]
        ctx.select = function (key, items) {
            const select = el('select', 'moz-cfg__select');
            items.forEach((item, idx) => {
                const o = el('option', '', item.label);
                o.value = String(idx);
                select.appendChild(o);
            });
            ctx.v[key] = items[0] || null;
            select.addEventListener('change', () => { ctx.v[key] = items[select.selectedIndex] || null; ctx.update(); });
            return { el: select };
        };

        // Design upload (drag & drop or click). Instant local preview, upload runs in the background.
        ctx.upload = function (opts) {
            opts = opts || {};
            const box = el('div', 'moz-cfg__upload');
            const input = el('input');
            input.type = 'file';
            input.accept = 'image/*,.pdf,.ai,.eps,.svg';
            input.hidden = true;
            const btn = el('button', 'moz-cfg__upload-btn', opts.cta || 'Click to upload or drag and drop');
            btn.type = 'button';
            const hint = el('p', 'moz-cfg__upload-hint', 'PNG, JPG, SVG, PDF, AI, EPS. Max 20MB.');
            const fileStatus = el('p', 'moz-cfg__upload-status');
            box.appendChild(input);
            box.appendChild(btn);
            box.appendChild(hint);
            box.appendChild(fileStatus);
            btn.addEventListener('click', () => input.click());
            ['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add('is-drag'); }));
            ['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.remove('is-drag'); }));
            box.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) handle(f); });
            input.addEventListener('change', () => { const f = input.files && input.files[0]; if (f) handle(f); });

            async function handle(file) {
                if (file.size > 20 * 1024 * 1024) { fileStatus.textContent = 'File is larger than 20MB — please choose a smaller file.'; return; }
                const logo = ctx.logo;
                if (logo.localUrl) URL.revokeObjectURL(logo.localUrl);
                logo.name = file.name;
                logo.url = null;
                logo.aspect = 0;
                if ((file.type || '').indexOf('image/') === 0) {
                    logo.localUrl = URL.createObjectURL(file);
                    logo.src = logo.localUrl;
                    const probe = new Image();
                    probe.onload = () => { logo.aspect = probe.naturalWidth / Math.max(1, probe.naturalHeight); ctx.update(); };
                    probe.src = logo.src;
                } else {
                    logo.localUrl = null;
                    logo.src = null;
                }
                fileStatus.textContent = 'Uploading "' + file.name + '"...';
                ctx.update();
                const task = uploadDesign(file);
                logo.promise = task;
                try {
                    const url = await task;
                    if (logo.promise !== task) return;
                    logo.url = url;
                    fileStatus.textContent = 'Uploaded: ' + file.name;
                } catch (err) {
                    if (logo.promise !== task) return;
                    console.error('Mozemo configurator: design upload failed.', err);
                    fileStatus.textContent = 'Upload failed — please try again.';
                } finally {
                    if (logo.promise === task) logo.promise = null;
                }
            }
            return { el: box };
        };

        // Wording input.
        ctx.textInput = function (opts) {
            opts = opts || {};
            const input = el('input', 'moz-cfg__text-input');
            input.type = 'text';
            input.maxLength = opts.max || 30;
            input.placeholder = opts.placeholder || 'Type your business name / text';
            input.addEventListener('input', () => { ctx.text = input.value; ctx.update(); });
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
            return { el: input };
        };

        // Font cards (fonts: [{ n: name, f: family, u: file url, h: handle }]).
        ctx.fonts = function (key, fonts) {
            let css = '';
            const items = fonts.map((f) => {
                let family = f.f || 'inherit';
                if (f.u) {
                    family = '"moz-cfg-font-' + (f.h || f.n).replace(/[^a-z0-9_-]/gi, '') + '"';
                    css += '@font-face{font-family:' + family + ';src:url("' + f.u + '");font-display:swap;}';
                }
                return { label: f.n, family, price: 0, visual: (v) => { const s = el('span', 'moz-cfg__font-sample', 'Abc'); s.style.fontFamily = family; v.appendChild(s); } };
            });
            if (css) { const st = el('style'); st.textContent = css; root.appendChild(st); }
            return ctx.cards(key, items, { price: 'none', compact: true, cols: 3 });
        };

        // Installation (same markup the shared installation-booking module expects).
        ctx.installation = function () {
            if (!install) return null;
            const wrap = el('div', 'moz-cfg__install');
            const opts = el('div', 'moz-cfg__radio-cards');
            opts.setAttribute('data-install-options', '');
            const name = 'moz-install-' + (root.dataset.blockId || Math.random().toString(36).slice(2));
            [['no', 'No installation — I will arrange installation myself'], ['yes', 'Yes, I need installation — ' + plusMoney(install.p)]].forEach(([value, text], i) => {
                const label = el('label', 'moz-cfg__radio');
                const input = el('input');
                input.type = 'radio';
                input.name = name;
                input.value = value;
                input.checked = i === 0;
                input.setAttribute('data-install-radio', '');
                if (value === 'yes') input.dataset.installPrice = num(install.p);
                label.appendChild(input);
                label.appendChild(el('span', '', text));
                opts.appendChild(label);
                input.addEventListener('change', () => {
                    ctx.v.installation = (value === 'yes');
                    booking.hidden = value !== 'yes';
                    if (value === 'yes') setMinDate();
                    ctx.update();
                });
            });
            const booking = el('div', 'moz-cfg__install-booking');
            booking.hidden = true;
            booking.setAttribute('data-install-booking', '');
            booking.dataset.minLeadDays = install.lead || 14;
            booking.dataset.earliestTime = install.e || '10:00';
            booking.dataset.latestTime = install.l || '17:00';
            booking.dataset.slotInterval = install.i || 60;
            booking.appendChild(el('p', 'moz-cfg__note', 'Sydney area installation, up to ' + (install.r || 100) + 'km. Simple wall/ceiling mounting only — no electrical work. Installation dates require a minimum ' + (install.lead || 14) + '-day lead time as your sign is manufactured to order.'));
            const mkRow = (labelText, field) => {
                const row = el('div', 'moz-cfg__install-row');
                row.appendChild(el('label', 'moz-cfg__install-sub', labelText));
                row.appendChild(field);
                booking.appendChild(row);
                return field;
            };
            const address = el('input', 'moz-cfg__text-input');
            address.type = 'text';
            address.placeholder = 'Start typing your address…';
            address.setAttribute('data-install-address', '');
            const date = el('input', 'moz-cfg__text-input');
            date.type = 'date';
            date.setAttribute('data-install-date', '');
            const time = el('select', 'moz-cfg__select');
            time.setAttribute('data-install-time', '');
            mkRow('Installation Address', address);
            mkRow('Preferred Installation Date', date);
            mkRow('Preferred Time Slot', time);
            wrap.appendChild(opts);
            wrap.appendChild(booking);

            // Time slots + earliest date (same rules as the Neon configurator).
            const [sh, sm] = String(install.e || '10:00').split(':').map(Number);
            const [eh, em] = String(install.l || '17:00').split(':').map(Number);
            const step = parseInt(install.i, 10) || 60;
            for (let m = sh * 60 + (sm || 0); m <= eh * 60 + (em || 0); m += step) {
                const h24 = Math.floor(m / 60);
                const mm = m % 60;
                const text = (h24 % 12 === 0 ? 12 : h24 % 12) + ':' + String(mm).padStart(2, '0') + ' ' + (h24 >= 12 ? 'PM' : 'AM');
                const o = el('option', '', text);
                o.value = text;
                time.appendChild(o);
            }
            function setMinDate() {
                const d = new Date();
                d.setDate(d.getDate() + (parseInt(install.lead, 10) || 14));
                const iso = d.toISOString().split('T')[0];
                date.min = iso;
                if (!date.value) date.value = iso;
            }
            ctx.v.installation = false;
            ctx.installFields = { address, date, time, booking };
            return { el: wrap };
        };

        // Short message shown over the preview (e.g. why an option isn't available).
        const noticeEl = el('div', 'moz-cfg__notice');
        noticeEl.setAttribute('role', 'status');
        noticeEl.hidden = true;
        preview.appendChild(noticeEl);
        ctx.notice = function (text) {
            noticeEl.textContent = text;
            noticeEl.hidden = false;
            clearTimeout(noticeEl._t);
            noticeEl._t = setTimeout(() => { noticeEl.hidden = true; }, 6000);
        };

        // ---- Preview toggles ----
        function addToggle(text, onChange) {
            const row = el('label', 'moz-cfg__toggle');
            const input = el('input');
            input.type = 'checkbox';
            input.checked = true;
            const slider = el('span', 'moz-cfg__toggle-slider');
            const label = el('span', 'moz-cfg__toggle-label', text + ' On');
            row.appendChild(input);
            row.appendChild(slider);
            row.appendChild(label);
            input.addEventListener('change', () => { label.textContent = text + (input.checked ? ' On' : ' Off'); onChange(input.checked); });
            toggles.appendChild(row);
        }
        addToggle('Measurements', (on) => { ctx.showDims = on; stage.classList.toggle('is-no-dims', !on); });
        let wallpaperOn = true;
        if (walls.length) addToggle('Wallpaper', (on) => { wallpaperOn = on; applyWallpaper(); });
        if (product.hasLight !== false) addToggle('LED', (on) => { ctx.ledOn = on; ctx.update(); });

        // ---- Wallpapers ----
        let wallIndex = 0;
        function applyWallpaper() {
            const w = walls[wallIndex];
            const on = wallpaperOn && w && w.w;
            preview.classList.toggle('has-wallpaper', !!on);
            preview.style.backgroundImage = on ? 'url("' + w.w + '")' : '';
        }
        walls.forEach((w, idx) => {
            const b = el('button', 'moz-cfg__thumb' + (idx === 0 ? ' is-selected' : ''));
            b.type = 'button';
            b.title = w.l || 'Background';
            b.setAttribute('aria-label', w.l || 'Background');
            const img = el('img');
            img.src = w.th || w.w;
            img.alt = '';
            img.loading = 'lazy';
            b.appendChild(img);
            b.addEventListener('click', () => {
                wallIndex = idx;
                Array.from(thumbs.children).forEach((c, i) => c.classList.toggle('is-selected', i === idx));
                applyWallpaper();
            });
            thumbs.appendChild(b);
        });
        thumbs.hidden = walls.length < 2;
        applyWallpaper();

        // ---- Preview geometry helpers for the product renderers ----
        // Share of the free stage width for a size: smallest available size = 45%, largest = 88%
        // (log scale so every step is visible).
        ctx.sizeShare = function (value, all) {
            const list = (all || []).map(num).filter((n) => n > 0);
            const min = Math.min.apply(null, list.length ? list : [value || 1]);
            const max = Math.max.apply(null, list.length ? list : [value || 1]);
            const t = max > min ? Math.log(Math.max(min, num(value, min)) / min) / Math.log(max / min) : 0.5;
            return 0.45 + 0.43 * Math.min(1, Math.max(0, t));
        };
        ctx.free = function () {
            const w = stage.clientWidth || 600;
            const h = stage.clientHeight || 420;
            return { w: Math.max(160, w * 0.9), h: Math.max(140, h * 0.78) };
        };
        // Fits a w x h box (any units) into the target width, limited by the free height.
        ctx.fit = function (share, aspect) {
            const f = ctx.free();
            let w = f.w * share;
            let h = w / Math.max(0.05, aspect || 1);
            if (h > f.h) { h = f.h; w = h * (aspect || 1); }
            return { w: Math.round(w), h: Math.round(h) };
        };
        ctx.setDims = function (wText, hText) {
            dimWLabel.textContent = wText || '';
            dimHLabel.textContent = hText || '';
            dimW.hidden = !wText;
            dimH.hidden = !hText;
        };

        function placeDims() {
            const target = sign.querySelector('[data-moz-measure]') || sign;
            const s = stage.getBoundingClientRect();
            const r = target.getBoundingClientRect();
            if (!r.width || !r.height) return;
            dimW.style.left = (r.left - s.left) + 'px';
            dimW.style.width = r.width + 'px';
            dimW.style.top = (r.bottom - s.top + 14) + 'px';
            dimH.style.top = (r.top - s.top) + 'px';
            dimH.style.height = r.height + 'px';
            dimH.style.left = (r.right - s.left + 14) + 'px';
        }

        // ---- Pricing ----
        function renderPrice() {
            const lines = product.price(ctx) || [];
            ctx.lines = lines;
            ctx.total = Math.round(lines.reduce((sum, l) => sum + num(l.value), 0) * 100) / 100;
            breakdownRows.innerHTML = '';
            lines.forEach((l) => {
                const row = el('div', 'moz-cfg__breakdown-row');
                row.appendChild(el('span', '', l.label));
                const val = el('span', num(l.value) > 0 ? '' : 'is-included', num(l.value) > 0 ? (l.full ? money(l.value) : plusMoney(l.value)) : 'Included');
                row.appendChild(val);
                breakdownRows.appendChild(row);
            });
            breakdown.hidden = !lines.length;
            totalValue.textContent = money(ctx.total);
        }

        let frame = 0;
        ctx.update = function () {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                renumber();
                sign.classList.toggle('is-led-off', !ctx.ledOn);
                try { product.render(ctx); } catch (err) { console.error('Mozemo configurator: preview error', err); }
                stage.classList.toggle('is-no-dims', !ctx.showDims);
                placeDims();
                renderPrice();
            });
        };

        // ---- Build product steps ----
        ctx.power = powerList;
        product.build(ctx, data);
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => ctx.update()).observe(stage);
        window.addEventListener('load', () => ctx.update());
        if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => ctx.update());

        const installCtrl = (ctx.installFields && window.MozemoInstall) ? window.MozemoInstall.attach(root) : null;

        // ---- Add to Cart ----
        function setLoading(text) {
            addBtn.innerHTML = '';
            addBtn.appendChild(el('span', 'moz-cfg__spinner'));
            addBtn.appendChild(el('span', '', text));
        }
        function flash(text, ms) {
            status.textContent = text;
            clearTimeout(status._t);
            status._t = setTimeout(() => { status.textContent = ''; }, ms || 5000);
        }
        addBtn.addEventListener('click', async () => {
            const productId = root.dataset.productId;
            if (!productId) { flash('Unable to add to cart — please refresh the page.'); return; }
            const check = product.validate ? product.validate(ctx) : '';
            if (check) { flash(check, 6000); return; }
            if (ctx.logo.promise) {
                addBtn.disabled = true;
                setLoading('Finishing design upload...');
                try { await ctx.logo.promise; } catch (err) { /* handled below */ }
            }
            if (product.needsUpload && product.needsUpload(ctx) && !ctx.logo.url) {
                addBtn.disabled = false;
                addBtn.textContent = 'Add to Cart';
                flash('Please upload your design / logo before adding to cart.', 6000);
                return;
            }

            const properties = product.properties(ctx);
            properties['Add-ons'] = properties['Add-ons'] || 'None';
            if (ctx.installFields) {
                if (ctx.v.installation) {
                    properties['Installation'] = 'Yes, professional installation requested';
                    properties['Installation Date'] = ctx.installFields.date.value || '';
                    properties['Installation Time'] = ctx.installFields.time.value || '';
                    properties['Installation Address'] = ctx.installFields.address.value.trim() || 'Same as shipping address';
                    if (installCtrl) {
                        addBtn.disabled = true;
                        setLoading('Checking installation slot...');
                        const installCheck = await installCtrl.prepareForCart();
                        if (!installCheck.ok) {
                            addBtn.disabled = false;
                            addBtn.textContent = 'Add to Cart';
                            flash(installCheck.error, 6000);
                            ctx.installFields.booking.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            return;
                        }
                        Object.assign(properties, installCheck.properties);
                    }
                } else {
                    properties['Installation'] = 'No installation — customer will arrange';
                }
            }
            properties['Configured Total'] = money(ctx.total);

            addBtn.disabled = true;
            setLoading('Syncing price...');
            try {
                const proxyResponse = await fetch('/apps/neon-pricing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ productId, price: ctx.total })
                });
                if (!proxyResponse.ok) throw new Error('Pricing sync failed');
                const proxyData = await proxyResponse.json();
                if (proxyData.error || !proxyData.variantId) throw new Error(proxyData.error || 'No variant returned');
                if (proxyData.price !== undefined && Math.abs(Number(proxyData.price) - ctx.total) > 0.005) {
                    throw new Error('Variant price ' + proxyData.price + ' does not match configured total ' + ctx.total.toFixed(2));
                }
                const variantId = proxyData.variantId;
                const isNewVariant = proxyData.reused === false;
                const routesRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
                const sectionIds = [];
                document.querySelectorAll('cart-items-component').forEach((node) => {
                    if (node.dataset && node.dataset.sectionId) sectionIds.push(node.dataset.sectionId);
                });
                setLoading(isNewVariant ? 'Preparing your price...' : 'Adding...');
                const addResult = await addConfiguredLine(routesRoot, variantId, properties, sectionIds, isNewVariant, ctx.total);

                addBtn.textContent = 'Added ✓';
                flash('Added to cart at the correct configured price!', 4000);
                if (ctx.v.installation && installCtrl) installCtrl.afterCartAdd(properties);
                const sourceId = 'moz-' + root.dataset.mozCfg + '-configurator';
                try {
                    const themeEvents = await import('@theme/events');
                    document.dispatchEvent(new themeEvents.CartAddEvent({}, sourceId, {
                        source: 'product-form-component',
                        itemCount: 1,
                        productId,
                        sections: addResult.sections
                    }));
                } catch (err) {
                    console.warn('Mozemo configurator: could not notify theme cart UI.', err);
                }
                syncCartLinePrice(routesRoot, variantId, ctx.total, sectionIds, addResult, sourceId);
                document.dispatchEvent(new CustomEvent('cart:refresh'));
            } catch (error) {
                console.error('Mozemo configurator Add to Cart error:', error);
                addBtn.textContent = 'Error - try again';
                flash('Something went wrong. Please try again.', 5000);
            } finally {
                setTimeout(() => {
                    addBtn.disabled = false;
                    addBtn.textContent = 'Add to Cart';
                }, 2000);
            }
        });

        ctx.update();
    }

    function boot() {
        document.querySelectorAll('[data-moz-cfg]').forEach((root) => {
            if (root.dataset.mozCfgReady === 'true') return;
            root.dataset.mozCfgReady = 'true';
            try { init(root); } catch (err) { console.error('Mozemo configurator: init failed', err, root); }
        });
    }

    window.MozConfigurator = {
        register(key, def) { PRODUCTS[key] = def; },
        helpers: { el, num, bySort, money, plusMoney, cmText, cmFromLabel, rgba, luminance, metalFromLabel, METAL_FILL },
        boot
    };

    // Product definitions are in this same file below; boot once the DOM is ready.
    function start() { boot(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else setTimeout(start, 0);
    document.addEventListener('shopify:section:load', boot);
    document.addEventListener('cart:refresh', boot);
})();

// =========================================================================================
// Product definitions
// =========================================================================================
(function () {
    'use strict';
    const M = window.MozConfigurator;
    if (!M) return;
    const { el, num, bySort, money, cmText, cmFromLabel, rgba, luminance, metalFromLabel, METAL_FILL } = M.helpers;

    function addonLines(ctx, key) {
        return (ctx.v[key] || []).filter((a) => !a.free && num(a.price) > 0).map((a) => ({ label: 'Add-on: ' + a.label, value: a.price }));
    }
    function addonText(ctx, key) {
        return (ctx.v[key] || []).map((a) => a.label + (a.free ? ' (Included)' : '')).join(', ') || 'None';
    }
    function installLine(ctx) {
        return (ctx.install && ctx.v.installation) ? [{ label: 'Professional installation', value: ctx.install.p }] : [];
    }
    function designUrl(ctx) {
        return ctx.logo.url || (ctx.logo.name ? 'Upload not finished — customer to resend' : 'Not uploaded — customer to supply artwork');
    }
    function swatchItems(list) {
        return bySort(list).map((c) => ({ name: c.n || c.l, hex: c.h || c.hc || '#ffffff', price: c.p }));
    }
    function cardItems(list, extra) {
        return bySort(list).map((o) => Object.assign({ label: o.l, price: o.p, src: o }, extra ? extra(o) : {}));
    }
    function addonItems(list) {
        return bySort(list).map((a) => ({ label: a.l, price: a.p, free: !!a.f, src: a }));
    }
    function metalVisual(label) {
        return (v) => {
            const s = el('span', 'moz-cfg__metal');
            s.style.background = METAL_FILL[metalFromLabel(label)] || METAL_FILL.black;
            v.appendChild(s);
        };
    }
    function powerStep(ctx, title) {
        if (!ctx.power.length) return null;
        const step = ctx.step(title || 'Power Adapter');
        step.appendChild(ctx.select('power', ctx.power.map((p) => ({ label: p.l }))).el);
        return step;
    }
    // A glowing light colour that still reads on dark / white faces.
    function glowColour(hex) {
        const l = luminance(hex);
        return (l < 0.08 || l > 0.92) ? '#fff6e0' : hex;
    }

    // Cached preview image for an uploaded design.
    function designImg(ctx, holder, cls) {
        if (!holder._img) {
            holder._img = el('img', cls);
            holder._img.alt = 'Your design';
            holder._img.decoding = 'async';
        }
        const img = holder._img;
        if (ctx.logo.src) {
            if (img.getAttribute('src') !== ctx.logo.src) img.src = ctx.logo.src;
            if (!img.parentNode) holder.appendChild(img);
        } else if (img.parentNode) {
            img.remove();
        }
        return ctx.logo.src ? img : null;
    }

    // -------------------------------------------------------------------------------------
    // 1) UV Graphic Printed Signs — With or Without Neon Lighting.
    // Same options, settings and conditions as the Neon configurator (Neon colours, effects,
    // sizes, backboard styles + colours, Indoor / Outdoor, power adapter, add-ons,
    // installation) — read straight from the Neon Admin data — minus Fonts / Quick Symbols /
    // Symbol Position, plus the printed graphic upload and the With / Without Neon choice.
    // -------------------------------------------------------------------------------------
    const UV_BACKBOARDS = [
        { key: 'cut', re: /cut\s*-?\s*around/i },
        { key: 'rect', re: /rectang/i },
        { key: 'openbox', re: /open\s*-?\s*box/i },
        { key: 'stand', re: /acrylic\s*stand|stand/i }
    ];
    function uvBoardKey(label) {
        const hit = UV_BACKBOARDS.find((b) => b.re.test(String(label || '')));
        return hit ? hit.key : 'rect';
    }

    // Builds the UV graphic preview on a canvas: contour ring, neon tube ring (+ glow), the artwork
    // and a soft wall shadow. Cached by its inputs, so it only redraws when something changes.
    function uvCompose(ctx, img, w, h, o) {
        const art = ctx._uv.art;
        if (!img.complete || !img.naturalWidth) {
            if (!img._mozWait) { img._mozWait = true; img.addEventListener('load', () => { img._mozWait = false; ctx.update(); }, { once: true }); }
            return;
        }
        let cv = ctx._uv.canvas;
        if (!cv) { cv = ctx._uv.canvas = el('canvas', 'moz-uvb__canvas'); art.appendChild(cv); }
        img.style.visibility = 'hidden';
        cv.hidden = false;
        const key = [img.src, w, h, o.contour, o.tube, o.glow].join('|');
        if (cv._key === key) return;
        cv._key = key;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const pad = 34;
        const W = w + pad * 2;
        const H = h + pad * 2;
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
        cv.style.width = W + 'px';
        cv.style.height = H + 'px';
        cv.style.left = -pad + 'px';
        cv.style.top = -pad + 'px';
        // Artwork rectangle (object-fit: contain) inside the w x h box.
        const ar = img.naturalWidth / img.naturalHeight;
        let dw = w;
        let dh = w / ar;
        if (dh > h) { dh = h; dw = h * ar; }
        const dx = (pad + (w - dw) / 2) * dpr;
        const dy = (pad + (h - dh) / 2) * dpr;
        const make = () => { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; return c; };
        const tinted = (colour) => {
            const c = make();
            const g = c.getContext('2d');
            g.drawImage(img, dx, dy, dw * dpr, dh * dpr);
            g.globalCompositeOperation = 'source-in';
            g.fillStyle = colour;
            g.fillRect(0, 0, c.width, c.height);
            return c;
        };
        const ring = (g, src, r) => {
            for (let a = 0; a < 360; a += 22.5) {
                const rad = a * Math.PI / 180;
                g.drawImage(src, Math.cos(rad) * r * dpr, Math.sin(rad) * r * dpr);
            }
        };
        const stack = make();
        const sg = stack.getContext('2d');
        if (o.contour) ring(sg, tinted(o.contour), 7);
        if (o.tube) ring(sg, tinted(o.tube), 2.5);
        sg.drawImage(img, dx, dy, dw * dpr, dh * dpr);
        const g = cv.getContext('2d');
        g.clearRect(0, 0, cv.width, cv.height);
        g.save();
        g.shadowColor = 'rgba(0,0,0,0.35)';
        g.shadowBlur = 12 * dpr;
        g.shadowOffsetX = 3 * dpr;
        g.shadowOffsetY = 8 * dpr;
        g.drawImage(stack, 0, 0);
        g.restore();
        if (o.glow) {
            g.save();
            g.shadowColor = o.glow;
            g.shadowBlur = 22 * dpr;
            g.drawImage(stack, 0, 0);
            g.shadowBlur = 7 * dpr;
            g.drawImage(stack, 0, 0);
            g.restore();
        }
        g.drawImage(stack, 0, 0);
    }

    M.register('uv', {        layout: 'neon',
        hero: 'Design Your UV Graphic Sign',
        build(ctx, d) {
            const sizes = bySort(d.sizes);
            const overrides = d.uvPrices || [];
            const findOverride = (w) => overrides.find((o) => Math.abs(num(o.w) - num(w)) < 0.51);
            const isLed = () => !!(ctx.v.lighting && ctx.v.lighting.key === 'led');
            // Size price: With Neon = Neon price (or the UV Sizes price for that width);
            // Without Neon = the UV Sizes "Price Without Neon" (else the same price).
            const sizePrice = (s) => {
                const o = findOverride(s.w);
                if (isLed()) return o && o.p !== null && o.p !== undefined ? num(o.p) : num(s.p);
                if (o && o.pn !== null && o.pn !== undefined) return num(o.pn);
                return o && o.p !== null && o.p !== undefined ? num(o.p) : num(s.p);
            };
            const sizeCards = () => sizes.map((s) => ({
                label: s.l, price: sizePrice(s), badge: s.b || '',
                meta: num(s.h) ? cmText(s.w) + ' x ' + cmText(s.h) : 'Width: ' + cmText(s.w), src: s
            }));

            const up = ctx.step('Upload Your Graphic / Logo', { note: 'Made for your own logos, graphics and printed designs — upload your full-colour artwork first.' });
            up.appendChild(ctx.upload().el);

            const ledSteps = [];
            let sizeCtl = null;
            let addonCtl = null;
            let typeCtl = null;
            const lightCtl = ctx.cards('lighting', [
                { key: 'led', label: 'With Neon Lighting', desc: 'Printed graphic with glowing LED neon.', price: 0, visual: (v) => v.appendChild(el('span', 'moz-cfg__light-sample is-on')) },
                { key: 'no_led', label: 'Without Neon Lighting', desc: 'Printed graphic only — no lighting or power needed.', price: 0, visual: (v) => v.appendChild(el('span', 'moz-cfg__light-sample')) }
            ], {
                price: 'none', cols: 2,
                onChange: () => {
                    ledSteps.forEach((s) => { s.hidden = !isLed(); });
                    if (sizeCtl) sizeCtl.setItems(sizeCards(), true);
                    if (addonCtl) addonCtl.setItems(addonsFor());
                }
            });
            ctx.step('Lighting').appendChild(lightCtl.el);

            // Neon Colour / Effect (Multicoloured Text is letter-by-letter, so not offered here).
            const effects = bySort(d.effects).filter((e) => String(e.k || '').toLowerCase() !== 'multicolour');
            const colours = bySort(d.colours);
            if (effects.length || colours.length) {
                const s = ctx.step('Neon Colour / Effect');
                if (effects.length) {
                    const start = Math.max(0, effects.findIndex((e) => String(e.k).toLowerCase() === 'single'));
                    const ctl = ctx.cards('effect', effects.map((e) => ({ key: String(e.k || '').toLowerCase(), label: e.l, price: e.p })), { cols: Math.min(3, effects.length), compact: true, showIncluded: true });
                    ctl.select(start, true);
                    s.appendChild(ctl.el);
                }
                if (colours.length) s.appendChild(ctx.swatches('colour', colours.map((c) => ({ name: c.n, hex: c.h || '#ffffff', price: c.p }))).el);
                ledSteps.push(s);
            }

            const sizeStep = ctx.step('Choose Size');
            sizeCtl = ctx.cards('size', sizeCards(), {
                price: 'full', cols: 2,
                onChange: () => { if (typeCtl) refreshTypes(); }
            });
            sizeStep.appendChild(sizeCtl.el);

            // Backboard styles: only Cut Around, Rectangle, Open Box and Acrylic Stand.
            const allStyles = bySort(d.styles);
            let styles = allStyles.filter((st) => UV_BACKBOARDS.some((b) => b.re.test(st.l)));
            if (!styles.length) styles = allStyles;
            if (styles.length) {
                ctx.step('Backboard Style', { note: 'Digital preview only — on the real sign the backboard holds every part of your design together.' })
                    .appendChild(ctx.cards('style', styles.map((st) => ({ label: st.l, price: st.p, img: st.i || '', board: uvBoardKey(st.l), visual: (v) => v.appendChild(el('span', 'moz-cfg__board-icon is-' + uvBoardKey(st.l))) })), { cols: 2, compact: true, showIncluded: true }).el);
            }
            const bcolours = bySort(d.bcolours);
            if (bcolours.length) {
                ctx.step('Backboard Colour').appendChild(ctx.swatches('board', bcolours.map((c) => ({ name: c.l, hex: c.c ? 'linear-gradient(135deg,rgba(255,255,255,.75),rgba(200,220,235,.35))' : (c.h || '#e8e8e8'), price: c.p, clear: !!c.c, finish: c.fi || '', solid: c.h || '#e8e8e8' }))).el);
            }

            // Indoor / Outdoor — outdoor only from 60 cm wide (same rule as Neon).
            const types = (d.types || []).filter((x) => x.k);
            const isOutdoorAllowed = () => num(ctx.v.size && ctx.v.size.src ? ctx.v.size.src.w : 0) >= 60;
            const typeItems = () => types.map((x) => ({
                key: String(x.k).toLowerCase(), label: x.l, price: x.p,
                disabled: String(x.k).toLowerCase() === 'outdoor' && !isOutdoorAllowed(),
                desc: String(x.k).toLowerCase() === 'outdoor' && !isOutdoorAllowed() ? 'Available from 60 cm wide' : ''
            }));
            function refreshTypes() {
                const wasOutdoor = ctx.v.neonType && ctx.v.neonType.key === 'outdoor';
                typeCtl.setItems(typeItems(), true);
                if (wasOutdoor && !isOutdoorAllowed()) {
                    const indoor = typeCtl.items.findIndex((x) => x.key === 'indoor');
                    typeCtl.select(indoor > -1 ? indoor : 0, true);
                    ctx.notice('Outdoor acrylic neon is only available for signs 60cm and larger — switched to Indoor, which is available at every size.');
                } else if (ctx.v.neonType && ctx.v.neonType.disabled) {
                    const ok = typeCtl.items.findIndex((x) => !x.disabled);
                    typeCtl.select(ok > -1 ? ok : 0, true);
                }
            }
            if (types.length) {
                const s = ctx.step('Indoor or Outdoor');
                typeCtl = ctx.cards('neonType', typeItems(), {
                    cols: 2, showIncluded: true,
                    onDisabled: () => ctx.notice('Outdoor acrylic neon is only available for signs 60cm and larger — the acrylic components are too large to fit properly on smaller sizes.')
                });
                const first = typeCtl.items.findIndex((x) => !x.disabled);
                typeCtl.select(first > -1 ? first : 0, true);
                s.appendChild(typeCtl.el);
                ledSteps.push(s);
            }

            const ps = powerStep(ctx);
            if (ps) ledSteps.push(ps);

            // Add-ons: Neon add-ons With Neon Lighting (paid = optional, free = included), plus
            // the UV Graphic add-ons for the chosen lighting ("Show For").
            const neonAddons = (d.naddons || []).map((a) => ({ label: a.l, price: a.p, free: !!a.f, neon: true }));
            const uvAddons = bySort(d.uaddons).map((a) => ({ label: a.l, price: a.p, free: !!a.f, sf: String(a.sf || 'both') }));
            function addonsFor() {
                const mode = isLed() ? 'led' : 'no_led';
                const uv = uvAddons.filter((a) => a.sf === 'both' || a.sf === '' || a.sf === mode);
                return (isLed() ? neonAddons : []).concat(uv);
            }
            const addStep = ctx.step('Add-ons & Included With Your Order');
            addonCtl = ctx.addons('addons', addonsFor());
            addStep.appendChild(addonCtl.el);
            addStep.hidden = !neonAddons.length && !uvAddons.length;

            const inst = ctx.installation();
            if (inst) ctx.step('Need Installation?', { unnumbered: true }).appendChild(inst.el);

            lightCtl.select(d.start === 'no_led' ? 1 : 0, true);
            refreshTypes && typeCtl && refreshTypes();
            ctx.sizes = sizes;
            ctx.isLed = isLed;
            ctx.sizePrice = sizePrice;
        },
        price(ctx) {
            const lines = [];
            const led = ctx.isLed();
            const size = ctx.v.size;
            if (size) lines.push({ label: 'Size: ' + size.label + (led ? ' (With Neon)' : ' (Without Neon)'), value: ctx.sizePrice(size.src), full: true });
            if (led && ctx.v.effect) lines.push({ label: 'Effect: ' + ctx.v.effect.label, value: ctx.v.effect.price });
            if (led && ctx.v.colour) lines.push({ label: 'Neon colour: ' + ctx.v.colour.name, value: ctx.v.colour.price });
            if (ctx.v.style) lines.push({ label: 'Backboard: ' + ctx.v.style.label, value: ctx.v.style.price });
            if (ctx.v.board) lines.push({ label: 'Backboard colour: ' + ctx.v.board.name, value: ctx.v.board.price });
            if (led && ctx.v.neonType) lines.push({ label: ctx.v.neonType.label, value: ctx.v.neonType.price });
            return lines.concat(addonLines(ctx, 'addons'), installLine(ctx));
        },
        render(ctx) {
            const sign = ctx.sign;
            if (!ctx._uv) {
                sign.innerHTML = '';
                const wrap = el('div', 'moz-uvb');
                const board = el('div', 'moz-uvb__board');
                board.setAttribute('data-moz-measure', '');
                const art = el('div', 'moz-uvb__art');
                const ph = el('div', 'moz-uvb__placeholder', 'Your Logo / Graphic');
                art.appendChild(ph);
                board.appendChild(art);
                ['tl', 'tr', 'bl', 'br'].forEach((c) => board.appendChild(el('span', 'moz-uvb__standoff is-' + c)));
                const stand = el('div', 'moz-uvb__stand');
                wrap.appendChild(board);
                wrap.appendChild(stand);
                sign.appendChild(wrap);
                ctx._uv = { wrap, board, art, ph };
            }
            const { wrap, board, art, ph } = ctx._uv;
            const img = designImg(ctx, art, 'moz-uvb__img');
            ph.hidden = !!img;
            const aspect = ctx.logo.aspect || 1.5;
            const size = ctx.v.size ? ctx.v.size.src : null;
            const kind = ctx.v.style ? ctx.v.style.board : 'rect';
            const pad = kind === 'cut' ? 1 : 1.16;
            const box = ctx.fit(ctx.sizeShare(size ? size.w : 0, ctx.sizes.map((s) => s.w)) / pad, aspect);
            art.style.width = box.w + 'px';
            art.style.height = box.h + 'px';
            const bc = ctx.v.board || { solid: '#ffffff', clear: false, finish: '' };
            board.style.setProperty('--moz-board', bc.clear ? 'rgba(255,255,255,0.14)' : bc.solid);
            wrap.className = 'moz-uvb is-' + kind + (bc.clear ? ' is-clear' : '') + (/frost|matt/i.test(bc.finish || '') ? ' is-frosted' : '');
            const led = ctx.isLed();
            const lit = led && ctx.ledOn;
            const c = glowColour(ctx.v.colour ? ctx.v.colour.hex : '#ff2ec4');
            const rgb = led && ctx.v.effect && ctx.v.effect.key === 'rgb';
            wrap.classList.toggle('is-neon', led);
            wrap.classList.toggle('is-lit', lit);
            wrap.classList.toggle('is-rgb', lit && rgb);
            wrap.style.setProperty('--moz-glow', c);
            wrap.style.setProperty('--moz-glow-a', rgba(c, 0.6));
            if (img) {
                // Neon tube traced around the graphic, cut-around contour in the backboard colour,
                // glow and wall shadow are baked ONCE into a canvas (redrawn only when something
                // changes) — stacked CSS drop-shadows made every frame very slow.
                uvCompose(ctx, img, box.w, box.h, {
                    contour: kind === 'cut' ? (bc.clear ? 'rgba(255,255,255,0.55)' : bc.solid) : '',
                    tube: lit ? c : (led ? '#e9e9ee' : ''),
                    glow: lit ? c : ''
                });
            } else if (ctx._uv.canvas) {
                ctx._uv.canvas.hidden = true;
            }            const w = size ? num(size.w) : 0;
            const h = size && num(size.h) ? num(size.h) : (w ? Math.round((w / aspect) * 10) / 10 : 0);
            ctx.setDims(w ? cmText(w) : '', h ? cmText(h) : '');
            ctx.dims = { w, h };
        },
        properties(ctx) {
            const led = ctx.isLed();
            const p = {
                'Design Source': 'Uploaded Graphic / Logo',
                'Uploaded Design': designUrl(ctx),
                'Lighting': led ? 'With Neon Lighting' : 'Without Neon Lighting',
                'Size': ctx.v.size ? ctx.v.size.label : '',
                'Backboard Style': ctx.v.style ? ctx.v.style.label : 'Standard',
                'Backboard Colour': ctx.v.board ? ctx.v.board.name : 'Standard',
                'Add-ons': addonText(ctx, 'addons'),
                '_blueprint_width_cm': ctx.dims.w || '',
                '_blueprint_height_cm': ctx.dims.h || ''
            };
            if (led) {
                if (ctx.v.effect) p['Colour Effect'] = ctx.v.effect.label;
                if (ctx.v.colour) p['Neon Colour'] = ctx.v.colour.name;
                if (ctx.v.neonType) p['Neon Type'] = ctx.v.neonType.label;
                if (ctx.v.power) p['Power Adapter'] = ctx.v.power.label;
            }
            return p;
        }
    });

    // -------------------------------------------------------------------------------------
    // 2) Acrylic Neon Bonnet Stand / Wall Sign Combo (Neon configurator layout)
    // -------------------------------------------------------------------------------------
    M.register('bonnet', {
        layout: 'neon',
        hero: 'Design Your Bonnet / Wall Sign',
        build(ctx, d) {
            const opts = d.opts || [];
            const cat = (c) => opts.filter((o) => String(o.c || '').trim().toLowerCase() === c);
            const up = ctx.step('Upload Your Design', { note: 'Your logo, name, image or custom design — engraved and lit on the acrylic face.' });
            up.appendChild(ctx.upload().el);

            const colours = cat('colour');
            if (colours.length) ctx.step('Choose Face Colour').appendChild(ctx.swatches('face', swatchItems(colours.map((o) => ({ n: o.l, hc: o.hc || '#1a1a1a', p: o.p, s: o.s })))).el);

            const modes = cat('lighting_mode');
            if (modes.length) {
                ctx.step('Lighting Option').appendChild(ctx.cards('lighting', cardItems(modes, (o) => ({
                    key: String(o.k || 'single').toLowerCase(),
                    visual: (v) => { const s = el('span', 'moz-cfg__light-sample is-on is-' + String(o.k || 'single').toLowerCase()); v.appendChild(s); }
                })), { showIncluded: true, cols: 3, compact: true }).el);
            }
            const sizes = bySort(cat('size'));
            ctx.sizes = sizes;
            ctx.step('Choose Size').appendChild(ctx.cards('size', sizes.map((s) => ({ label: s.l, price: s.p, meta: num(s.h) ? 'Height: ' + cmText(s.h) : '', src: s })), { price: 'full', cols: 2 }).el);

            ctx.step('Display Use', { note: 'Both included as standard — one sign, two ways to show it. Choose which one to preview.' })
                .appendChild(ctx.cards('display', [
                    { label: 'Bonnet / Hood Display', key: 'bonnet', price: 0, visual: (v) => v.appendChild(el('span', 'moz-cfg__use-icon is-bonnet')) },
                    { label: 'Wall Display', key: 'wall', price: 0, visual: (v) => v.appendChild(el('span', 'moz-cfg__use-icon is-wall')) }
                ], { price: 'none', cols: 2, compact: true }).el);

            const addons = addonItems(cat('addon'));
            if (addons.length) ctx.step('Add-ons').appendChild(ctx.addons('addons', addons).el);
            powerStep(ctx);
        },
        price(ctx) {
            const lines = [];
            if (ctx.v.size) lines.push({ label: 'Size: ' + ctx.v.size.label, value: ctx.v.size.price, full: true });
            if (ctx.v.face) lines.push({ label: 'Face colour: ' + ctx.v.face.name, value: ctx.v.face.price });
            if (ctx.v.lighting) lines.push({ label: 'Lighting: ' + ctx.v.lighting.label, value: ctx.v.lighting.price });
            lines.push({ label: 'Bonnet stand + wall display', value: 0 });
            return lines.concat(addonLines(ctx, 'addons'));
        },
        render(ctx) {
            const sign = ctx.sign;
            if (!ctx._bn) {
                sign.innerHTML = '';
                const wrap = el('div', 'moz-bonnet');
                const panel = el('div', 'moz-bonnet__panel');
                panel.setAttribute('data-moz-measure', '');
                const art = el('div', 'moz-bonnet__art');
                const ph = el('div', 'moz-bonnet__placeholder', 'Your Design');
                art.appendChild(ph);
                panel.appendChild(art);
                panel.appendChild(el('span', 'moz-bonnet__edge'));
                const stand = el('div', 'moz-bonnet__stand');
                stand.appendChild(el('span', 'moz-bonnet__foot'));
                stand.appendChild(el('span', 'moz-bonnet__foot'));
                wrap.appendChild(panel);
                wrap.appendChild(stand);
                sign.appendChild(wrap);
                ctx._bn = { wrap, panel, art, ph, stand };
            }
            const { wrap, panel, art, ph } = ctx._bn;
            const img = designImg(ctx, art, 'moz-bonnet__img');
            ph.hidden = !!img;
            const aspect = ctx.logo.aspect || 1.6;
            const size = ctx.v.size ? ctx.v.size.src : null;
            const heights = ctx.sizes.map((s) => num(s.h) || cmFromLabel(s.l));
            const hCm = size ? (num(size.h) || cmFromLabel(size.l)) : 0;
            const share = ctx.sizeShare(hCm, heights) * 0.95;
            const box = ctx.fit(share, aspect);
            panel.style.width = box.w + 'px';
            panel.style.height = box.h + 'px';
            const face = ctx.v.face ? ctx.v.face.hex : '#111111';
            panel.style.setProperty('--moz-face', face);
            const mode = ctx.v.lighting ? ctx.v.lighting.key : 'single';
            const lit = ctx.ledOn;
            const c = glowColour(face);
            panel.style.setProperty('--moz-glow', c);
            panel.className = 'moz-bonnet__panel' + (lit ? ' is-lit is-' + mode : '') + (luminance(face) > 0.6 ? ' is-light-face' : '');
            if (img) {
                img.style.filter = !lit ? 'brightness(0.85)' : (mode === 'single'
                    ? 'drop-shadow(0 0 2px ' + c + ') drop-shadow(0 0 8px ' + c + ') drop-shadow(0 0 20px ' + rgba(c, 0.6) + ')'
                    : 'drop-shadow(0 0 3px #fff) drop-shadow(0 0 10px rgba(255,80,200,0.8)) drop-shadow(0 0 22px rgba(80,160,255,0.6))');
            }
            wrap.classList.toggle('is-wall', !!(ctx.v.display && ctx.v.display.key === 'wall'));
            ctx.setDims(hCm ? cmText(hCm * aspect) : '', hCm ? cmText(hCm) : '');
            ctx.dims = { w: hCm ? Math.round(hCm * aspect * 10) / 10 : 0, h: hCm };
        },
        properties(ctx) {
            const p = {
                'Design Source': 'Uploaded Design',
                'Uploaded Design': designUrl(ctx),
                'Face Colour': ctx.v.face ? ctx.v.face.name : 'Standard',
                'Lighting': ctx.v.lighting ? ctx.v.lighting.label : 'Standard',
                'Size': ctx.v.size ? ctx.v.size.label : '',
                'Display Use': 'Bonnet / Hood Display + Wall Display (both included)',
                'Add-ons': addonText(ctx, 'addons'),
                '_blueprint_width_cm': ctx.dims.w || '',
                '_blueprint_height_cm': ctx.dims.h || ''
            };
            if (ctx.v.power) p['Power Adapter'] = ctx.v.power.label;
            return p;
        }
    });

    // -------------------------------------------------------------------------------------
    // 3) Lightbox Signs — kept simple: Shape, Lightbox Type, Lighting, Size, Design, Frame.
    // Types follow the 3D Illumination idea: Slim (single / double sided), Fully Illuminated
    // (all around), Metal-Sided (front-lit / double sided). Sizes are priced per type + lighting.
    // -------------------------------------------------------------------------------------
    const LB_DEFAULT_TYPES = [
        { k: 'slim', l: 'Slim Lightbox', d: 'Sleek 1cm thin sign — single or double sided.', sd: 'single,double', p: 0, s: 1 },
        { k: 'fully', l: 'Fully Illuminated', d: 'Lit on all sides — glows all the way around.', sd: 'all', p: 0, s: 2 },
        { k: 'metal', l: 'Metal-Sided', d: 'Illuminated face with metal sides — front-lit or double sided.', sd: 'single,double', p: 0, s: 3 }
    ];
    const LB_SHAPES = {
        circle: 'ellipse(50% 50% at 50% 50%)',
        oval: 'ellipse(50% 50% at 50% 50%)',
        square: 'inset(0 round 6%)',
        rectangle: 'inset(0 round 4%)',
        star: 'polygon(50% 0%, 61.8% 35.1%, 98.1% 34.5%, 69.1% 56.5%, 79.4% 91.3%, 50% 70.5%, 20.6% 91.3%, 30.9% 56.5%, 1.9% 34.5%, 38.2% 35.1%)',
        hexagon: 'polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0% 50%)',
        octagon: 'polygon(29.3% 0%, 70.7% 0%, 100% 29.3%, 100% 70.7%, 70.7% 100%, 29.3% 100%, 0% 70.7%, 0% 29.3%)',
        other: 'inset(0 round 24%)'
    };
    function lbShapeKey(o) {
        const k = String(o.k || '').trim().toLowerCase();
        if (LB_SHAPES[k]) return k;
        const l = String(o.l || '').toLowerCase();
        const hit = Object.keys(LB_SHAPES).find((x) => l.indexOf(x) > -1) || (/round/.test(l) ? 'circle' : '');
        return hit || 'other';
    }
    function lbSidesLabel(typeKey, sides) {
        if (sides === 'all') return 'Illuminated All Around';
        if (sides === 'double') return 'Double-Sided';
        return typeKey === 'metal' ? 'Front-Lit (Single-Sided)' : 'Single-Sided';
    }

    M.register('lightbox', {
        layout: 'neon',
        hero: 'Design Your Lightbox',
        build(ctx, d) {
            const opts = d.opts || [];
            const cat = (c) => bySort(opts.filter((o) => String(o.c || '').trim().toLowerCase() === c));
            const shapes = cat('shape');
            if (shapes.length) {
                ctx.step('Choose Shape').appendChild(ctx.cards('shape', shapes.map((o) => {
                    const key = lbShapeKey(o);
                    return { label: o.l, price: o.p, key, visual: (v) => { const s = el('span', 'moz-cfg__shape-icon is-' + key); s.style.clipPath = LB_SHAPES[key]; v.appendChild(s); } };
                }), { showIncluded: true, cols: 4, compact: true }).el);
            } else {
                ctx.v.shape = { key: 'rectangle', label: 'Rectangle', price: 0 };
            }

            let types = cat('type');
            if (!types.length) types = LB_DEFAULT_TYPES;
            const allSizes = cat('size');
            let sidesCtl = null;
            let sizeCtl = null;
            const sidesFor = (t) => String(t.sd || 'single').split(',').map((x) => x.trim().toLowerCase()).filter((x) => ['single', 'double', 'all'].indexOf(x) > -1);
            const sidesItems = () => {
                const t = ctx.v.ltype ? ctx.v.ltype.src : types[0];
                const list = sidesFor(t);
                return (list.length ? list : ['single']).map((x) => ({ key: x, label: lbSidesLabel(t.k, x), price: 0 }));
            };
            const sizesFor = () => {
                const tk = ctx.v.ltype ? String(ctx.v.ltype.src.k || '').toLowerCase() : '';
                const sd = ctx.v.sides ? ctx.v.sides.key : 'single';
                const sideOf = (s) => String(s.sd || 'single').toLowerCase();
                const typeOf = (s) => String(s.t || '').toLowerCase();
                let list = allSizes.filter((s) => typeOf(s) === tk && sideOf(s) === sd);
                if (!list.length) list = allSizes.filter((s) => !typeOf(s) && sideOf(s) === sd);
                if (!list.length && sd === 'all') list = allSizes.filter((s) => (!typeOf(s) || typeOf(s) === tk) && sideOf(s) === 'single');
                if (!list.length) list = allSizes.filter((s) => !typeOf(s) || typeOf(s) === tk);
                if (!list.length) list = allSizes;
                return list.map((s) => ({ label: s.l, price: s.p, src: s }));
            };

            ctx.step('Lightbox Type').appendChild(ctx.cards('ltype', types.map((t) => ({
                label: t.l, desc: t.d || '', price: t.p, key: String(t.k || '').toLowerCase(), src: t,
                visual: (v) => v.appendChild(el('span', 'moz-cfg__lb-icon is-' + String(t.k || '').toLowerCase()))
            })), {
                cols: 3, showIncluded: true,
                onChange: () => { if (sidesCtl) sidesCtl.setItems(sidesItems(), true); }
            }).el);

            const sidesStep = ctx.step('Lighting');
            sidesCtl = ctx.cards('sides', sidesItems(), {
                price: 'none', cols: 2, compact: true,
                onChange: () => { if (sizeCtl) sizeCtl.setItems(sizesFor(), true); }
            });
            sidesStep.appendChild(sidesCtl.el);

            ctx.step('Choose Size').appendChild((sizeCtl = ctx.cards('size', sizesFor(), { price: 'full', cols: 2 })).el);
            ctx.step('Upload Your Design', { note: 'Your logo, artwork, photo or full-colour design for the lit face.' }).appendChild(ctx.upload().el);
            const frames = cat('frame_colour');
            if (frames.length) ctx.step('Frame Colour').appendChild(ctx.swatches('frame', frames.map((o) => ({ name: o.l, hex: o.hc || '#1a1a1a', price: o.p }))).el);
            ctx.allSizes = allSizes;
        },
        price(ctx) {
            const lines = [];
            const t = ctx.v.ltype;
            if (ctx.v.size) lines.push({ label: 'Size: ' + ctx.v.size.label + ' (' + (t ? t.label + ', ' : '') + (ctx.v.sides ? ctx.v.sides.label : '') + ')', value: ctx.v.size.price, full: true });
            if (t && num(t.price) > 0) lines.push({ label: 'Lightbox type: ' + t.label, value: t.price });
            if (ctx.v.shape) lines.push({ label: 'Shape: ' + ctx.v.shape.label, value: ctx.v.shape.price });
            if (ctx.v.frame) lines.push({ label: 'Frame colour: ' + ctx.v.frame.name, value: ctx.v.frame.price });
            return lines;
        },
        render(ctx) {
            const sign = ctx.sign;
            if (!ctx._lb) {
                sign.innerHTML = '';
                const box = el('div', 'moz-lb');
                box.setAttribute('data-moz-measure', '');
                const side = el('div', 'moz-lb__side');
                const frame = el('div', 'moz-lb__frame');
                const face = el('div', 'moz-lb__face');
                const ph = el('div', 'moz-lb__placeholder', 'Your Design');
                face.appendChild(ph);
                frame.appendChild(face);
                box.appendChild(side);
                box.appendChild(frame);
                box.appendChild(el('span', 'moz-lb__tag'));
                sign.appendChild(box);
                ctx._lb = { box, face, ph, tag: box.lastChild };
            }
            const { box, face, ph, tag } = ctx._lb;
            const img = designImg(ctx, face, 'moz-lb__img');
            ph.hidden = !!img;
            const shape = ctx.v.shape ? ctx.v.shape.key : 'rectangle';
            const label = ctx.v.size ? ctx.v.size.label : '';
            const nums = (String(label).match(/\d+(?:\.\d+)?/g) || []).map(Number);
            const wCm = cmFromLabel(label);
            let hCm = wCm;
            if (shape === 'rectangle') hCm = nums.length > 1 ? nums[1] : Math.round(wCm * 0.5);
            if (shape === 'oval') hCm = nums.length > 1 ? nums[1] : Math.round(wCm * 0.66);
            const aspect = wCm && hCm ? wCm / hCm : (shape === 'rectangle' ? 2 : (shape === 'oval' ? 1.5 : 1));
            const all = (ctx.allSizes || []).map((o) => cmFromLabel(o.l));
            const b = ctx.fit(ctx.sizeShare(wCm, all) * (aspect > 1.2 ? 0.95 : 0.72), aspect);
            box.style.width = b.w + 'px';
            box.style.height = b.h + 'px';
            const typeKey = ctx.v.ltype ? ctx.v.ltype.key : 'slim';
            const sides = ctx.v.sides ? ctx.v.sides.key : 'single';
            box.className = 'moz-lb is-' + typeKey + ' is-' + sides + ' is-shape-' + shape + (ctx.ledOn ? ' is-lit' : '');
            box.style.setProperty('--moz-clip', LB_SHAPES[shape] || LB_SHAPES.rectangle);
            box.style.setProperty('--moz-frame', ctx.v.frame ? ctx.v.frame.hex : '#1a1a1a');
            box.style.setProperty('--moz-depth', Math.max(3, Math.min(14, b.w * (typeKey === 'slim' ? 0.008 : 0.03))) + 'px');
            tag.textContent = sides === 'double' ? 'Double-Sided' : (sides === 'all' ? 'Lit All Around' : '');
            tag.hidden = !tag.textContent;
            ctx.setDims(wCm ? cmText(wCm) : '', hCm ? cmText(hCm) : '');
            ctx.dims = { w: wCm, h: hCm };
        },
        properties(ctx) {
            return {
                'Shape': ctx.v.shape ? ctx.v.shape.label : '',
                'Lightbox Type': ctx.v.ltype ? ctx.v.ltype.label : '',
                'Lighting': ctx.v.sides ? ctx.v.sides.label : '',
                'Size': ctx.v.size ? ctx.v.size.label : '',
                'Uploaded Design': designUrl(ctx),
                'Frame Colour': ctx.v.frame ? ctx.v.frame.name : 'Standard',
                '_blueprint_width_cm': ctx.dims.w || '',
                '_blueprint_height_cm': ctx.dims.h || ''
            };
        }
    });
})();

(function () {
    'use strict';
    const M = window.MozConfigurator;
    if (!M) return;
    const { el, num, bySort, cmText, cmFromLabel, rgba, metalFromLabel, METAL_FILL } = M.helpers;

    function addonLines(ctx) {
        return (ctx.v.addons || []).filter((a) => !a.free && num(a.price) > 0).map((a) => ({ label: 'Add-on: ' + a.label, value: a.price }));
    }
    function addonText(ctx) {
        return (ctx.v.addons || []).map((a) => a.label + (a.free ? ' (Included)' : '')).join(', ') || 'None';
    }
    function powerStep(ctx) {
        if (!ctx.power.length) return;
        ctx.step('Power Adapter').appendChild(ctx.select('power', ctx.power.map((p) => ({ label: p.l }))).el);
    }
    function metalVisual(label) {
        return (v) => {
            const s = el('span', 'moz-cfg__metal');
            s.style.background = METAL_FILL[metalFromLabel(label)] || METAL_FILL.black;
            v.appendChild(s);
        };
    }
    // Solid frame colours for the infinity letter rims (a text stroke can't take a gradient).
    const FRAME_SOLID = { gold: '#d4a43a', silver: '#c9ced4', rose: '#d79a8c', rust: '#9a4f2c', white: '#ececec', wood: '#9c6b3d', black: '#26262b' };

    // Width of the reference wording at 100px in the given element's font (hidden probe).
    function refWidth(host, text) {
        const probe = el('span', '', text);
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:100px;';
        host.appendChild(probe);
        const w = probe.getBoundingClientRect().width;
        probe.remove();
        return w;
    }

    // Letter size comes from the chosen size only (same as the Neon / 3D configurators): the
    // reference wording fills the size's share of the stage; the customer's wording uses that
    // letter size (short = narrower), and very long wording is shrunk to stay in view.
    function fitWording(ctx, word, share, refText) {
        const f = ctx.free();
        const ref = refWidth(word, refText) || 400;
        let fs = 100 * (f.w * share) / ref;
        fs = Math.min(fs, f.h * 0.85);
        word.style.fontSize = fs + 'px';
        const w = word.getBoundingClientRect().width;
        const max = f.w * 0.94;
        if (w > max) { fs = fs * max / w; word.style.fontSize = fs + 'px'; }
        return fs;
    }

    // -------------------------------------------------------------------------------------
    // 4) Infinity Mirror Signs (3D layout, 3D configurator's bold font, crisp — no blur)
    // -------------------------------------------------------------------------------------
    M.register('infinity', {
        layout: '3d',
        hero: 'Design Your Infinity Mirror Sign',
        build(ctx, d) {
            ctx.step('Enter Your Text').appendChild(ctx.textInput({ max: 30, placeholder: 'Type your text' }).el);
            const sizes = bySort(d.sizes);
            ctx.sizes = sizes;
            ctx.step('Choose Size').appendChild(ctx.cards('size', sizes.map((s) => ({ label: s.l, price: s.p, meta: 'Width: ' + cmText(s.w), src: s })), { price: 'full', cols: 2 }).el);
            const colours = bySort(d.colours);
            if (colours.length) ctx.step('LED Colour').appendChild(ctx.swatches('colour', colours.map((c) => ({ name: c.n, hex: c.h || '#ffffff', price: c.p }))).el);
            const frames = bySort(d.frames);
            if (frames.length) ctx.step('Frame Finish').appendChild(ctx.cards('frame', frames.map((o) => ({ label: o.l, price: o.p, visual: metalVisual(o.l) })), { showIncluded: true, cols: 3, compact: true }).el);
            const mounts = bySort(d.mountings);
            if (mounts.length) ctx.step('Mounting').appendChild(ctx.cards('mounting', mounts.map((o) => ({ label: o.l, price: o.p })), { showIncluded: true, cols: 2, compact: true }).el);
            powerStep(ctx);
            const addons = bySort(d.addons).map((a) => ({ label: a.l, price: a.p, free: !!a.f }));
            if (addons.length) ctx.step('Add-ons').appendChild(ctx.addons('addons', addons).el);
        },
        price(ctx) {
            const lines = [];
            if (ctx.v.size) lines.push({ label: 'Size: ' + ctx.v.size.label, value: ctx.v.size.price, full: true });
            if (ctx.v.colour) lines.push({ label: 'LED colour: ' + ctx.v.colour.name, value: ctx.v.colour.price });
            if (ctx.v.frame) lines.push({ label: 'Frame finish: ' + ctx.v.frame.label, value: ctx.v.frame.price });
            if (ctx.v.mounting) lines.push({ label: 'Mounting: ' + ctx.v.mounting.label, value: ctx.v.mounting.price });
            return lines.concat(addonLines(ctx));
        },
        render(ctx) {
            const sign = ctx.sign;
            const LAYERS = 4;
            if (!ctx._inf) {
                sign.innerHTML = '';
                const word = el('div', 'moz-inf');
                word.setAttribute('data-moz-measure', '');
                sign.appendChild(word);
                ctx._inf = { word, text: null };
            }
            const word = ctx._inf.word;
            const text = (ctx.text || '').trim() || 'Your Text';
            // Per letter: metal rim + dark mirror, and crisp LED rings stepping into the depth.
            if (ctx._inf.text !== text) {
                ctx._inf.text = text;
                word.innerHTML = '';
                Array.from(text).forEach((ch) => {
                    const cell = el('span', 'moz-inf__ch');
                    const glyph = ch === ' ' ? ' ' : ch;
                    cell.appendChild(el('span', 'moz-inf__base', glyph));
                    if (ch !== ' ') {
                        for (let i = 0; i < LAYERS; i++) cell.appendChild(el('span', 'moz-inf__led' + (i === 0 ? ' is-front' : ''), glyph));
                    }
                    word.appendChild(cell);
                });
            }
            word.style.fontFamily = ctx.signFamily || '';
            const size = ctx.v.size ? ctx.v.size.src : null;
            fitWording(ctx, word, ctx.sizeShare(size ? size.w : 0, ctx.sizes.map((s) => s.w)), 'Your Text');
            const c = ctx.v.colour ? ctx.v.colour.hex : '#ff3db8';
            const lit = ctx.ledOn;
            word.style.setProperty('--moz-led', c);
            word.style.setProperty('--moz-led-dim', rgba(c, 0.55));
            word.style.setProperty('--moz-frame', FRAME_SOLID[metalFromLabel(ctx.v.frame && ctx.v.frame.label)] || FRAME_SOLID.black);
            word.classList.toggle('is-lit', lit);
            word.querySelectorAll('.moz-inf__ch').forEach((cell) => {
                Array.from(cell.querySelectorAll('.moz-inf__led')).forEach((t, i) => {
                    t.style.transform = 'scale(' + (0.97 - i * 0.1) + ')';
                    t.style.opacity = lit ? String(1 - i * 0.22) : '0';
                });
            });
            const w = size ? num(size.w) : 0;
            const r = word.getBoundingClientRect();
            const h = w && r.width ? Math.round(w * (r.height / r.width) * 10) / 10 : 0;
            ctx.setDims(w ? cmText(w) : '', h ? cmText(h) : '');
            ctx.dims = { w, h };
        },
        properties(ctx) {
            const p = {
                'Custom Text': (ctx.text || '').trim() || 'Your Text',
                'Font': ctx.signFontName || 'Default',
                'Size': ctx.v.size ? ctx.v.size.label : '',
                'Overall Width': ctx.dims.w ? cmText(ctx.dims.w) : '',
                'LED Colour': ctx.v.colour ? ctx.v.colour.name : 'Standard',
                'Frame Finish': ctx.v.frame ? ctx.v.frame.label : 'Standard',
                'Mounting': ctx.v.mounting ? ctx.v.mounting.label : 'Standard',
                'Add-ons': addonText(ctx),
                '_blueprint_width_cm': ctx.dims.w || '',
                '_blueprint_height_cm': ctx.dims.h || ''
            };
            if (ctx.v.power) p['Power Adapter'] = ctx.v.power.label;
            return p;
        }
    });

    // ---- One bulb per marquee letter, placed on the letter's thickest stroke near its centre ----
    // The glyph is drawn on a small canvas in the real font; a distance transform finds the point
    // deepest inside the stroke closest to the middle (stem of a "Y", side of an "O", ...).
    const BULB_CACHE = {};
    function bulbPoint(ch, fontCss) {
        const key = fontCss + '|' + ch;
        if (BULB_CACHE[key]) return BULB_CACHE[key];
        const S = 100;
        const W = 160;
        const H = 160;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        g.font = fontCss.replace(/\b\d+(\.\d+)?px\b/, S + 'px');
        g.textBaseline = 'alphabetic';
        g.fillStyle = '#000';
        const ox = 20;
        const base = 120;
        g.fillText(ch, ox, base);
        const data = g.getImageData(0, 0, W, H).data;
        const INF = 1e6;
        const dist = new Float32Array(W * H);
        let minX = W, minY = H, maxX = 0, maxY = 0, any = false;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const inside = data[(y * W + x) * 4 + 3] > 127;
                dist[y * W + x] = inside ? INF : 0;
                if (inside) { any = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
            }
        }
        if (!any) return null;
        // Two-pass chamfer distance (1 / 1.4).
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const i = y * W + x;
                if (!dist[i]) continue;
                dist[i] = Math.min(dist[i], dist[i - 1] + 1, dist[i - W] + 1, dist[i - W - 1] + 1.4, dist[i - W + 1] + 1.4);
            }
        }
        for (let y = H - 2; y > 0; y--) {
            for (let x = W - 2; x > 0; x--) {
                const i = y * W + x;
                if (!dist[i]) continue;
                dist[i] = Math.min(dist[i], dist[i + 1] + 1, dist[i + W] + 1, dist[i + W + 1] + 1.4, dist[i + W - 1] + 1.4);
            }
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        let best = -INF, bx = cx, by = cy, br = 0;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dv = dist[y * W + x];
                if (!dv) continue;
                const score = dv - 0.16 * Math.hypot(x - cx, y - cy);
                if (score > best) { best = score; bx = x; by = y; br = dv; }
            }
        }
        // Relative to the text origin (left edge, baseline), in em.
        const res = { x: (bx - ox) / S, y: (by - base) / S, r: br / S };
        if (!document.fonts || document.fonts.check(g.font)) BULB_CACHE[key] = res;
        return res;
    }

    // -------------------------------------------------------------------------------------
    // 5) Event Marquee Letter Signs (3D layout, 3D bold font, one bulb per letter)
    // -------------------------------------------------------------------------------------
    M.register('marquee', {
        layout: '3d',
        hero: 'Design Your Marquee Letters',
        build(ctx, d) {
            const opts = d.opts || [];
            const cat = (c) => bySort(opts.filter((o) => String(o.c || '').trim().toLowerCase() === c));
            ctx.step('Enter Your Text').appendChild(ctx.textInput({ max: 20, placeholder: 'Type your letters / text' }).el);
            const styles = cat('style');
            if (styles.length) ctx.step('Letter Style').appendChild(ctx.cards('style', styles.map((o) => ({ label: o.l, price: o.p, visual: metalVisual(o.l) })), { showIncluded: true, cols: 3, compact: true }).el);
            const sizes = cat('size');
            ctx.sizes = sizes;
            ctx.step('Choose Size').appendChild(ctx.cards('size', sizes.map((s) => ({ label: s.l, price: s.p, meta: num(s.h) ? 'Letter height: ' + cmText(s.h) : '', src: s })), { price: 'full', cols: 2 }).el);
            const colours = cat('colour');
            if (colours.length) ctx.step('Bulb Colour').appendChild(ctx.swatches('colour', colours.map((c) => ({ name: c.l, hex: c.hc || '#ffd27a', price: c.p }))).el);
            const mounts = cat('mounting');
            if (mounts.length) ctx.step('Mounting').appendChild(ctx.cards('mounting', mounts.map((o) => ({ label: o.l, price: o.p })), { showIncluded: true, cols: 2, compact: true }).el);
            powerStep(ctx);
            const addons = cat('addon').map((a) => ({ label: a.l, price: a.p, free: !!a.f }));
            if (addons.length) ctx.step('Add-ons').appendChild(ctx.addons('addons', addons).el);
        },
        price(ctx) {
            const lines = [];
            const letters = ((ctx.text || '').trim() || 'Your Text');
            if (ctx.v.size) lines.push({ label: 'Size: ' + ctx.v.size.label, value: ctx.v.size.price, full: true });
            if (ctx.v.style) lines.push({ label: 'Letter style: ' + ctx.v.style.label, value: ctx.v.style.price });
            if (ctx.v.colour) lines.push({ label: 'Bulb colour: ' + ctx.v.colour.name, value: ctx.v.colour.price });
            if (ctx.v.mounting) lines.push({ label: 'Mounting: ' + ctx.v.mounting.label, value: ctx.v.mounting.price });
            ctx.letterCount = letters.replace(/\s/g, '').length;
            return lines.concat(addonLines(ctx));
        },
        render(ctx) {
            const sign = ctx.sign;
            if (!ctx._mq) {
                sign.innerHTML = '';
                const word = el('div', 'moz-mq');
                word.setAttribute('data-moz-measure', '');
                sign.appendChild(word);
                ctx._mq = { word, text: null };
            }
            const word = ctx._mq.word;
            const text = (ctx.text || '').trim() || 'Your Text';
            if (ctx._mq.text !== text) {
                ctx._mq.text = text;
                word.innerHTML = '';
                Array.from(text).forEach((ch) => {
                    const cell = el('span', 'moz-mq__ch');
                    const glyph = ch === ' ' ? ' ' : ch;
                    cell.appendChild(el('span', 'moz-mq__depth', glyph));
                    const face = el('span', 'moz-mq__face', glyph);
                    cell.appendChild(face);
                    if (ch !== ' ') {
                        // Baseline marker sits INSIDE the letter's line (not on a new line below it).
                        face.appendChild(el('i', 'moz-mq__base-probe'));
                        cell.appendChild(el('span', 'moz-mq__bulb'));
                    }
                    cell.dataset.ch = ch;
                    word.appendChild(cell);
                });
            }
            word.style.fontFamily = ctx.signFamily || '';
            const size = ctx.v.size ? ctx.v.size.src : null;
            const heights = ctx.sizes.map((s) => num(s.h) || cmFromLabel(s.l));
            const hCm = size ? (num(size.h) || cmFromLabel(size.l)) : 0;
            const fs = fitWording(ctx, word, ctx.sizeShare(hCm, heights) * 0.95, 'Your Text');
            const metal = metalFromLabel(ctx.v.style && ctx.v.style.label) || 'white';
            word.style.setProperty('--moz-face-fill', METAL_FILL[metal] || METAL_FILL.white);
            const c = ctx.v.colour ? ctx.v.colour.hex : '#ffd27a';
            word.style.setProperty('--moz-bulb', c);
            word.style.setProperty('--moz-bulb-a', rgba(c, 0.6));
            word.classList.toggle('is-lit', ctx.ledOn);
            // Place one bulb per letter.
            const cs = getComputedStyle(word);
            const fontCss = cs.fontStyle + ' ' + cs.fontWeight + ' 100px ' + cs.fontFamily;
            word.querySelectorAll('.moz-mq__ch').forEach((cell) => {
                const bulb = cell.querySelector('.moz-mq__bulb');
                const probe = cell.querySelector('.moz-mq__base-probe');
                if (!bulb || !probe) return;
                const pt = bulbPoint(cell.dataset.ch, fontCss);
                if (!pt) { bulb.hidden = true; return; }
                bulb.hidden = false;
                // Baseline y inside this letter cell (face sits at the top of the cell).
                const baseY = probe.getBoundingClientRect().top - cell.getBoundingClientRect().top;
                const dia = Math.max(6, Math.min(fs * 0.17, pt.r * fs * 1.5));
                bulb.style.width = dia + 'px';
                bulb.style.height = dia + 'px';
                bulb.style.left = (pt.x * fs - dia / 2) + 'px';
                bulb.style.top = (baseY + pt.y * fs - dia / 2) + 'px';
            });
            const r = word.getBoundingClientRect();
            const capH = fs * 0.72;
            const wCm = hCm && capH ? Math.round(hCm * (r.width / capH) * 10) / 10 : 0;
            ctx.setDims(wCm ? '≈ ' + cmText(wCm) : '', hCm ? cmText(hCm) : '');
            ctx.dims = { w: wCm, h: hCm };
        },
        properties(ctx) {
            const p = {
                'Custom Text': (ctx.text || '').trim() || 'Your Text',
                'Letters/Characters': String(ctx.letterCount || 0),
                'Font': ctx.signFontName || 'Default',
                'Letter Style': ctx.v.style ? ctx.v.style.label : 'Standard',
                'Size': ctx.v.size ? ctx.v.size.label : '',
                'Letter Height': ctx.dims.h ? cmText(ctx.dims.h) : '',
                'Bulb Colour': ctx.v.colour ? ctx.v.colour.name : 'Standard',
                'Mounting': ctx.v.mounting ? ctx.v.mounting.label : 'Standard',
                'Add-ons': addonText(ctx),
                '_blueprint_width_cm': ctx.dims.w || '',
                '_blueprint_height_cm': ctx.dims.h || ''
            };
            if (ctx.v.power) p['Power Adapter'] = ctx.v.power.label;
            return p;
        }
    });
})();
