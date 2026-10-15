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
                    const card = el('button', 'moz-cfg__card');
                    card.type = 'button';
                    if (item.visual) {
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
                    card.addEventListener('click', () => control.select(idx));
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
    // 1) UV Graphic Signs — With or Without Neon Lighting (Neon configurator layout)
    // -------------------------------------------------------------------------------------
    M.register('uv', {
        layout: 'neon',
        hero: 'Design Your UV Graphic Sign',
        build(ctx, d) {
            const sizes = bySort(d.sizes);
            const isLed = () => !!(ctx.v.lighting && ctx.v.lighting.key === 'led');
            const sizePrice = (s) => (isLed() || s.pn === null || s.pn === undefined || s.pn === '') ? num(s.p) : num(s.pn);
            const sizeCardsFor = () => sizes.map((s) => ({ label: s.l, price: sizePrice(s), meta: 'Width: ' + cmText(s.w), src: s }));

            const up = ctx.step('Upload Your Graphic / Logo', { note: 'This range is made for your own logos, graphics and printed designs — upload your artwork first.' });
            up.appendChild(ctx.upload().el);

            const lightStep = ctx.step('Lighting');
            let sizeCtl = null;
            let addonCtl = null;
            const ledSteps = [];
            const lightItems = [
                { key: 'led', label: 'With Neon Lighting', desc: 'UV printed graphic with glowing LED neon lighting.', price: 0, visual: (v) => v.appendChild(el('span', 'moz-cfg__light-sample is-on')) },
                { key: 'no_led', label: 'Without Neon Lighting', desc: 'UV printed graphic panel only — no lighting or power needed.', price: 0, visual: (v) => v.appendChild(el('span', 'moz-cfg__light-sample')) }
            ];
            const lightCtl = ctx.cards('lighting', lightItems, {
                price: 'none',
                cols: 2,
                onChange: () => {
                    ledSteps.forEach((s) => { s.hidden = !isLed(); });
                    if (sizeCtl) sizeCtl.setItems(sizeCardsFor(), true);
                    if (addonCtl) addonCtl.setItems(addonsFor());
                }
            });
            lightStep.appendChild(lightCtl.el);

            const sizeStep = ctx.step('Choose Size');
            sizeCtl = ctx.cards('size', sizeCardsFor(), { price: 'full', cols: 2 });
            sizeStep.appendChild(sizeCtl.el);

            if ((d.materials || []).length) {
                const s = ctx.step('Material');
                s.appendChild(ctx.cards('material', cardItems(d.materials, (o) => ({ visual: metalVisual(o.l) })), { showIncluded: true, cols: 3, compact: true }).el);
            }
            if ((d.finishes || []).length) {
                const s = ctx.step('Finish');
                s.appendChild(ctx.cards('finish', cardItems(d.finishes), { showIncluded: true, cols: 3, compact: true }).el);
            }
            if ((d.colours || []).length) {
                const s = ctx.step('Neon Colour');
                s.appendChild(ctx.swatches('colour', swatchItems(d.colours)).el);
                ledSteps.push(s);
            }
            const ps = powerStep(ctx);
            if (ps) ledSteps.push(ps);

            const allAddons = addonItems(d.addons);
            function addonsFor() {
                const mode = isLed() ? 'led' : 'no_led';
                return allAddons.filter((a) => { const sf = String(a.src.sf || 'both'); return sf === 'both' || sf === '' || sf === mode; });
            }
            const addStep = ctx.step('Add-ons');
            addonCtl = ctx.addons('addons', addonsFor());
            addStep.appendChild(addonCtl.el);
            addStep.hidden = !allAddons.length;

            const inst = ctx.installation();
            if (inst) ctx.step('Need Installation?', { unnumbered: true }).appendChild(inst.el);

            lightCtl.select(d.start === 'no_led' ? 1 : 0, true);
            ctx.sizes = sizes;
            ctx.isLed = isLed;
            ctx.sizePrice = sizePrice;
        },
        price(ctx) {
            const lines = [];
            const size = ctx.v.size;
            if (size) lines.push({ label: 'Size: ' + size.label + (ctx.isLed() ? ' (With Neon)' : ' (Without Neon)'), value: ctx.sizePrice(size.src), full: true });
            if (ctx.v.material) lines.push({ label: 'Material: ' + ctx.v.material.label, value: ctx.v.material.price });
            if (ctx.v.finish) lines.push({ label: 'Finish: ' + ctx.v.finish.label, value: ctx.v.finish.price });
            if (ctx.isLed() && ctx.v.colour) lines.push({ label: 'Neon colour: ' + ctx.v.colour.name, value: ctx.v.colour.price });
            return lines.concat(addonLines(ctx, 'addons'), installLine(ctx));
        },
        render(ctx) {
            const sign = ctx.sign;
            if (!ctx._uv) {
                sign.innerHTML = '';
                const panel = el('div', 'moz-uv');
                panel.setAttribute('data-moz-measure', '');
                const art = el('div', 'moz-uv__art');
                const ph = el('div', 'moz-uv__placeholder', 'Your Logo / Graphic');
                art.appendChild(ph);
                panel.appendChild(art);
                panel.appendChild(el('span', 'moz-uv__sheen'));
                sign.appendChild(panel);
                ctx._uv = { panel, art, ph };
            }
            const { panel, art, ph } = ctx._uv;
            const img = designImg(ctx, art, 'moz-uv__img');
            ph.hidden = !!img;
            const aspect = ctx.logo.aspect || 1.5;
            const size = ctx.v.size ? ctx.v.size.src : null;
            const box = ctx.fit(ctx.sizeShare(size ? size.w : 0, ctx.sizes.map((s) => s.w)), aspect);
            panel.style.width = box.w + 'px';
            panel.style.height = box.h + 'px';
            const mat = metalFromLabel(ctx.v.material && ctx.v.material.label);
            const matLabel = String(ctx.v.material ? ctx.v.material.label : '').toLowerCase();
            panel.className = 'moz-uv'
                + (/clear|acrylic|perspex|glass/.test(matLabel) ? ' is-clear' : (mat === 'silver' ? ' is-metal' : ' is-solid'))
                + (/matt/.test(String(ctx.v.finish ? ctx.v.finish.label : '').toLowerCase()) ? ' is-matte' : ' is-gloss');
            const lit = ctx.isLed() && ctx.ledOn;
            panel.classList.toggle('is-lit', lit);
            panel.classList.toggle('is-neon', ctx.isLed());
            const c = glowColour(ctx.v.colour ? ctx.v.colour.hex : '#ffffff');
            panel.style.setProperty('--moz-glow', c);
            panel.style.setProperty('--moz-glow-a', rgba(c, 0.55));
            if (img) img.style.filter = lit ? 'drop-shadow(0 0 2px ' + c + ') drop-shadow(0 0 6px ' + c + ') drop-shadow(0 0 16px ' + rgba(c, 0.8) + ') drop-shadow(0 0 32px ' + rgba(c, 0.45) + ')' : 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))';
            const w = size ? num(size.w) : 0;
            ctx.setDims(w ? cmText(w) : '', w ? cmText(w / aspect) : '');
            ctx.dims = { w, h: w ? Math.round((w / aspect) * 10) / 10 : 0 };
        },
        properties(ctx) {
            const p = {
                'Design Source': 'Uploaded Graphic / Logo',
                'Uploaded Design': designUrl(ctx),
                'Lighting': ctx.isLed() ? 'With Neon Lighting' : 'Without Neon Lighting',
                'Size': ctx.v.size ? ctx.v.size.label : '',
                'Overall Width': ctx.dims.w ? cmText(ctx.dims.w) : '',
                'Material': ctx.v.material ? ctx.v.material.label : 'Standard',
                'Finish': ctx.v.finish ? ctx.v.finish.label : 'Standard',
                'Add-ons': addonText(ctx, 'addons'),
                '_blueprint_width_cm': ctx.dims.w || '',
                '_blueprint_height_cm': ctx.dims.h || ''
            };
            if (ctx.isLed()) {
                if (ctx.v.colour) p['Neon Colour'] = ctx.v.colour.name;
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
    // 3) Lightbox Signs — straightforward: shape, sides, size, design, frame colour
    // -------------------------------------------------------------------------------------
    M.register('lightbox', {
        layout: 'neon',
        hero: 'Design Your Lightbox',
        build(ctx, d) {
            const opts = d.opts || [];
            const cat = (c) => opts.filter((o) => String(o.c || '').trim().toLowerCase() === c);
            const shapes = cat('shape');
            if (shapes.length) {
                ctx.step('Choose Shape').appendChild(ctx.cards('shape', cardItems(shapes, (o) => ({
                    key: String(o.k || 'circle').toLowerCase(),
                    visual: (v) => v.appendChild(el('span', 'moz-cfg__shape-icon is-' + String(o.k || 'circle').toLowerCase()))
                })), { showIncluded: true, cols: 3, compact: true }).el);
            }
            const allSizes = bySort(cat('size'));
            const hasDouble = allSizes.some((s) => String(s.sd || 'single').toLowerCase() === 'double');
            let sizeCtl = null;
            const sizesFor = () => {
                const sides = ctx.v.sides ? ctx.v.sides.key : 'single';
                const list = allSizes.filter((s) => String(s.sd || 'single').toLowerCase() === sides);
                return (list.length ? list : allSizes).map((s) => ({ label: s.l, price: s.p, src: s }));
            };
            if (hasDouble) {
                ctx.step('Sides').appendChild(ctx.cards('sides', [
                    { key: 'single', label: 'Single-Sided', desc: 'Lit graphic on the front face.', price: 0 },
                    { key: 'double', label: 'Double-Sided', desc: 'Lit graphic on both faces — ideal for projecting signs.', price: 0 }
                ], { price: 'none', cols: 2, onChange: () => { if (sizeCtl) sizeCtl.setItems(sizesFor(), true); } }).el);
            } else {
                ctx.v.sides = { key: 'single', label: 'Single-Sided' };
            }
            ctx.step('Choose Size').appendChild((sizeCtl = ctx.cards('size', sizesFor(), { price: 'full', cols: 2 })).el);
            ctx.step('Upload Your Design', { note: 'Your logo or artwork for the lit face.' }).appendChild(ctx.upload().el);
            const frames = cat('frame_colour');
            if (frames.length) ctx.step('Frame Colour').appendChild(ctx.swatches('frame', swatchItems(frames.map((o) => ({ n: o.l, hc: o.hc || '#1a1a1a', p: o.p, s: o.s })))).el);
        },
        price(ctx) {
            const lines = [];
            if (ctx.v.size) lines.push({ label: 'Size: ' + ctx.v.size.label + ' (' + (ctx.v.sides ? ctx.v.sides.label : 'Single-Sided') + ')', value: ctx.v.size.price, full: true });
            if (ctx.v.shape) lines.push({ label: 'Shape: ' + ctx.v.shape.label, value: ctx.v.shape.price });
            if (ctx.v.frame) lines.push({ label: 'Frame colour: ' + ctx.v.frame.name, value: ctx.v.frame.price });
            return lines;
        },
        render(ctx) {
            const sign = ctx.sign;
            if (!ctx._lb) {
                sign.innerHTML = '';
                const box = el('div', 'moz-lightbox');
                box.setAttribute('data-moz-measure', '');
                const face = el('div', 'moz-lightbox__face');
                const ph = el('div', 'moz-lightbox__placeholder', 'Your Design');
                face.appendChild(ph);
                box.appendChild(face);
                box.appendChild(el('span', 'moz-lightbox__tag', 'Double-Sided'));
                sign.appendChild(box);
                ctx._lb = { box, face, ph };
            }
            const { box, face, ph } = ctx._lb;
            const img = designImg(ctx, face, 'moz-lightbox__img');
            ph.hidden = !!img;
            const shape = ctx.v.shape ? ctx.v.shape.key : 'circle';
            const label = ctx.v.size ? ctx.v.size.label : '';
            const nums = (String(label).match(/\d+(?:\.\d+)?/g) || []).map(Number);
            let wCm = cmFromLabel(label);
            let hCm = wCm;
            if (shape === 'rectangle') hCm = nums.length > 1 ? nums[1] : Math.round(wCm * 0.6);
            const aspect = wCm && hCm ? wCm / hCm : (shape === 'rectangle' ? 1.6 : 1);
            const all = (ctx.data.opts || []).filter((o) => String(o.c || '').toLowerCase() === 'size').map((o) => cmFromLabel(o.l));
            const b = ctx.fit(ctx.sizeShare(wCm, all) * (shape === 'rectangle' ? 1 : 0.8), aspect);
            box.style.width = b.w + 'px';
            box.style.height = b.h + 'px';
            box.className = 'moz-lightbox is-' + shape + (ctx.ledOn ? ' is-lit' : '') + (ctx.v.sides && ctx.v.sides.key === 'double' ? ' is-double' : '');
            box.style.setProperty('--moz-frame', ctx.v.frame ? ctx.v.frame.hex : '#1a1a1a');
            ctx.setDims(wCm ? cmText(wCm) : '', hCm ? cmText(hCm) : '');
            ctx.dims = { w: wCm, h: hCm };
        },
        properties(ctx) {
            return {
                'Shape': ctx.v.shape ? ctx.v.shape.label : '',
                'Sides': ctx.v.sides ? ctx.v.sides.label : 'Single-Sided',
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
    // 4) Infinity Mirror Signs (3D configurator layout)
    // -------------------------------------------------------------------------------------
    M.register('infinity', {
        layout: '3d',
        hero: 'Design Your Infinity Mirror Sign',
        build(ctx, d) {
            ctx.step('Enter Your Text').appendChild(ctx.textInput({ max: 30, placeholder: 'Type your text' }).el);
            const fonts = bySort(d.fonts);
            if (fonts.length) ctx.step('Choose Font').appendChild(ctx.fonts('font', fonts).el);
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
            const LAYERS = 6;
            if (!ctx._inf) {
                sign.innerHTML = '';
                const word = el('div', 'moz-inf');
                word.setAttribute('data-moz-measure', '');
                sign.appendChild(word);
                ctx._inf = { word, text: null };
            }
            const word = ctx._inf.word;
            const text = (ctx.text || '').trim() || 'Your Text';
            // One element per letter: metal frame + dark mirror (base) and LED rings that shrink
            // into the depth of that same letter — the real infinity-mirror look.
            if (ctx._inf.text !== text) {
                ctx._inf.text = text;
                word.innerHTML = '';
                Array.from(text).forEach((ch) => {
                    const cell = el('span', 'moz-inf__ch');
                    const glyph = ch === ' ' ? '\u00A0' : ch;
                    cell.appendChild(el('span', 'moz-inf__base', glyph));
                    if (ch !== ' ') {
                        for (let i = 0; i < LAYERS; i++) cell.appendChild(el('span', 'moz-inf__led' + (i === 0 ? ' is-front' : ''), glyph));
                    }
                    word.appendChild(cell);
                });
            }
            word.style.fontFamily = ctx.v.font ? ctx.v.font.family : '';
            const size = ctx.v.size ? ctx.v.size.src : null;
            fitWording(ctx, word, ctx.sizeShare(size ? size.w : 0, ctx.sizes.map((s) => s.w)), 'Your Text');
            const c = ctx.v.colour ? ctx.v.colour.hex : '#ff3db8';
            const lit = ctx.ledOn;
            word.style.setProperty('--moz-led', c);
            word.style.setProperty('--moz-led-a', rgba(c, 0.7));
            word.style.setProperty('--moz-frame', FRAME_SOLID[metalFromLabel(ctx.v.frame && ctx.v.frame.label)] || FRAME_SOLID.black);
            word.classList.toggle('is-lit', lit);
            word.querySelectorAll('.moz-inf__ch').forEach((cell) => {
                Array.from(cell.querySelectorAll('.moz-inf__led')).forEach((t, i) => {
                    t.style.transform = 'scale(' + (1 - i * 0.075) + ')';
                    t.style.opacity = lit ? String(Math.max(0.1, 1 - i * 0.16)) : '0';
                });
            });
            const w = size ? num(size.w) : 0;
            const r = word.getBoundingClientRect();
            const h = w && r.width ? Math.round(w * (r.height / r.width) * 10) / 10 : 0;
            ctx.setDims(w ? cmText(w) : '', h ? cmText(h) : '');
            ctx.dims = { w, h };
        },        properties(ctx) {
            const p = {
                'Custom Text': (ctx.text || '').trim() || 'Your Text',
                'Font': ctx.v.font ? ctx.v.font.label : 'Default',
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

    // -------------------------------------------------------------------------------------
    // 5) Event Marquee Letter Signs (3D configurator layout)
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
                const word = el('div', 'moz-marquee');
                word.setAttribute('data-moz-measure', '');
                const depth = el('span', 'moz-marquee__depth');
                const face = el('span', 'moz-marquee__face');
                const bulbs = el('span', 'moz-marquee__bulbs');
                word.appendChild(depth);
                word.appendChild(face);
                word.appendChild(bulbs);
                sign.appendChild(word);
                ctx._mq = { word, depth, face, bulbs };
            }
            const { word, depth, face, bulbs } = ctx._mq;
            const text = (ctx.text || '').trim() || 'Your Text';
            [depth, face, bulbs].forEach((n) => { n.textContent = text; });
            const size = ctx.v.size ? ctx.v.size.src : null;
            const heights = ctx.sizes.map((s) => num(s.h) || cmFromLabel(s.l));
            const hCm = size ? (num(size.h) || cmFromLabel(size.l)) : 0;
            const fs = fitWording(ctx, word, ctx.sizeShare(hCm, heights) * 0.95, 'Your Text');
            const metal = metalFromLabel(ctx.v.style && ctx.v.style.label) || 'white';
            word.style.setProperty('--moz-face-fill', METAL_FILL[metal] || METAL_FILL.white);
            const c = ctx.v.colour ? ctx.v.colour.hex : '#ffd27a';
            word.style.setProperty('--moz-bulb', c);
            word.style.setProperty('--moz-bulb-a', rgba(c, 0.65));
            word.style.setProperty('--moz-bulb-gap', Math.max(8, fs * 0.2) + 'px');
            word.classList.toggle('is-lit', ctx.ledOn);
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
