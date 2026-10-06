// Shared Installation booking module for the LED Neon, UV Graphic LED and UV Print No-LED
// configurators. Each configurator keeps its own existing "Need Installation?" markup and
// logic; this module only adds on top of it:
//   1. Address autocomplete + 100km service-area check (Google, via the app proxy).
//   2. Live time-slot availability — slots held/booked by other customers are disabled.
//   3. Holding the selected slot for this customer so nobody else can take it.
//   4. prepareForCart() / afterCartAdd() hooks used by each configurator's Add to Cart.
//   5. Optional address pop-up (attach(root, { popup: true }) — used by the LED Neon
//      configurator): selecting "Yes" opens a dialog with live address suggestions and the
//      100km check; the inline field then just shows the verified address.
(function () {
    if (window.MozemoInstall) return;

    const API = '/apps/neon-pricing/installation';
    const POLL_MS = 30000;

    function newToken() {
        const rand = (window.crypto && window.crypto.randomUUID)
            ? window.crypto.randomUUID().replace(/-/g, '')
            : Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
        return 'mi' + rand.slice(0, 40);
    }

    function prettyDate(iso) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
        const d = new Date(iso + 'T00:00:00');
        return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    async function getJson(url) {
        const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    }

    async function postJson(body) {
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    }

    const UNAVAILABLE_TEXT = 'Installation unavailable at this address due to distance.';

    function attach(root, options) {
        const usePopup = !!(options && options.popup);
        const booking = root.querySelector('[data-install-booking]');
        const radios = Array.from(root.querySelectorAll('[data-install-radio]'));
        const yesRadio = radios.find((r) => r.value === 'yes');
        const noRadio = radios.find((r) => r.value === 'no');
        const dateInput = root.querySelector('[data-install-date]');
        const timeSelect = root.querySelector('[data-install-time]');
        const addressInput = root.querySelector('[data-install-address]');
        const optionsEl = root.querySelector('[data-install-options]');
        if (!booking || !yesRadio || !noRadio || !dateInput || !timeSelect || !addressInput) return null;

        let config = null;           // { radiusKm, baseAddress, holdMinutes, addressLookup }
        let configFailed = false;
        let token = newToken();
        let sessionToken = newToken();
        let addr = { eligible: null, address: '', distanceKm: null, proof: '' };
        let held = { date: '', slot: '', expiresAt: '' };
        let bookedSlots = [];
        let pollTimer = null;
        let suggestTimer = null;
        let suggestSeq = 0;

        // ---- Extra UI (built in JS to keep the Liquid files small) ----
        const addressRow = addressInput.parentElement;
        addressRow.classList.add('moz-install__address-row');
        addressInput.setAttribute('autocomplete', 'off');
        const suggestList = el('ul', 'moz-install__suggest');
        suggestList.setAttribute('role', 'listbox');
        suggestList.hidden = true;
        addressRow.appendChild(suggestList);
        const addressStatus = el('p', 'moz-install__msg');
        addressRow.appendChild(addressStatus);

        const slotRows = [dateInput.parentElement, timeSelect.parentElement];
        const slotStatus = el('p', 'moz-install__msg');
        timeSelect.parentElement.appendChild(slotStatus);

        const unavailableBox = el('div', 'moz-install__unavailable');
        unavailableBox.hidden = true;
        if (optionsEl) optionsEl.insertAdjacentElement('afterend', unavailableBox);

        function setMsg(node, text, tone) {
            node.textContent = text || '';
            node.dataset.tone = tone || '';
            node.hidden = !text;
        }

        function lookupEnabled() {
            return !config || config.addressLookup !== false;
        }

        function slotsUnlocked() {
            return !lookupEnabled() || addr.eligible === true;
        }

        function syncLock() {
            const unlocked = slotsUnlocked();
            slotRows.forEach((row) => row.classList.toggle('moz-install__locked', !unlocked));
            dateInput.disabled = !unlocked;
            timeSelect.disabled = !unlocked;
        }

        function radiusText() {
            return (config && config.radiusKm) ? config.radiusKm : 100;
        }

        // ---- Config ----
        async function loadConfig() {
            if (config || configFailed) return;
            try {
                const res = await getJson(API + '?op=config');
                if (res.ok) config = res.data;
                else configFailed = true;
            } catch (err) {
                configFailed = true;
            }
            if (config && config.addressLookup === false) {
                addressInput.placeholder = 'Enter your installation address';
            }
            syncLock();
        }

        // ---- Address autocomplete + eligibility ----
        function clearSuggestions() {
            suggestList.innerHTML = '';
            suggestList.hidden = true;
        }

        function resetEligibility() {
            if (addr.eligible !== null) releaseHold();
            addr = { eligible: null, address: '', distanceKm: null, proof: '' };
            setMsg(slotStatus, '');
            syncLock();
        }

        addressInput.addEventListener('input', () => {
            if (!lookupEnabled()) return;
            resetEligibility();
            setMsg(addressStatus, '');
            const q = addressInput.value.trim();
            clearTimeout(suggestTimer);
            if (q.length < 3) { clearSuggestions(); return; }
            suggestTimer = setTimeout(async () => {
                const seq = ++suggestSeq;
                try {
                    const res = await getJson(API + '?op=autocomplete&q=' + encodeURIComponent(q) + '&session=' + sessionToken);
                    if (seq !== suggestSeq) return;
                    renderSuggestions((res.data && res.data.suggestions) || []);
                } catch (err) {
                    clearSuggestions();
                }
            }, 250);
        });

        addressInput.addEventListener('blur', () => {
            setTimeout(() => {
                clearSuggestions();
                if (lookupEnabled() && addr.eligible === null && addressInput.value.trim().length >= 3) {
                    setMsg(addressStatus, 'Please select your address from the suggestions list.', 'warn');
                }
            }, 200);
        });

        addressInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const first = suggestList.querySelector('li');
                if (first) first.dispatchEvent(new MouseEvent('mousedown'));
            }
        });

        function renderSuggestions(items) {
            suggestList.innerHTML = '';
            if (!items.length) {
                suggestList.hidden = true;
                if (addressInput.value.trim().length >= 3) setMsg(addressStatus, 'No matching address found — please check the spelling.', 'warn');
                return;
            }
            items.forEach((item) => {
                const li = el('li', 'moz-install__suggest-item');
                li.setAttribute('role', 'option');
                li.appendChild(el('strong', '', item.main));
                if (item.secondary) li.appendChild(el('span', '', item.secondary));
                li.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    addressInput.value = item.text;
                    clearSuggestions();
                    checkAddress(item.placeId);
                });
                suggestList.appendChild(li);
            });
            suggestList.hidden = false;
        }

        async function checkAddress(placeId) {
            setMsg(addressStatus, 'Checking your address…', '');
            try {
                const res = await postJson({ op: 'check-address', placeId, session: sessionToken });
                sessionToken = newToken(); // Google session ends after a details lookup
                if (!res.ok) {
                    setMsg(addressStatus, (res.data && res.data.error) || 'We could not check this address. Please try again.', 'error');
                    return;
                }
                const d = res.data;
                addressInput.value = d.formattedAddress || addressInput.value;
                if (d.eligible) {
                    addr = { eligible: true, address: d.formattedAddress, distanceKm: d.distanceKm, proof: d.proof };
                    setMsg(addressStatus, '✓ Great — we install at this address (' + d.distanceKm + ' km from our workshop).', 'ok');
                    syncLock();
                    await refreshAvailability(true);
                } else {
                    addr = { eligible: false, address: d.formattedAddress, distanceKm: d.distanceKm, proof: '' };
                    markUnavailable(d.distanceKm, d.radiusKm);
                }
            } catch (err) {
                setMsg(addressStatus, 'We could not check this address. Please try again.', 'error');
            }
        }

        // Outside the service area: installation is switched off and disabled for this
        // customer (they can still try a different address).
        function markUnavailable(distanceKm, radiusKm) {
            releaseHold();
            unavailableBox.innerHTML = '';
            unavailableBox.appendChild(el('p', '',
                'Sorry — installation is only available within ' + (radiusKm || radiusText()) + ' km of our workshop' +
                (config && config.baseAddress ? ' (' + config.baseAddress + ')' : '') +
                '. Your address is ' + distanceKm + ' km away, so installation has been removed from this order.'));
            const retry = el('button', 'moz-install__retry', 'Use a different address');
            retry.type = 'button';
            retry.addEventListener('click', () => {
                unavailableBox.hidden = true;
                yesRadio.disabled = false;
                yesRadio.closest('label')?.classList.remove('moz-install__option-disabled');
                yesRadio.checked = true;
                yesRadio.dispatchEvent(new Event('change', { bubbles: true }));
                addressInput.value = '';
                resetEligibility();
                setMsg(addressStatus, '');
                addressInput.focus();
            });
            unavailableBox.appendChild(retry);
            unavailableBox.hidden = false;

            noRadio.checked = true;
            noRadio.dispatchEvent(new Event('change', { bubbles: true }));
            yesRadio.disabled = true;
            yesRadio.closest('label')?.classList.add('moz-install__option-disabled');
        }

        // ---- Availability + hold ----
        function applyBookedSlots() {
            Array.from(timeSelect.options).forEach((opt) => {
                if (!opt.dataset.slot) opt.dataset.slot = opt.value;
                const isBooked = bookedSlots.includes(opt.dataset.slot);
                opt.disabled = isBooked;
                opt.textContent = opt.dataset.slot + (isBooked ? ' — Booked' : '');
            });
            const current = timeSelect.options[timeSelect.selectedIndex];
            if (!current || current.disabled) {
                const firstFree = Array.from(timeSelect.options).find((o) => !o.disabled);
                if (firstFree) timeSelect.value = firstFree.value;
            }
            return Array.from(timeSelect.options).some((o) => !o.disabled);
        }

        async function refreshAvailability(thenHold) {
            if (!slotsUnlocked() || !dateInput.value) return;
            const date = dateInput.value;
            try {
                const res = await getJson(API + '?op=availability&date=' + encodeURIComponent(date) + '&token=' + token);
                if (date !== dateInput.value) return;
                if (!res.ok) {
                    bookedSlots = [];
                    applyBookedSlots();
                    setMsg(slotStatus, (res.data && res.data.error) || 'This date is not available — please choose another date.', 'error');
                    return;
                }
                bookedSlots = (res.data && res.data.bookedSlots) || [];
            } catch (err) {
                return;
            }
            const anyFree = applyBookedSlots();
            if (!anyFree) {
                releaseHold();
                setMsg(slotStatus, 'All time slots on ' + prettyDate(date) + ' are booked — please choose another date.', 'error');
                return;
            }
            const heldStillSelected = held.date === date && held.slot === timeSlotValue();
            if (thenHold || !heldStillSelected) await holdSelected();
        }

        function timeSlotValue() {
            const opt = timeSelect.options[timeSelect.selectedIndex];
            return opt ? (opt.dataset.slot || opt.value) : '';
        }

        async function holdSelected(isRetry) {
            const date = dateInput.value;
            const slot = timeSlotValue();
            if (!date || !slot || !slotsUnlocked()) return false;
            setMsg(slotStatus, 'Reserving ' + slot + '…', '');
            try {
                const res = await postJson({ op: 'hold', token, date, slot, addressProof: addr.proof, address: addressInput.value.trim() });
                if (res.ok && res.data && res.data.ok) {
                    held = { date, slot, expiresAt: res.data.expiresAt };
                    const mins = (config && config.holdMinutes) || 60;
                    setMsg(slotStatus, '✓ ' + prettyDate(date) + ' at ' + slot + ' is reserved for you for ' + mins + ' minutes — complete checkout to confirm it.', 'ok');
                    return true;
                }
                if (res.status === 409) {
                    bookedSlots = (res.data && res.data.bookedSlots) || bookedSlots.concat([slot]);
                    held = { date: '', slot: '', expiresAt: '' };
                    const anyFree = applyBookedSlots();
                    if (anyFree && !isRetry) {
                        const ok = await holdSelected(true);
                        if (ok) setMsg(slotStatus, 'Sorry, ' + slot + ' was just booked by another customer. We reserved ' + timeSlotValue() + ' for you instead — change it above if needed.', 'warn');
                        return ok;
                    }
                    setMsg(slotStatus, anyFree ? 'Sorry, that time was just booked — please choose another time.' : 'All time slots on this date are booked — please choose another date.', 'error');
                    return false;
                }
                setMsg(slotStatus, (res.data && res.data.error) || 'Could not reserve this time — please try again.', 'error');
                return false;
            } catch (err) {
                setMsg(slotStatus, 'Could not reserve this time — please check your connection.', 'error');
                return false;
            }
        }

        function releaseHold() {
            if (!held.slot) return;
            held = { date: '', slot: '', expiresAt: '' };
            postJson({ op: 'release', token }).catch(() => {});
        }

        dateInput.addEventListener('change', () => refreshAvailability(true));
        timeSelect.addEventListener('change', () => holdSelected());

        function startPolling() {
            stopPolling();
            pollTimer = setInterval(() => {
                if (document.visibilityState === 'visible' && !booking.hidden) refreshAvailability(false);
            }, POLL_MS);
        }
        function stopPolling() {
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = null;
        }
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !booking.hidden) refreshAvailability(false);
        });

        radios.forEach((radio) => {
            radio.addEventListener('change', async () => {
                if (yesRadio.checked) {
                    unavailableBox.hidden = true;
                    await loadConfig();
                    syncLock();
                    if (slotsUnlocked()) await refreshAvailability(true);
                    else if (!addressInput.value.trim()) setMsg(addressStatus, 'Enter your installation address to check availability (within ' + radiusText() + ' km).', '');
                    startPolling();
                } else {
                    stopPolling();
                    releaseHold();
                    setMsg(slotStatus, '');
                }
            });
        });

        syncLock();

        return {
            // Called by the configurator's Add to Cart before anything is added.
            async prepareForCart() {
                if (configFailed) {
                    // Booking service unreachable — keep the original behaviour.
                    return { ok: true, properties: {} };
                }
                await loadConfig();
                if (lookupEnabled() && addr.eligible !== true) {
                    return { ok: false, error: addr.eligible === false
                        ? 'Installation is not available at your address.'
                        : 'Please enter your installation address and select it from the suggestions.' };
                }
                if (!lookupEnabled() && !addressInput.value.trim()) {
                    return { ok: false, error: 'Please enter your installation address.' };
                }
                if (!dateInput.value || !timeSlotValue()) {
                    return { ok: false, error: 'Please choose an installation date and time.' };
                }
                const ok = await holdSelected();
                if (!ok) return { ok: false, error: slotStatus.textContent || 'Please choose another installation time.' };

                const properties = {
                    'Installation Date': prettyDate(held.date),
                    'Installation Time': held.slot,
                    'Installation Address': addr.address || addressInput.value.trim(),
                    '_install_date': held.date,
                    '_install_hold': token
                };
                if (addr.distanceKm !== null) {
                    properties['Installation Distance'] = addr.distanceKm + ' km';
                    properties['_install_distance_km'] = String(addr.distanceKm);
                }
                return { ok: true, properties };
            },

            // Called after a successful Add to Cart: shows the booking in the order's
            // "Additional details" too, then starts a fresh hold token for any next item.
            async afterCartAdd(properties) {
                stopPolling();
                try {
                    const routesRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
                    await fetch(routesRoot + 'cart/update.js', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({ attributes: {
                            'Installation Date': properties['Installation Date'] || '',
                            'Installation Time': properties['Installation Time'] || '',
                            'Installation Address': properties['Installation Address'] || ''
                        } })
                    });
                } catch (err) {
                    console.warn('Installation: could not save cart attributes.', err);
                }
                setMsg(slotStatus, '✓ Added to cart — your installation time is reserved. Complete checkout to confirm the booking.', 'ok');
                token = newToken();
                held = { date: '', slot: '', expiresAt: '' };
            }
        };
    }

    window.MozemoInstall = { attach };
})();
