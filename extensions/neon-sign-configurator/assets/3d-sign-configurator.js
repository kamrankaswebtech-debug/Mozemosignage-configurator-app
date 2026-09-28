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

// Shopify can take a brief moment to make a brand-new variant (created via the Admin API)
// fully available to the storefront cart endpoint. Retrying a couple of times with an
// increasing delay — only for freshly-created variants — avoids showing a false error.
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

// Shows a spinning loader inside the button next to the given text.
function setButtonLoadingText(button, text) {
    button.innerHTML = '<span class="sign3d-configurator__spinner"></span><span>' + text + '</span>';
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

function initSign3dConfigurator(root) {
    const previewText = root.querySelector('[data-preview-text]');
    const textInput = root.querySelector('[data-text-input]');
    const fontSelect = root.querySelector('[data-font-select]');
    const symbolButtons = root.querySelectorAll('[data-symbol-buttons] .sign3d-configurator__symbol-btn');
    const iconsContainer = root.querySelector('[data-preview-icons]');
    const symbolPositionRadios = root.querySelectorAll('[data-symbol-position-radio]');
    let selectedSymbols = [];
    let currentSymbolPosition = 'right';
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
    const previewStage = root.querySelector('[data-preview-stage]');
    const previewInner = root.querySelector('[data-preview-inner]');
    const widthLabel = root.querySelector('[data-width-label]');
    const heightLabel = root.querySelector('[data-height-label]');
    const widthDimLine = root.querySelector('.sign3d-configurator__dim-line--width');
    const heightDimLine = root.querySelector('.sign3d-configurator__dim-line--height');
    const textFlex = root.querySelector('[data-text-flex]');
    const selectionBox = root.querySelector('[data-selection-box]');
    const previewBox = root.querySelector('[data-preview-box]');
    const previewInnerForLed = root.querySelector('[data-preview-inner]');
    const bgThumbs = root.querySelectorAll('[data-bg-thumbs] .sign3d-configurator__bg-thumb');
    const wallpaperToggle = root.querySelector('[data-hide-wallpaper-toggle]');
    const wallpaperToggleLabel = root.querySelector('[data-wallpaper-toggle-label]');
    const measurementsLabel = root.querySelector('[data-measurements-label]');
    const ledToggle = root.querySelector('[data-led-toggle]');
    const ledLabel = root.querySelector('[data-led-label]');
    let selectedBgUrl = bgThumbs.length ? bgThumbs[0].dataset.bgUrl : null;
    let wallpaperHidden = false;
    const alignButtons = root.querySelectorAll('[data-align-btn]');
    const selectAllBtn = root.querySelector('[data-select-all-btn]');
    const undoBtn = root.querySelector('[data-undo-btn]');
    const redoBtn = root.querySelector('[data-redo-btn]');
    const resetColourBtn = root.querySelector('[data-reset-colour-btn]');
    const resetScaleSizeBtn = root.querySelector('[data-reset-scale-size-btn]');
    const resetFontBtn = root.querySelector('[data-reset-font-btn]');

    // ---- NEW: live-measurement pricing engine (width/letter-height/letter-count/depth,
    // Indoor/Outdoor, logo upload with live scaling, price breakdown, final review) ----
    const pricingConfigEl = root.querySelector('[data-sign3d-pricing-config]');
    let pricingConfig = null;
    try {
        pricingConfig = pricingConfigEl ? JSON.parse(pricingConfigEl.textContent) : null;
    } catch (err) {
        console.error('3D Sign Configurator: failed to parse pricing config JSON.', err);
        pricingConfig = null;
    }

    const modeButtons = root.querySelectorAll('[data-mode-btn]');
    const modePanels = root.querySelectorAll('[data-mode-panel]');
    const widthInput = root.querySelector('[data-width-input]');
    const letterHeightInput = root.querySelector('[data-letter-height-input]');
    const depthSelect = root.querySelector('[data-depth-select]');
    const indoorOutdoorRadios = root.querySelectorAll('[data-indoor-outdoor-radio]');
    const breakdownRows = root.querySelector('[data-breakdown-rows]');
    const uploadTriggerBtn = root.querySelector('[data-upload-trigger-btn]');
    const logoUploadInput = root.querySelector('[data-logo-upload-input]');
    const uploadFilenameEl = root.querySelector('[data-upload-filename]');
    const reviewBtn = root.querySelector('[data-review-btn]');
    const reviewModal = root.querySelector('[data-review-modal]');
    const reviewCloseBtn = root.querySelector('[data-review-close-btn]');
    const reviewConfirmBtn = root.querySelector('[data-review-confirm-btn]');
    const reviewSummaryEl = root.querySelector('[data-review-summary]');

    let currentMode = 'text';
    let logoImg = null;
    let uploadedLogoUrl = null;
    let lastReviewData = null;

    // Logo upload state: local preview shows instantly, the server upload runs in the background.
    let logoPreviewSrc = null;
    let logoLocalObjectUrl = null;
    let logoUploadPromise = null;

    // Logo placement (Canva-style move/resize) + selection
    let logoOffsetX = 0;
    let logoOffsetY = 0;
    let logoScale = 1;
    let logoSelected = false;

    // Unit shown in the Width/Height inputs. Follows the Custom Size Slider tab. Default CM.
    let currentUnit = 'cm';

    // Over-2m notice, same as the LED Neon configurator (works for any unit).
    const oversizedNoticeEl = document.createElement('p');
    oversizedNoticeEl.className = 'sign3d-configurator__oversized-notice';
    oversizedNoticeEl.hidden = true;
    oversizedNoticeEl.textContent = '⚠️ Signs larger than 2 metres are manufactured and shipped in split sections due to oversized delivery and transportation requirements.';
    const widthFieldEl = widthInput ? widthInput.closest('.sign3d-configurator__field') : null;
    if (widthFieldEl) widthFieldEl.insertAdjacentElement('afterend', oversizedNoticeEl);
    let logoFileName = '';
    // Images larger than this (longest side, px) are shrunk in the browser before uploading.
    // Set to 0 to always upload the original file.
    const LOGO_MAX_DIMENSION = 2000;

    // 'text' = wording only, 'upload' = logo only, 'both' = wording + logo
    function hasText() { return currentMode !== 'upload'; }
    function hasLogo() { return currentMode !== 'text'; }
    function designSourceLabel() {
        if (currentMode === 'upload') return 'Uploaded Logo/Design';
        if (currentMode === 'both') return 'Wording + Logo';
        return 'Typed Wording';
    }
    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Shrinks big raster images before upload (much faster). PNG stays PNG (transparency kept).
    async function downscaleImageForUpload(file) {
        if (!LOGO_MAX_DIMENSION) return file;
        const type = file.type || '';
        if (type.indexOf('image/') !== 0 || type === 'image/svg+xml' || type === 'image/gif') return file;
        if (typeof createImageBitmap !== 'function') return file;
        try {
            const bmp = await createImageBitmap(file);
            const scale = Math.min(1, LOGO_MAX_DIMENSION / Math.max(bmp.width, bmp.height));
            if (scale === 1 && file.size < 1.5 * 1024 * 1024) { if (bmp.close) bmp.close(); return file; }
            const w = Math.max(1, Math.round(bmp.width * scale));
            const h = Math.max(1, Math.round(bmp.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
            if (bmp.close) bmp.close();
            const outType = type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, outType, 0.86));
            if (!blob || blob.size >= file.size) return file;
            const base = file.name.replace(/\.[^.]+$/, '');
            return new File([blob], base + (outType === 'image/jpeg' ? '.jpg' : '.png'), { type: outType });
        } catch (err) {
            return file;
        }
    }

    function ensureLogoImgElement() {
        if (logoImg || !previewInner) return;
        logoImg = document.createElement('img');
        logoImg.className = 'sign3d-configurator__logo-preview-img';
        logoImg.alt = 'Your uploaded logo';
        logoImg.addEventListener('load', () => updatePreviewScale());
        logoImg.draggable = false;
        attachLogoInteraction(logoImg);
        previewInner.appendChild(logoImg);
    }

    function findAscendingTier(tiers, key, value) {
        if (!tiers || !tiers.length) return null;
        const sorted = tiers.slice().sort((a, b) => a[key] - b[key]);
        for (const tier of sorted) {
            if (value <= tier[key]) return tier;
        }
        return sorted[sorted.length - 1];
    }

    function findLetterCountTier(tiers, count) {
        if (!tiers || !tiers.length) return null;
        const sorted = tiers.slice().sort((a, b) => a.startsAt - b.startsAt);
        let applicable = null;
        sorted.forEach((tier) => {
            if (tier.startsAt <= count) applicable = tier;
        });
        return applicable;
    }

    // Stacked shadow layers simulate real acrylic/letter depth — more depth (mm) = more
    // visible extruded "steps" behind the front face. Works for both text (text-shadow)
    // and the uploaded logo image (drop-shadow filter, built separately below).
    function buildExtrusionShadow(depthMm) {
        const steps = Math.max(3, Math.min(14, Math.round((depthMm || 10) / 1.5)));
        const layers = [];
        for (let i = 1; i <= steps; i++) {
            const alpha = (0.28 + (i / steps) * 0.3).toFixed(2);
            layers.push(i + 'px ' + i + 'px 0 rgba(0,0,0,' + alpha + ')');
        }
        return layers.join(', ');
    }

    function buildExtrusionFilter(depthMm) {
        const steps = Math.max(3, Math.min(14, Math.round((depthMm || 10) / 1.5)));
        const layers = [];
        for (let i = 1; i <= steps; i++) {
            const alpha = (0.3 + (i / steps) * 0.3).toFixed(2);
            layers.push('drop-shadow(' + i + 'px ' + i + 'px 0 rgba(0,0,0,' + alpha + '))');
        }
        return layers.join(' ');
    }

    function updateDepthVisual() {
        const depthOption = depthSelect ? depthSelect.options[depthSelect.selectedIndex] : null;
        const depthMm = parseFloat(depthOption?.value) || 10;
        if (previewInnerForLed) {
            previewInnerForLed.style.setProperty('--sign3d-extrusion-shadow', buildExtrusionShadow(depthMm));
        }
        if (logoImg) {
            logoImg.style.filter = buildExtrusionFilter(depthMm);
        }
    }

    function updateLogoPreviewSize(widthCm, heightCm) {
        if (!logoImg) return;
        const aspect = (logoImg.naturalWidth || 1) / (logoImg.naturalHeight || 1);
        const innerW = (previewInner ? previewInner.clientWidth : 600) - 24;
        const maxW = Math.max(120, Math.min(innerW, 640));
        let maxH = Math.max(170, Math.min(280, window.innerHeight * 0.34));
        if (currentMode === 'both') maxH *= 0.6; // leave room for the text below the logo

        // Logo keeps its own proportions and is shown as large as the preview allows.
        // Overall Width still nudges the size a little (0.65x .. 1x).
        const factor = Math.min(1, 0.65 + 0.35 * ((widthCm || 100) / 200));
        let w = maxW;
        let h = w / aspect;
        if (h > maxH) { h = maxH; w = h * aspect; }
        logoImg.style.width = Math.round(w * factor) + 'px';
        logoImg.style.height = Math.round(h * factor) + 'px';
        logoImg.style.objectFit = 'contain';
        applyLogoTransform();
        constrainLogo();
    }

    // ---------- Units ----------
    const UNIT_FACTORS = { cm: 1, mm: 0.1, inch: 2.54, ft: 30.48 };
    function unitFactor() { return UNIT_FACTORS[currentUnit] || 1; }
    function roundNice(v) { return Math.round(v * 100) / 100; }
    function getWidthCm() { return roundNice((parseFloat(widthInput && widthInput.value) || 0) * unitFactor()); }
    function getHeightCm() { return roundNice((parseFloat(letterHeightInput && letterHeightInput.value) || 0) * unitFactor()); }
    function formatDim(cm) { return roundNice(cm / unitFactor()) + ' ' + currentUnit; }

    function refreshUnitLabels() {
        root.querySelectorAll('.sign3d-configurator__measure-unit').forEach((el) => { el.textContent = currentUnit; });
        [widthInput, letterHeightInput].forEach((input) => {
            if (input) input.step = currentUnit === 'cm' ? '0.5' : 'any';
        });
    }

    // Switching unit keeps the SAME physical size: values in the inputs are converted.
    function setUnit(unit) {
        const next = UNIT_FACTORS[unit] ? unit : 'cm';
        if (next === currentUnit) {
            refreshUnitLabels();
            return;
        }
        const wCm = getWidthCm();
        const hCm = getHeightCm();
        currentUnit = next;
        if (widthInput && widthInput.value !== '') widthInput.value = roundNice(wCm / unitFactor());
        if (letterHeightInput && letterHeightInput.value !== '') letterHeightInput.value = roundNice(hCm / unitFactor());
        refreshUnitLabels();
        updatePreviewScale();
        calculateTotal();
        syncSliderFromWidth();
    }

    // ---------- Logo: move / resize / stay inside the preview ----------
    function applyLogoTransform() {
        if (!logoImg) return;
        logoImg.style.transform = 'translate(' + logoOffsetX + 'px, ' + logoOffsetY + 'px) scale(' + logoScale + ')';
    }

    function getLogoBounds() {
        const pr = previewBox.getBoundingClientRect();
        let right = pr.right - 8;
        const panel = root.querySelector('.sign3d-configurator__panel');
        if (panel) {
            const q = panel.getBoundingClientRect();
            if (q.top < pr.bottom && q.bottom > pr.top && q.left > pr.left + 120) right = Math.min(right, q.left - 8);
        }
        return { left: pr.left + 8, top: pr.top + 8, right, bottom: pr.bottom - 100 };
    }

    function constrainLogo() {
        if (!logoImg || !previewBox || logoImg.style.display === 'none') return;
        const b = getLogoBounds();
        let r = logoImg.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const fit = Math.min(1, (b.right - b.left) / r.width, (b.bottom - b.top) / r.height);
        if (fit < 1) {
            logoScale = Math.max(0.2, logoScale * fit);
            applyLogoTransform();
            r = logoImg.getBoundingClientRect();
        }
        let dx = 0;
        let dy = 0;
        if (r.left < b.left) dx = b.left - r.left; else if (r.right > b.right) dx = b.right - r.right;
        if (r.top < b.top) dy = b.top - r.top; else if (r.bottom > b.bottom) dy = b.bottom - r.bottom;
        if (dx || dy) {
            logoOffsetX += dx;
            logoOffsetY += dy;
            applyLogoTransform();
        }
    }

    function selectLogo() {
        hideSelectionBox();
        logoSelected = true;
        showSelectionBoxAround(logoImg);
    }

    function attachLogoInteraction(img) {
        let startX = 0;
        let startY = 0;
        let startOffX = 0;
        let startOffY = 0;
        let moved = false;

        img.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            img.setPointerCapture(event.pointerId);
            moved = false;
            startX = event.clientX;
            startY = event.clientY;
            startOffX = logoOffsetX;
            startOffY = logoOffsetY;
            selectLogo();
        });

        img.addEventListener('pointermove', (event) => {
            if (!img.hasPointerCapture(event.pointerId)) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
            logoOffsetX = startOffX + dx;
            logoOffsetY = startOffY + dy;
            applyLogoTransform();
            constrainLogo();
            if (logoSelected) showSelectionBoxAround(img);
            updateDimensionLines();
        });

        img.addEventListener('pointerup', (event) => {
            if (img.hasPointerCapture(event.pointerId)) img.releasePointerCapture(event.pointerId);
            if (moved) pushHistory();
        });
    }

    window.addEventListener('resize', () => updatePreviewScale());

    function showLogoPreview(src) {
        ensureLogoImgElement();
        if (!logoImg) return;
        logoImg.src = src;
        logoPreviewSrc = src;
        logoImg.style.display = hasLogo() ? 'block' : 'none';
        updatePreviewScale();
        updateDepthVisual();
        updateDimensionLines();
    }

    function setMode(mode) {
        currentMode = mode;
        const showText = mode !== 'upload';
        const showLogo = mode !== 'text';

        modeButtons.forEach((btn) => btn.classList.toggle('is-selected', btn.dataset.modeBtn === mode));
        modePanels.forEach((panel) => {
            const key = panel.dataset.modePanel;
            panel.hidden = !((key === 'text' && showText) || (key === 'upload' && showLogo));
        });

        if (previewInner) previewInner.classList.toggle('mode-both', mode === 'both');
        if (textFlex) textFlex.style.display = showText ? '' : 'none';
        if (iconsContainer) iconsContainer.style.display = showText ? '' : 'none';
        if (logoImg) logoImg.style.display = (showLogo && logoPreviewSrc) ? 'block' : 'none';

        const letterHeightLabelEl = letterHeightInput
            ? letterHeightInput.closest('.sign3d-configurator__field')?.querySelector('.sign3d-configurator__label')
            : null;
        if (letterHeightLabelEl) {
            letterHeightLabelEl.textContent = mode === 'upload' ? '4. Overall Height' : '4. Letter / Element Height';
        }
        const uploadLabelEl = root.querySelector('[data-mode-panel="upload"] .sign3d-configurator__label');
        if (uploadLabelEl) {
            uploadLabelEl.textContent = (mode === 'both' ? '2' : '1') + '. Upload Your Logo / Design';
        }

        renderLetters();
        hideSelectionBox();
        updatePreviewScale();
        calculateTotal();
        updateDimensionLines();
    }

    function setUploadStatus(text) {
        if (uploadFilenameEl) uploadFilenameEl.textContent = text;
    }

    async function handleLogoUpload(file) {
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) {
            setUploadStatus('File is larger than 20MB — please choose a smaller file.');
            return;
        }

        logoFileName = file.name;
        logoOffsetX = 0;
        logoOffsetY = 0;
        logoScale = 1;
        uploadedLogoUrl = null;
        if (logoLocalObjectUrl) {
            URL.revokeObjectURL(logoLocalObjectUrl);
            logoLocalObjectUrl = null;
        }

        // Instant preview from the local file — no waiting for the server.
        if ((file.type || '').indexOf('image/') === 0) {
            logoLocalObjectUrl = URL.createObjectURL(file);
            showLogoPreview(logoLocalObjectUrl);
        } else {
            logoPreviewSrc = null;
            if (logoImg) logoImg.style.display = 'none';
        }

        setUploadStatus('Uploading "' + file.name + '"...');

        const task = (async () => {
            const prepared = await downscaleImageForUpload(file);
            const formData = new FormData();
            formData.append('file', prepared);
            const response = await fetch('/apps/neon-pricing', { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Upload failed with status ' + response.status);
            const data = await response.json();
            if (data.error || !data.fileUrl) throw new Error(data.error || 'No file URL returned');
            return data.fileUrl;
        })();
        logoUploadPromise = task;

        try {
            const url = await task;
            if (logoUploadPromise !== task) return; // a newer file replaced this one
            uploadedLogoUrl = url;
            if (!logoPreviewSrc) showLogoPreview(url);
            setUploadStatus('Uploaded: ' + file.name);
        } catch (err) {
            if (logoUploadPromise !== task) return;
            console.error('3D Sign Configurator: logo upload failed.', err);
            setUploadStatus('Upload failed — please try again.');
        } finally {
            if (logoUploadPromise === task) logoUploadPromise = null;
        }
    }

    function renderBreakdown(lines) {
        if (!breakdownRows) return;
        breakdownRows.innerHTML = '';
        lines.forEach((line) => {
            const row = document.createElement('div');
            row.className = 'sign3d-configurator__breakdown-row';
            const labelSpan = document.createElement('span');
            labelSpan.textContent = line.label + (line.note ? ' ' + line.note : '');
            const valueSpan = document.createElement('span');
            valueSpan.textContent = line.included ? 'Included' : ('+$' + line.value.toFixed(2));
            if (line.included) valueSpan.classList.add('is-included');
            row.appendChild(labelSpan);
            row.appendChild(valueSpan);
            breakdownRows.appendChild(row);
        });
    }

    function populateReviewSummary() {
        if (!reviewSummaryEl || !lastReviewData) return;
        const d = lastReviewData;
        const rows = [
            ['Design Source', designSourceLabel()],
            ['Overall Width', formatDim(d.widthCm)],
            [d.mode === 'upload' ? 'Overall Height' : 'Letter Height', formatDim(d.letterHeightCm)],
        ];
        if (d.hasText && d.typedText) rows.push(['Wording', escapeHtml(d.typedText)]);
        if (d.hasText) rows.push(['Letters/Characters', String(d.letterCount)]);
        if (d.hasText && d.symbolLabels.length) rows.push(['Symbols', escapeHtml(d.symbolLabels.join(', ')) + ' (' + d.symbolPosition + ')']);
        if (d.hasLogo) rows.push(['Logo File', escapeHtml(d.logoName || 'Uploaded')]);
        rows.push(['Depth/Thickness', d.depthLabel]);
        rows.push(['Lighting', d.illuminationLabel]);
        rows.push(['Colour', d.colourName]);
        rows.push(['Material', d.materialLabel]);
        rows.push(['Finish', d.finishLabel]);
        rows.push(['Mounting', d.mountingLabel]);
        if (d.addonLabels.length) rows.push(['Add-ons', d.addonLabels.join(', ')]);
        rows.push(['Construction', d.isOutdoor ? 'Outdoor' : 'Indoor']);
        rows.push(['Total Price', '$' + d.total.toFixed(2)]);

        reviewSummaryEl.innerHTML = rows.map((r) =>
            '<div class="sign3d-configurator__review-row"><span>' + r[0] + '</span><strong>' + r[1] + '</strong></div>'
        ).join('');
    }

    function openReviewModal() {
        calculateTotal();
        populateReviewSummary();
        if (reviewModal) reviewModal.hidden = false;
    }

    function closeReviewModal() {
        if (reviewModal) reviewModal.hidden = true;
    }
    // ---- END NEW state/helpers ----

    let historyStack = [];
    let historyIndex = -1;
    let groupOffsetX = 0;
    let groupOffsetY = 0;
    let letterOffsets = [];
    let letterScales = [];
    let groupScale = 1;
    let baseFontSize = 44;
    let selectedLetterIndex = null;

    let selectedColourHex = swatches.length ? swatches[0].dataset.colourHex : '#ffffff';
    let selectedColourPrice = swatches.length ? parseFloat(swatches[0].dataset.colourPrice) || 0 : 0;
    let currentTotal = 0;

    function applyLetterTransform(span, i) {
        const off = letterOffsets[i] || { x: 0, y: 0 };
        const scale = letterScales[i] || 1;
        span.style.transform = 'translate(' + (groupOffsetX + off.x) + 'px, ' + (groupOffsetY + off.y) + 'px) scale(' + scale + ')';
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
                const startScale = logoSelected ? logoScale : (selectedLetterIndex !== null ? (letterScales[selectedLetterIndex] || 1) : groupScale);

                const onMove = (moveEvent) => {
                    const dist = Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY) || 1;
                    const factor = dist / startDist;
                    const newScale = Math.min(3, Math.max(0.3, startScale * factor));
                    resizeMoved = true;

                    if (logoSelected) {
                        logoScale = newScale;
                        applyLogoTransform();
                        constrainLogo();
                        showSelectionBoxAround(logoImg);
                        updateDimensionLines();
                    } else if (selectedLetterIndex !== null) {
                        letterScales[selectedLetterIndex] = newScale;
                        const span = textFlex.querySelector('[data-letter-index="' + selectedLetterIndex + '"]');
                        applyLetterTransform(span, selectedLetterIndex);
                        showSelectionBoxAround(span);
                    } else {
                        groupScale = newScale;
                        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';
                        showSelectionBoxAround(textFlex);
                    }
                };

                let resizeMoved = false;

                const onUp = (upEvent) => {
                    handle.releasePointerCapture(upEvent.pointerId);
                    handle.removeEventListener('pointermove', onMove);
                    handle.removeEventListener('pointerup', onUp);
                    if (resizeMoved) pushHistory();
                };

                handle.addEventListener('pointermove', onMove);
                handle.addEventListener('pointerup', onUp);
            });
        });
    }

    function refreshAllLetterTransforms() {
        if (!textFlex) return;
        textFlex.querySelectorAll('.sign3d-configurator__letter').forEach((span) => {
            applyLetterTransform(span, Number(span.dataset.letterIndex));
        });
    }

    function hideSelectionBox() {
        if (selectionBox) selectionBox.hidden = true;
        if (selectAllBtn) selectAllBtn.hidden = true;
        logoSelected = false;
        if (textFlex) {
            textFlex.querySelectorAll('.sign3d-configurator__letter').forEach((s) => s.classList.remove('is-selected'));
        }
    }

    function showSelectionBoxAround(el) {
        if (!selectionBox || !previewStage || !el) return;
        if (!measurementsVisible) return;
        const stageRect = previewStage.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        selectionBox.style.left = (elRect.left - previewInner.getBoundingClientRect().left - 6) + 'px';
        selectionBox.style.top = (elRect.top - previewInner.getBoundingClientRect().top - 6) + 'px';
        selectionBox.style.width = (elRect.width + 12) + 'px';
        selectionBox.style.height = (elRect.height + 12) + 'px';
        selectionBox.hidden = false;
    }

    function selectLetter(index) {
        selectedLetterIndex = index;
        textFlex.querySelectorAll('.sign3d-configurator__letter').forEach((s) => {
            s.classList.toggle('is-selected', Number(s.dataset.letterIndex) === index);
        });
        const target = textFlex.querySelector('[data-letter-index="' + index + '"]');
        showSelectionBoxAround(target);
        if (selectAllBtn) selectAllBtn.hidden = false;
    }

    function selectGroup() {
        selectedLetterIndex = null;
        hideSelectionBox();
        showSelectionBoxAround(textFlex);
    }

    function attachLetterDrag(span, i) {
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

        span.addEventListener('pointermove', (event) => {
            if (!span.hasPointerCapture(event.pointerId)) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;

            if (draggingWholeGroup) {
                groupOffsetX = startOffX + dx;
                groupOffsetY = startOffY + dy;
                refreshAllLetterTransforms();
                showSelectionBoxAround(textFlex);
            } else {
                letterOffsets[i] = { x: startOffX + dx, y: startOffY + dy };
                applyLetterTransform(span, i);
                showSelectionBoxAround(span);
            }
        });

        span.addEventListener('pointerup', (event) => {
            if (span.hasPointerCapture(event.pointerId)) span.releasePointerCapture(event.pointerId);
            if (!moved) {
                if (selectedLetterIndex === i) {
                    selectGroup();
                } else {
                    selectLetter(i);
                }
            } else {
                pushHistory();
            }
        });
    }

    function rebuildLetterDOM(value) {
        if (!textFlex) return;
        textFlex.innerHTML = '';
        value.split('').forEach((ch, i) => {
            const span = document.createElement('span');
            span.className = 'sign3d-configurator__letter';
            span.textContent = ch === ' ' ? '\u00A0' : ch;
            span.dataset.letterIndex = i;
            applyLetterTransform(span, i);
            attachLetterDrag(span, i);
            textFlex.appendChild(span);
        });

        hideSelectionBox();
    }

    function renderLetters() {
        if (!textFlex) return;
        const value = textInput.value.trim() || (currentMode === 'both' ? '' : 'Your Brand');

        if (letterOffsets.length !== value.length) {
            letterOffsets = value.split('').map(() => ({ x: 0, y: 0 }));
            letterScales = value.split('').map(() => 1);
            selectedLetterIndex = null;
        }

        rebuildLetterDOM(value);
    }

    // ---- Undo / Redo + Reset (Colour, Scale & Size, Font) ----
    function captureState() {
        const selectedAlignBtn = root.querySelector('[data-align-btn].is-selected');
        return {
            text: textInput.value,
            font: fontSelect ? fontSelect.value : '',
            colourHex: selectedColourHex,
            colourPrice: selectedColourPrice,
            colourName: colourNameLabel ? colourNameLabel.textContent : '',
            symbols: selectedSymbols.map((s) => ({ url: s.url, label: s.label })),
            align: selectedAlignBtn ? selectedAlignBtn.dataset.align : 'center',
            letterOffsets: letterOffsets.map((o) => ({ x: o.x, y: o.y })),
            letterScales: letterScales.slice(),
            groupOffsetX,
            logoOffsetX, logoOffsetY, logoScale,
            groupOffsetY,
            groupScale
        };
    }

    function pushHistory() {
        const snapshot = captureState();
        if (historyIndex >= 0 && JSON.stringify(historyStack[historyIndex]) === JSON.stringify(snapshot)) return;
        historyStack = historyStack.slice(0, historyIndex + 1);
        historyStack.push(snapshot);
        historyIndex = historyStack.length - 1;
        updateUndoRedoButtons();
    }

    function applyState(state) {
        textInput.value = state.text;

        letterOffsets = state.letterOffsets.map((o) => ({ x: o.x, y: o.y }));
        letterScales = state.letterScales.slice();
        groupOffsetX = state.groupOffsetX;
        groupOffsetY = state.groupOffsetY;
        groupScale = state.groupScale;
        if (state.logoScale !== undefined) {
            logoOffsetX = state.logoOffsetX;
            logoOffsetY = state.logoOffsetY;
            logoScale = state.logoScale;
            applyLogoTransform();
        }

        if (fontSelect && state.font) {
            fontSelect.value = state.font;
            updatePreviewFont();
        }

        selectedColourHex = state.colourHex;
        selectedColourPrice = state.colourPrice;
        swatches.forEach((swatch) => {
            swatch.classList.toggle('is-selected', swatch.dataset.colourHex === state.colourHex);
        });
        if (colourNameLabel) colourNameLabel.textContent = state.colourName;
        updatePreviewColour();

        selectedSymbols = state.symbols.map((s) => ({ url: s.url, label: s.label }));
        symbolButtons.forEach((btn) => {
            btn.classList.toggle('is-selected', selectedSymbols.some((s) => s.url === btn.dataset.symbolUrl));
        });
        renderIcons();

        alignButtons.forEach((btn) => {
            btn.classList.toggle('is-selected', btn.dataset.align === state.align);
        });
        if (textFlex) textFlex.style.justifyContent = ALIGN_MAP[state.align] || 'center';

        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';
        const value = state.text.trim() || (currentMode === 'both' ? '' : 'Your Brand');
        rebuildLetterDOM(value);

        calculateTotal();
    }

    function updateUndoRedoButtons() {
        if (undoBtn) undoBtn.disabled = historyIndex <= 0;
        if (redoBtn) redoBtn.disabled = historyIndex >= historyStack.length - 1;
    }

    function undo() {
        if (historyIndex <= 0) return;
        historyIndex -= 1;
        applyState(historyStack[historyIndex]);
        updateUndoRedoButtons();
    }

    function redo() {
        if (historyIndex >= historyStack.length - 1) return;
        historyIndex += 1;
        applyState(historyStack[historyIndex]);
        updateUndoRedoButtons();
    }

    function resetColourToDefault() {
        if (!swatches.length) return;
        const defaultSwatch = swatches[0];
        swatches.forEach((s) => s.classList.remove('is-selected'));
        defaultSwatch.classList.add('is-selected');
        selectedColourHex = defaultSwatch.dataset.colourHex;
        selectedColourPrice = parseFloat(defaultSwatch.dataset.colourPrice) || 0;
        if (colourNameLabel) colourNameLabel.textContent = defaultSwatch.dataset.colourName;
        updatePreviewColour();
        calculateTotal();
        pushHistory();
    }

    function resetFontToDefault() {
        if (!fontSelect || !fontSelect.options.length) return;
        fontSelect.selectedIndex = 0;
        updatePreviewFont();
        pushHistory();
    }

    function resetScaleAndSizeToDefault() {
        groupOffsetX = 0;
        groupOffsetY = 0;
        groupScale = 1;
        letterOffsets = letterOffsets.map(() => ({ x: 0, y: 0 }));
        letterScales = letterScales.map(() => 1);
        logoOffsetX = 0;
        logoOffsetY = 0;
        logoScale = 1;
        applyLogoTransform();
        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';
        refreshAllLetterTransforms();
        selectGroup();
        pushHistory();
    }

    function updatePreviewText() {
        renderLetters();
        updateDimensionLines();
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
        if (fontSelect && textFlex) textFlex.style.fontFamily = fontSelect.value;
        updateDimensionLines();
    }

    function updatePreviewScale() {
        const widthCm = getWidthCm() || 100;
        const heightCm = getHeightCm() || 25;

        // Font size now driven directly by the actual Letter Height the customer enters —
        // more accurate than the old width-based guess, and reacts live as they type.
        baseFontSize = Math.min(160, Math.max(16, heightCm * 2.2));
        if (textFlex) textFlex.style.fontSize = (baseFontSize * groupScale) + 'px';

        if (widthLabel) widthLabel.textContent = formatDim(widthCm);
        if (oversizedNoticeEl) oversizedNoticeEl.hidden = widthCm <= 200;
        if (heightLabel) heightLabel.textContent = formatDim(heightCm);

        updateLogoPreviewSize(widthCm, heightCm);
        updateDimensionLines();
    }

    // Keeps the Width/Height dimension lines hugging the ACTUAL rendered sign content
    // (letters/icons, or the uploaded logo) — NOT previewInner, which is deliberately
    // width:100% in the CSS and therefore always reports the full stage width no matter
    // how short the customer's text is. Measuring the real letter/icon/logo elements and
    // taking the union of their boxes gives the TRUE visual width/height, so the line
    // grows/shrinks exactly with the text — matches the LED Neon configurator's behaviour.
    function getSignContentRect() {
        let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
        const candidates = [];
        if (hasLogo() && logoImg && logoImg.style.display !== 'none' && logoPreviewSrc) candidates.push(logoImg);
        if (hasText()) {
            if (textFlex) candidates.push(...Array.from(textFlex.children));
            if (iconsContainer) candidates.push(...Array.from(iconsContainer.children));
        }
        candidates.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) return;
            minLeft = Math.min(minLeft, r.left);
            minTop = Math.min(minTop, r.top);
            maxRight = Math.max(maxRight, r.right);
            maxBottom = Math.max(maxBottom, r.bottom);
        });
        if (minLeft === Infinity) return null;
        return { left: minLeft, top: minTop, right: maxRight, bottom: maxBottom, width: maxRight - minLeft, height: maxBottom - minTop };
    }

    function updateDimensionLines() {
        if (!previewStage) return;
        const stageRect = previewStage.getBoundingClientRect();
        const contentRect = getSignContentRect();
        if (!contentRect || !contentRect.width || !contentRect.height) return;

        if (widthDimLine) {
            widthDimLine.style.left = (contentRect.left - stageRect.left) + 'px';
            widthDimLine.style.width = contentRect.width + 'px';
            widthDimLine.style.top = (contentRect.bottom - stageRect.top + 14) + 'px';
        }
        if (heightDimLine) {
            heightDimLine.style.top = (contentRect.top - stageRect.top) + 'px';
            heightDimLine.style.height = contentRect.height + 'px';
            heightDimLine.style.left = (contentRect.right - stageRect.left + 14) + 'px';
        }
    }

    let dimResizeObserver = null;
    function setupDimensionObserver() {
        if (!previewInner || typeof ResizeObserver === 'undefined') return;
        dimResizeObserver = new ResizeObserver(() => updateDimensionLines());
        dimResizeObserver.observe(previewInner);
        window.addEventListener('resize', updateDimensionLines);
    }

    let measurementsVisible = true;
    let ledOn = true;
    const hideMeasurementsToggle = root.querySelector('[data-hide-measurements-toggle]');

    if (previewInner) {
        previewInner.addEventListener('pointerdown', (event) => {
            if (!hasText() && event.target === previewInner) hideSelectionBox();
            if (hasText() && (event.target === previewInner || event.target === textFlex)) {
                selectGroup();
            }
        });
    }

    document.addEventListener('pointerdown', (event) => {
        if (previewInner && !previewInner.contains(event.target)) {
            hideSelectionBox();
        }
    });

    if (hideMeasurementsToggle) {
        hideMeasurementsToggle.addEventListener('change', () => {
            measurementsVisible = hideMeasurementsToggle.checked;
            if (previewStage) previewStage.classList.toggle('no-measurements', !measurementsVisible);
            if (measurementsLabel) measurementsLabel.textContent = measurementsVisible ? 'Measurements On' : 'Measurements Off';
            if (!measurementsVisible) hideSelectionBox();
        });
    }

    function updateLedState() {
        if (!previewInnerForLed) return;
        previewInnerForLed.classList.toggle('led-on', ledOn);
        previewInnerForLed.classList.toggle('led-off', !ledOn);
    }

    function updateSymbolPositionClass() {
        if (!previewInner) return;
        ['symbols-left', 'symbols-right', 'symbols-top', 'symbols-bottom'].forEach((cls) => previewInner.classList.remove(cls));
        previewInner.classList.add('symbols-' + currentSymbolPosition);
    }

    symbolPositionRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            currentSymbolPosition = radio.value;
            updateSymbolPositionClass();
        });
    });

    if (ledToggle) {
        ledToggle.addEventListener('change', () => {
            ledOn = ledToggle.checked;
            updateLedState();
            if (ledLabel) ledLabel.textContent = ledOn ? 'LED On' : 'LED Off';
        });
    }

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => selectGroup());
    }

    attachResizeHandles();

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
        const config = pricingConfig || { widthTiers: [], letterHeightTiers: [], letterCountTiers: [], depthTiers: [], settings: {} };
        const settings = config.settings || {};

        const widthCm = getWidthCm();
        const letterHeightCm = getHeightCm();
        const isOutdoor = !!(indoorOutdoorRadios && Array.from(indoorOutdoorRadios).find((r) => r.checked && r.value === 'outdoor'));

        const widthTier = findAscendingTier(config.widthTiers, 'width', widthCm);
        const basePrice = widthTier ? Number(widthTier.price) || 0 : 0;
        const baseLabel = widthTier ? widthTier.label : 'Base price';

        const letterHeightTier = findAscendingTier(config.letterHeightTiers, 'height', letterHeightCm);
        const letterHeightAdjustment = letterHeightTier ? Number(letterHeightTier.adjustment) || 0 : 0;

        let letterCountSurcharge = 0;
        let letterCountLabel = '';
        let letterCount = 0;
        if (hasText()) {
            letterCount = (textInput.value || '').replace(/\s/g, '').length;
            const includedLetters = Number(settings.includedLetters) || 20;
            if (letterCount > includedLetters) {
                const countTier = findLetterCountTier(config.letterCountTiers, letterCount);
                letterCountSurcharge = countTier ? Number(countTier.surcharge) || 0 : 0;
                letterCountLabel = countTier ? countTier.label : '';
            }
        }

        const depthOption = depthSelect ? depthSelect.options[depthSelect.selectedIndex] : null;
        const depthSurcharge = parseFloat(depthOption?.dataset.price) || 0;
        const depthLabel = depthOption?.dataset.label || (depthOption ? depthOption.textContent.trim() : 'Standard');

        let illuminationPrice = 0;
        let illuminationLabel = '';
        if (illuminationSelect) {
            const opt = illuminationSelect.options[illuminationSelect.selectedIndex];
            illuminationPrice = parseFloat(opt?.dataset.price) || 0;
            illuminationLabel = opt ? opt.textContent.trim() : '';
        }

        let materialPrice = 0;
        let materialLabel = '';
        if (materialSelect) {
            const opt = materialSelect.options[materialSelect.selectedIndex];
            materialPrice = parseFloat(opt?.dataset.price) || 0;
            materialLabel = opt ? opt.textContent.trim() : '';
        }

        let finishPrice = 0;
        let finishLabel = '';
        if (finishSelect) {
            const opt = finishSelect.options[finishSelect.selectedIndex];
            finishPrice = parseFloat(opt?.dataset.price) || 0;
            finishLabel = opt ? opt.textContent.trim() : '';
        }

        let mountingPrice = 0;
        let mountingLabel = '';
        if (mountingSelect) {
            const opt = mountingSelect.options[mountingSelect.selectedIndex];
            mountingPrice = parseFloat(opt?.dataset.price) || 0;
            mountingLabel = opt ? opt.textContent.trim() : '';
        }

        // Backing panel — calculated from real width x height area, not one flat price
        // for every size, per the client's explicit instruction. Skipped only when the
        // selected Mounting option is literally "No Backing Panel".
        let panelSurcharge = 0;
        const panelRate = Number(settings.panelRate) || 0;
        if (mountingLabel && mountingLabel.toLowerCase() !== 'no backing panel' && widthCm > 0 && letterHeightCm > 0) {
            const areaSqm = (widthCm / 100) * (letterHeightCm / 100);
            panelSurcharge = Math.round(areaSqm * panelRate * 100) / 100;
        }

        let addonsTotal = 0;
        const addonLabels = [];
        addonCheckboxes.forEach((checkbox) => {
            if (checkbox.checked) {
                addonsTotal += parseFloat(checkbox.dataset.price) || 0;
                const lbl = checkbox.closest('label')?.querySelector('span')?.textContent.trim();
                if (lbl) addonLabels.push(lbl);
            }
        });

        const subtotalBeforeOutdoor = basePrice + letterHeightAdjustment + letterCountSurcharge + depthSurcharge
            + illuminationPrice + materialPrice + finishPrice + mountingPrice + panelSurcharge + addonsTotal;

        // Outdoor = +15% of the BASE width price only (matches the client's worked examples
        // exactly: $999 -> $1199, $1599 -> $1839, $2199 -> $2529), with a $ minimum floor.
        let outdoorSurcharge = 0;
        if (isOutdoor) {
            const pct = Number(settings.outdoorPercent) || 0;
            const min = Number(settings.outdoorMin) || 0;
            outdoorSurcharge = Math.max(basePrice * (pct / 100), min);
            outdoorSurcharge = Math.round(outdoorSurcharge * 100) / 100;
        }

        const total = subtotalBeforeOutdoor + outdoorSurcharge;

        // Colour is intentionally excluded from pricing entirely — customer's free choice,
        // per the client's explicit "colour never changes price" instruction.
        const lines = [];
        lines.push({ label: baseLabel, value: basePrice, included: false });
        lines.push({ label: 'Letter height (' + formatDim(letterHeightCm) + ')', value: letterHeightAdjustment, included: letterHeightAdjustment === 0 });
        if (hasText()) {
            lines.push({
                label: letterCountSurcharge > 0 ? ('Letters: ' + letterCount + ' (' + letterCountLabel + ')') : ('Letters: ' + letterCount + ' (included)'),
                value: letterCountSurcharge,
                included: letterCountSurcharge === 0
            });
        }
        lines.push({ label: 'Depth: ' + depthLabel, value: depthSurcharge, included: depthSurcharge === 0 });
        lines.push({ label: 'Lighting: ' + illuminationLabel, value: illuminationPrice, included: illuminationPrice === 0 });
        lines.push({ label: 'Material: ' + materialLabel, value: materialPrice, included: materialPrice === 0 });
        lines.push({ label: 'Finish: ' + finishLabel, value: finishPrice, included: finishPrice === 0 });
        lines.push({ label: 'Mounting: ' + mountingLabel, value: mountingPrice, included: mountingPrice === 0 });
        if (panelSurcharge > 0) lines.push({ label: 'Backing panel (by area)', value: panelSurcharge, included: false });
        addonLabels.forEach((lbl) => lines.push({ label: lbl, value: 0, included: true }));
        lines.push({ label: 'Colour', value: 0, included: true, note: '(no surcharge)' });
        lines.push({ label: isOutdoor ? 'Outdoor construction' : 'Indoor', value: outdoorSurcharge, included: !isOutdoor });
        lines.push({ label: 'Standard delivery (Australia-wide)', value: 0, included: true });

        renderBreakdown(lines);

        totalPriceEl.textContent = '$' + total.toFixed(2);
        currentTotal = total;

        lastReviewData = {
            mode: currentMode, hasText: hasText(), hasLogo: hasLogo(), typedText: textInput.value.trim(),
            symbolLabels: selectedSymbols.map((s) => s.label), symbolPosition: currentSymbolPosition,
            logoName: logoFileName, widthCm, letterHeightCm, letterCount, depthLabel, illuminationLabel,
            materialLabel, finishLabel, mountingLabel, isOutdoor, addonLabels,
            colourName: colourNameLabel ? colourNameLabel.textContent.trim() : '', total
        };
    }

    let textHistoryTimer = null;
    textInput.addEventListener('input', () => {
        updatePreviewText();
        clearTimeout(textHistoryTimer);
        textHistoryTimer = setTimeout(() => {
            pushHistory();
        }, 600);
    });

    if (fontSelect) {
        fontSelect.addEventListener('change', () => {
            updatePreviewFont();
            pushHistory();
        });
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
            pushHistory();
        });
    });

    function applyWallpaperBackground() {
        if (!previewBox) return;
        if (selectedBgUrl && !wallpaperHidden) {
            previewBox.style.backgroundImage = "url('" + selectedBgUrl + "')";
        } else {
            previewBox.style.backgroundImage = '';
        }
    }

    bgThumbs.forEach((thumb) => {
        thumb.addEventListener('click', () => {
            bgThumbs.forEach((t) => t.classList.remove('is-selected'));
            thumb.classList.add('is-selected');
            selectedBgUrl = thumb.dataset.bgUrl;
            applyWallpaperBackground();
        });
    });

    if (wallpaperToggle) {
        wallpaperToggle.addEventListener('change', () => {
            wallpaperHidden = !wallpaperToggle.checked;
            if (wallpaperToggleLabel) wallpaperToggleLabel.textContent = wallpaperToggle.checked ? 'Wallpaper On' : 'Wallpaper Off';
            applyWallpaperBackground();
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
            pushHistory();
        });
    });

    const ILLUM_EFFECT_CLASSES = ['effect-front_lit', 'effect-backlit', 'effect-front_back_lit', 'effect-fully_illuminated'];

    function updateIlluminationEffect() {
        if (!previewInnerForLed || !illuminationSelect) return;
        ILLUM_EFFECT_CLASSES.forEach((cls) => previewInnerForLed.classList.remove(cls));
        const selectedOption = illuminationSelect.options[illuminationSelect.selectedIndex];
        const effectKey = selectedOption?.dataset.effectKey || 'front_lit';
        previewInnerForLed.classList.add('effect-' + effectKey);
    }

    [illuminationSelect, sizeSelect, materialSelect, thicknessSelect, finishSelect, mountingSelect].forEach((select) => {
        select.addEventListener('change', calculateTotal);
    });

    if (illuminationSelect) {
        illuminationSelect.addEventListener('change', updateIlluminationEffect);
    }

    sizeSelect.addEventListener('change', updatePreviewScale);

    const ALIGN_MAP = { left: 'flex-start', center: 'center', right: 'flex-end' };
    alignButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            alignButtons.forEach((b) => b.classList.remove('is-selected'));
            btn.classList.add('is-selected');
            if (textFlex) textFlex.style.justifyContent = ALIGN_MAP[btn.dataset.align] || 'center';
            pushHistory();
        });
    });

    addonCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', calculateTotal);
    });

    // ---- NEW: measurement / mode / upload / review event bindings ----
    modeButtons.forEach((btn) => {
        btn.addEventListener('click', () => setMode(btn.dataset.modeBtn));
    });

    if (widthInput) {
        widthInput.addEventListener('input', () => { updatePreviewScale(); calculateTotal(); syncSliderFromWidth(); });
    }
    if (letterHeightInput) {
        letterHeightInput.addEventListener('input', () => { updatePreviewScale(); calculateTotal(); });
    }
    if (depthSelect) {
        depthSelect.addEventListener('change', () => { updateDepthVisual(); calculateTotal(); });
    }
    indoorOutdoorRadios.forEach((radio) => {
        radio.addEventListener('change', calculateTotal);
    });
    if (textInput) {
        textInput.addEventListener('input', calculateTotal);
    }

    if (uploadTriggerBtn && logoUploadInput) {
        uploadTriggerBtn.addEventListener('click', () => logoUploadInput.click());
        logoUploadInput.addEventListener('change', () => {
            const file = logoUploadInput.files && logoUploadInput.files[0];
            if (file) handleLogoUpload(file);
        });
    }

    // ---- Custom Size Slider (drives Overall Width; pricing still uses the 3D width tiers) ----
    const sizeSlider = root.querySelector('[data-custom-size-slider]');
    const sliderTabsWrap = root.querySelector('[data-unit-tabs]');
    const sliderTabs = root.querySelectorAll('[data-unit-tab]');
    const sliderWidthValueEl = root.querySelector('[data-slider-width-value]');
    const sliderUnitLabelEl = root.querySelector('[data-slider-unit-label]');
    const SLIDER_UNIT_TO_CM = { cm: 1, mm: 0.1, inch: 2.54, ft: 30.48 };

    function sliderFactor() {
        return SLIDER_UNIT_TO_CM[(sizeSlider && sizeSlider.dataset.unit) || 'cm'] || 1;
    }

    function syncSliderFromWidth() {
        if (!sizeSlider) return;
        const cm = getWidthCm();
        const unit = sizeSlider.dataset.unit || 'cm';
        const val = cm / sliderFactor();
        const min = parseFloat(sizeSlider.min);
        const max = parseFloat(sizeSlider.max);
        sizeSlider.value = Math.min(max, Math.max(min, Math.round(val)));
        if (sliderWidthValueEl) sliderWidthValueEl.textContent = 'Width: ' + (Math.round(val * 10) / 10) + ' ' + unit;
        if (sliderUnitLabelEl) sliderUnitLabelEl.textContent = unit;
    }

    function applySliderValueToWidth(value) {
        // Width input is now in the slider's own unit, so the value goes in as-is.
        if (widthInput) widthInput.value = value;
        updatePreviewScale();
        calculateTotal();
        syncSliderFromWidth();
    }

    function activateUnitTab(tab) {
        sliderTabs.forEach((t) => t.classList.remove('is-selected'));
        tab.classList.add('is-selected');
        sizeSlider.min = parseFloat(tab.dataset.min) || 0;
        sizeSlider.max = parseFloat(tab.dataset.max) || 100;
        sizeSlider.dataset.unit = tab.dataset.unit || 'cm';
        setUnit(tab.dataset.unit || 'cm');
    }

    function initSizeSlider() {
        if (!sizeSlider) return;
        // Default unit is always CM. If there is no CM entry, the Sort Order default is used.
        const startTab = Array.from(sliderTabs).find((t) => t.dataset.unit === 'cm')
            || root.querySelector('[data-unit-tab].is-selected')
            || sliderTabs[0];
        if (startTab) activateUnitTab(startTab);
        else setUnit(sizeSlider.dataset.unit || 'cm');

        // Admin "Sort Order" decides the tab order (first = default).
        if (sliderTabsWrap) {
            Array.from(sliderTabsWrap.children)
                .map((el, idx) => ({ el, idx, so: Number(el.dataset.sortOrder) }))
                .map((x) => ({ ...x, so: Number.isFinite(x.so) ? x.so : 999999 }))
                .sort((a, b) => (a.so - b.so) || (a.idx - b.idx))
                .forEach((x) => sliderTabsWrap.appendChild(x.el));
        }
        syncSliderFromWidth();
    }

    if (sizeSlider) {
        sizeSlider.addEventListener('input', () => applySliderValueToWidth(parseFloat(sizeSlider.value) || 0));

        sliderTabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                sliderTabs.forEach((t) => t.classList.remove('is-selected'));
                tab.classList.add('is-selected');
                sizeSlider.min = parseFloat(tab.dataset.min) || 0;
                sizeSlider.max = parseFloat(tab.dataset.max) || 100;
                sizeSlider.dataset.unit = tab.dataset.unit || 'cm';
                setUnit(tab.dataset.unit || 'cm');
            });
        });

        const sliderDecreaseBtn = root.querySelector('[data-slider-decrease]');
        const sliderIncreaseBtn = root.querySelector('[data-slider-increase]');
        const stepSlider = (dir) => {
            const min = parseFloat(sizeSlider.min);
            const max = parseFloat(sizeSlider.max);
            const step = parseFloat(sizeSlider.step) || 1;
            const next = Math.min(max, Math.max(min, (parseFloat(sizeSlider.value) || min) + dir * step));
            sizeSlider.value = next;
            applySliderValueToWidth(next);
        };
        if (sliderDecreaseBtn) sliderDecreaseBtn.addEventListener('click', () => stepSlider(-1));
        if (sliderIncreaseBtn) sliderIncreaseBtn.addEventListener('click', () => stepSlider(1));
    }

    // ---- Drag & drop for the upload box ----
    const uploadBoxEl = root.querySelector('[data-upload-box]');
    if (uploadBoxEl) {
        ['dragenter', 'dragover'].forEach((evName) => {
            uploadBoxEl.addEventListener(evName, (e) => e.preventDefault());
        });
        uploadBoxEl.addEventListener('drop', (e) => {
            e.preventDefault();
            const dropped = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (dropped) handleLogoUpload(dropped);
        });
    }

    if (reviewBtn) reviewBtn.addEventListener('click', openReviewModal);
    if (reviewCloseBtn) reviewCloseBtn.addEventListener('click', closeReviewModal);
    if (reviewModal) {
        reviewModal.addEventListener('click', (event) => {
            if (event.target === reviewModal) closeReviewModal();
        });
    }
    if (reviewConfirmBtn) {
        reviewConfirmBtn.addEventListener('click', () => {
            closeReviewModal();
            if (addToCartBtn) addToCartBtn.click();
        });
    }
    // ---- END NEW bindings ----

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

            if (hasLogo() && logoUploadPromise) {
                addToCartBtn.disabled = true;
                setButtonLoadingText(addToCartBtn, 'Finishing logo upload...');
                try { await logoUploadPromise; } catch (e) { /* handled below */ }
            }
            if (hasLogo() && !uploadedLogoUrl) {
                addToCartBtn.disabled = false;
                addToCartBtn.textContent = 'Add to Cart';
                showTemporaryStatus(addToCartStatus, 'Please upload your logo / design (or switch to Type Wording) before adding to cart.', 6000);
                return;
            }
            addToCartBtn.disabled = true;
            setButtonLoadingText(addToCartBtn, 'Syncing price...');

            // Defensive: if Material/Finish/Mounting/Illumination have no options saved yet
            // in Admin (data not entered), don't crash the whole click — fall back to
            // "Standard" so Add to Cart still works while the developer finishes adding data.
            const getSelectedOptionText = (select, fallback) => {
                if (!select) return fallback;
                const opt = select.options[select.selectedIndex];
                return opt ? opt.textContent.trim() : fallback;
            };

            const blueprintWidthCm = getWidthCm() || '';
            const blueprintHeightCm = getHeightCm() || '';
            const isOutdoorForCart = !!(indoorOutdoorRadios && Array.from(indoorOutdoorRadios).find((r) => r.checked && r.value === 'outdoor'));
            const depthOptionForCart = depthSelect ? depthSelect.options[depthSelect.selectedIndex] : null;

            const properties = {
                'Design Source': designSourceLabel(),
                'Custom Text': hasText() ? (textInput.value.trim() || (currentMode === 'text' ? 'Your Brand' : 'N/A')) : 'N/A (logo upload)',
                'Uploaded Logo URL': hasLogo() ? (uploadedLogoUrl || 'N/A') : 'N/A',
                'Illumination Type': getSelectedOptionText(illuminationSelect, 'Standard'),
                'Overall Width': blueprintWidthCm + ' cm',
                'Overall / Letter Height': blueprintHeightCm + ' cm',
                'Depth / Thickness': depthOptionForCart ? depthOptionForCart.textContent.trim() : 'Standard',
                'Material': getSelectedOptionText(materialSelect, 'Standard'),
                'Front Colour': colourNameLabel ? colourNameLabel.textContent.trim() : 'Default',
                'Finish': getSelectedOptionText(finishSelect, 'Standard'),
                'Mounting': getSelectedOptionText(mountingSelect, 'Standard'),
                'Add-ons': selectedAddons || 'None',
                'Construction': isOutdoorForCart ? 'Outdoor' : 'Indoor',

                'Configured Total': '$' + currentTotal.toFixed(2),
                '_blueprint_width_cm': blueprintWidthCm,
                '_blueprint_height_cm': blueprintHeightCm
            };

            try {
                const productId = addToCartBtn.dataset.productId;

                if (hasText() && selectedSymbols.length) {
                    properties['Quick Symbols'] = selectedSymbols.map((s) => s.label).join(', ');
                    properties['Symbol Position'] = currentSymbolPosition.charAt(0).toUpperCase() + currentSymbolPosition.slice(1);
                }

                if (currentUnit !== 'cm') {
                    properties['Entered Size'] = 'Width ' + formatDim(getWidthCm()) + ' x Height ' + formatDim(getHeightCm());
                }
                if (getWidthCm() > 200) {
                    properties['Oversized Notice'] = 'Over 2 metres - manufactured and shipped in split sections';
                }
                if (currentMode === 'both') {
                    properties['Text Position'] = 'X: ' + Math.round(groupOffsetX) + 'px, Y: ' + Math.round(groupOffsetY) + 'px';
                    properties['Logo Position'] = 'X: ' + Math.round(logoOffsetX) + 'px, Y: ' + Math.round(logoOffsetY) + 'px, Scale: ' + logoScale.toFixed(2);
                }

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
                    document.dispatchEvent(new themeEvents.CartAddEvent({}, '3d-sign-configurator', {
                        source: 'product-form-component',
                        itemCount: 1,
                        productId,
                        sections: addResult.sections
                    }));
                } catch (themeEventError) {
                    console.warn('3D Sign Configurator: could not notify theme cart UI.', themeEventError);
                }

                document.dispatchEvent(new CustomEvent('cart:refresh'));
            } catch (error) {
                console.error('3D Sign Configurator Add to Cart error:', error);
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

    if (undoBtn) undoBtn.addEventListener('click', undo);
    if (redoBtn) redoBtn.addEventListener('click', redo);
    if (resetColourBtn) resetColourBtn.addEventListener('click', resetColourToDefault);
    if (resetScaleSizeBtn) resetScaleSizeBtn.addEventListener('click', resetScaleAndSizeToDefault);
    if (resetFontBtn) resetFontBtn.addEventListener('click', resetFontToDefault);

    ensureLogoImgElement();
    setMode('text');
    updatePreviewText();
    updatePreviewFont();
    updatePreviewColour();
    updatePreviewScale();
    updateLedState();
    updateSymbolPositionClass();
    updateIlluminationEffect();
    updateDepthVisual();
    applyWallpaperBackground();
    calculateTotal();
    pushHistory();
    updateUndoRedoButtons();
    setupDimensionObserver();
    initSizeSlider();
    updateDimensionLines();
}