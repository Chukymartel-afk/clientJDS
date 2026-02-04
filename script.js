/**
 * Les Jardins du Saguenay - Account Opening Form
 * Multi-Step Form with Two Different Layouts
 */

document.addEventListener('DOMContentLoaded', () => {
    // =====================================================
    // Layout Elements
    // =====================================================
    const step1Layout = document.getElementById('step1Layout');
    const step23Layout = document.getElementById('step23Layout');

    // =====================================================
    // Form Elements
    // =====================================================
    const form1 = document.getElementById('accountForm');
    const form2 = document.getElementById('accountForm2');

    // Step 1 elements
    const isOwnerCheckbox = document.getElementById('isOwnerContact');
    const contactField = document.getElementById('contactField');
    const addressInput = document.getElementById('address');
    const addressDropdown = document.getElementById('addressDropdown');
    const cityInput = document.getElementById('city');
    const postalCodeInput = document.getElementById('postalCode');

    // Step 2 elements
    const sectorCards = document.querySelectorAll('.sector-card');
    const selectedSectorInput = document.getElementById('selectedSector');
    const annualPurchaseInput = document.getElementById('annualPurchase');
    const promoCard = document.getElementById('promoCard');
    const promoMinOrder = document.getElementById('promoMinOrder');
    const phoneInput = document.getElementById('phone');

    // Progress bar elements
    const progressFill = document.getElementById('progressFill');
    const progressCircle1 = document.getElementById('progressCircle1');
    const progressCircle2 = document.getElementById('progressCircle2');
    const progressCircle3 = document.getElementById('progressCircle3');
    const progressIcon2 = document.getElementById('progressIcon2');
    const progressIcon3 = document.getElementById('progressIcon3');
    const progressLabel2 = document.getElementById('progressLabel2');
    const progressLabel3 = document.getElementById('progressLabel3');

    let currentStep = 1;

    // =====================================================
    // Layout Switching
    // =====================================================

    function showLayout(step) {
        if (step === 1) {
            step1Layout.classList.remove('hidden');
            step23Layout.classList.add('hidden');
        } else {
            step1Layout.classList.add('hidden');
            step23Layout.classList.remove('hidden');
        }
    }

    // =====================================================
    // Progress Bar Updates
    // =====================================================

    function updateProgressBar(step) {
        if (step === 2) {
            // Step 2 active
            progressFill.style.setProperty('--progress', '50%');

            // Circle 1: completed
            progressCircle1.className = 'size-12 rounded-full bg-green-500 flex items-center justify-center shadow-lg z-10';

            // Circle 2: active (orange with number)
            progressCircle2.className = 'size-12 rounded-full bg-primary flex items-center justify-center shadow-lg z-10';
            progressIcon2.outerHTML = '<span class="text-white text-xl font-bold" id="progressIcon2">2</span>';
            progressLabel2.className = 'mt-3 text-sm font-semibold text-primary';

            // Circle 3: pending
            progressCircle3.className = 'size-12 rounded-full bg-gray-200 flex items-center justify-center shadow-lg z-10';
            document.getElementById('progressIcon3').outerHTML = '<span class="text-gray-400 text-xl font-bold" id="progressIcon3">3</span>';
            progressLabel3.className = 'mt-3 text-sm font-semibold text-gray-400';

        } else if (step === 3) {
            // Step 3 active
            progressFill.style.setProperty('--progress', '100%');

            // Circle 1: completed
            progressCircle1.className = 'size-12 rounded-full bg-green-500 flex items-center justify-center shadow-lg z-10';

            // Circle 2: completed
            progressCircle2.className = 'size-12 rounded-full bg-green-500 flex items-center justify-center shadow-lg z-10';
            document.getElementById('progressIcon2').outerHTML = '<span class="material-symbols-outlined text-white text-2xl" id="progressIcon2">check</span>';
            progressLabel2.className = 'mt-3 text-sm font-semibold text-green-600';

            // Circle 3: active (orange with number)
            progressCircle3.className = 'size-12 rounded-full bg-primary flex items-center justify-center shadow-lg z-10';
            document.getElementById('progressIcon3').outerHTML = '<span class="text-white text-xl font-bold" id="progressIcon3">3</span>';
            progressLabel3.className = 'mt-3 text-sm font-semibold text-primary';
        }
    }

    // =====================================================
    // Step Navigation
    // =====================================================

    function goToStep(step) {
        // Handle success step specially
        if (step === 'success') {
            const formStepsAlt = document.querySelectorAll('.form-step-alt');
            formStepsAlt.forEach(s => s.classList.add('hidden'));
            const successStep = document.querySelector('.form-step-alt[data-step="success"]');
            if (successStep) {
                successStep.classList.remove('hidden');
            }
            // Update progress bar to show all completed
            if (progressFill) {
                progressFill.style.setProperty('--progress', '100%');
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        // Validate before moving forward (only for numeric steps)
        if (typeof step === 'number' && step > currentStep && !validateStep(currentStep)) {
            return;
        }

        currentStep = step;

        // Switch layout
        showLayout(step);

        // Update progress bar for steps 2 & 3
        if (step >= 2) {
            updateProgressBar(step);

            // Show/hide form steps in step23Layout (only for steps 2 and 3)
            const formStepsAlt = document.querySelectorAll('.form-step-alt');
            formStepsAlt.forEach(s => s.classList.add('hidden'));

            const targetStep = document.querySelector(`.form-step-alt[data-step="${step}"]`);
            if (targetStep) {
                targetStep.classList.remove('hidden');
            }
        }

        // Update summary on step 3
        if (step === 3) {
            updateSummary();
        }

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function validateStep(step) {
        let isValid = true;

        if (step === 1) {
            const companyName = document.getElementById('companyName');
            const ownerName = document.getElementById('ownerName');
            const address = document.getElementById('address');
            const city = document.getElementById('city');
            const postalCode = document.getElementById('postalCode');

            const fields = [companyName, ownerName, address, city, postalCode];

            fields.forEach(input => {
                input.classList.remove('border-red-500');
                if (!input.value.trim()) {
                    isValid = false;
                    input.classList.add('border-red-500');
                    shakeElement(input);
                }
            });

            // Check contact name if owner is not doing the opening
            if (!isOwnerCheckbox.checked) {
                const contactName = document.getElementById('contactName');
                contactName.classList.remove('border-red-500');
                if (!contactName.value.trim()) {
                    isValid = false;
                    contactName.classList.add('border-red-500');
                    shakeElement(contactName);
                }
            }
        }

        if (step === 2) {
            const requiredFields = [
                document.getElementById('annualPurchase'),
                document.getElementById('emailResponsable'),
                document.getElementById('emailFacturation'),
                document.getElementById('phone')
            ];

            requiredFields.forEach(input => {
                input.classList.remove('border-red-500');
                if (!input.value.trim()) {
                    isValid = false;
                    input.classList.add('border-red-500');
                    shakeElement(input);
                }
            });

            // Check email validity
            const emailResp = document.getElementById('emailResponsable');
            const emailFact = document.getElementById('emailFacturation');
            if (emailResp.value && !isValidEmail(emailResp.value)) {
                isValid = false;
                emailResp.classList.add('border-red-500');
            }
            if (emailFact.value && !isValidEmail(emailFact.value)) {
                isValid = false;
                emailFact.classList.add('border-red-500');
            }

            // Check sector selection
            if (!selectedSectorInput.value) {
                isValid = false;
                const sectorGrid = document.getElementById('sectorGrid2');
                shakeElement(sectorGrid);
            }
        }

        return isValid;
    }

    function shakeElement(element) {
        element.classList.add('animate-shake');
        setTimeout(() => element.classList.remove('animate-shake'), 500);
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // Add shake animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            20%, 60% { transform: translateX(-6px); }
            40%, 80% { transform: translateX(6px); }
        }
        .animate-shake {
            animation: shake 0.4s ease;
        }
    `;
    document.head.appendChild(style);

    // =====================================================
    // Button Event Listeners
    // =====================================================

    // Next buttons
    document.querySelectorAll('[data-next]').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextStep = parseInt(btn.dataset.next);
            goToStep(nextStep);
        });
    });

    // Previous buttons
    document.querySelectorAll('[data-prev]').forEach(btn => {
        btn.addEventListener('click', () => {
            const prevStep = parseInt(btn.dataset.prev);
            goToStep(prevStep);
        });
    });

    // Edit buttons - using event delegation to handle clicks on icon inside button
    document.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit]');
        if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            const editStep = parseInt(editBtn.dataset.edit);
            console.log('Edit button clicked, going to step:', editStep);
            goToStep(editStep);
        }
    });

    // =====================================================
    // Owner Toggle
    // =====================================================

    isOwnerCheckbox.addEventListener('change', () => {
        if (isOwnerCheckbox.checked) {
            contactField.classList.add('hidden');
        } else {
            contactField.classList.remove('hidden');
        }
    });

    // =====================================================
    // Address Autocomplete
    // =====================================================

    let addressTimeout;

    addressInput.addEventListener('input', () => {
        clearTimeout(addressTimeout);
        const query = addressInput.value.trim();

        if (query.length < 3) {
            addressDropdown.classList.add('hidden');
            return;
        }

        addressTimeout = setTimeout(() => fetchAddresses(query), 300);
    });

    addressInput.addEventListener('focus', () => {
        if (addressDropdown.children.length > 0) {
            addressDropdown.classList.remove('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.relative')) {
            addressDropdown.classList.add('hidden');
        }
    });

    async function fetchAddresses(query) {
        try {
            // Ajouter ", Québec" à la recherche pour prioriser les résultats au Québec
            const searchQuery = query + ', Québec, Canada';
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?` +
                `format=json&q=${encodeURIComponent(searchQuery)}&countrycodes=ca&limit=5&addressdetails=1`,
                { headers: { 'Accept-Language': 'fr' } }
            );

            const data = await response.json();
            // Filtrer pour ne garder que les adresses du Québec
            const quebecAddresses = data.filter(addr => {
                const state = addr.address?.state || addr.address?.province || '';
                return state.toLowerCase().includes('québec') || state.toLowerCase().includes('quebec') || state === 'QC';
            });
            displayAddresses(quebecAddresses);
        } catch (error) {
            console.error('Erreur de recherche d\'adresse:', error);
        }
    }

    function displayAddresses(addresses) {
        addressDropdown.innerHTML = '';

        if (addresses.length === 0) {
            addressDropdown.classList.add('hidden');
            return;
        }

        addresses.forEach(addr => {
            const item = document.createElement('div');
            item.className = 'address-item';

            const address = addr.address || {};
            const street = `${address.house_number || ''} ${address.road || ''}`.trim();
            const city = address.city || address.town || address.village || address.municipality || '';
            const postal = address.postcode || '';

            item.innerHTML = `
                <div class="font-semibold text-gray-800">${street}</div>
                <div class="text-sm text-gray-500">${city}${postal ? ', ' + postal : ''}</div>
            `;

            item.addEventListener('click', () => {
                addressInput.value = street;
                cityInput.value = city;
                postalCodeInput.value = formatPostalCode(postal);
                addressDropdown.classList.add('hidden');

                // Success feedback
                [addressInput, cityInput, postalCodeInput].forEach(input => {
                    input.classList.add('border-green-500');
                    setTimeout(() => input.classList.remove('border-green-500'), 1500);
                });
            });

            addressDropdown.appendChild(item);
        });

        addressDropdown.classList.remove('hidden');
    }

    function formatPostalCode(code) {
        if (!code) return '';
        const clean = code.replace(/\s/g, '').toUpperCase();
        return clean.length === 6 ? `${clean.slice(0, 3)} ${clean.slice(3)}` : code;
    }

    // Postal code formatting
    postalCodeInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\s/g, '').toUpperCase();
        if (value.length > 3) {
            value = value.slice(0, 3) + ' ' + value.slice(3, 6);
        }
        e.target.value = value;
    });

    // =====================================================
    // Sector Selection - using event delegation
    // =====================================================

    document.addEventListener('click', (e) => {
        const card = e.target.closest('.sector-card');
        if (card) {
            console.log('Sector card clicked:', card.dataset.sector);

            // Get fresh list of all sector cards
            const allSectorCards = document.querySelectorAll('.sector-card');

            // Remove selection from all
            allSectorCards.forEach(c => {
                c.classList.remove('border-primary', 'bg-orange-50');
                c.classList.add('border-gray-200');
                const icon = c.querySelector('.material-symbols-outlined');
                if (icon) {
                    icon.classList.remove('text-primary');
                    icon.classList.add('text-gray-400');
                }
            });

            // Select clicked card
            card.classList.remove('border-gray-200');
            card.classList.add('border-primary', 'bg-orange-50');
            const icon = card.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.classList.remove('text-gray-400');
                icon.classList.add('text-primary');
            }

            // Update hidden input
            const sectorInput = document.getElementById('selectedSector');
            if (sectorInput) {
                sectorInput.value = card.dataset.sector;
                console.log('Sector set to:', sectorInput.value);
            }
        }
    });

    // =====================================================
    // Annual Purchase & Promo Calculation
    // =====================================================

    annualPurchaseInput.addEventListener('input', (e) => {
        // Format number
        let value = e.target.value.replace(/\D/g, '');
        if (value) {
            value = parseInt(value).toLocaleString('fr-CA');
        }
        e.target.value = value;

        calculatePromo(value);
    });

    function calculatePromo(value) {
        const amount = parseInt(value.replace(/\s/g, '').replace(/,/g, '')) || 0;

        if (amount > 0) {
            // Formula: amount / 2 = minimum order for 2% rebate
            const minOrder = Math.round(amount / 2);
            promoMinOrder.textContent = `$${minOrder.toLocaleString('fr-CA')}`;
            promoCard.classList.remove('hidden');
            // Reset promo choice when amount changes
            resetPromoButtons();
        } else {
            promoCard.classList.add('hidden');
        }
    }

    // =====================================================
    // Promo Accept/Refuse Buttons
    // =====================================================

    const acceptPromoBtn = document.getElementById('acceptPromo');
    const refusePromoBtn = document.getElementById('refusePromo');
    const promoAcceptedInput = document.getElementById('promoAccepted');

    function resetPromoButtons() {
        if (promoAcceptedInput) promoAcceptedInput.value = '';
        if (acceptPromoBtn) {
            acceptPromoBtn.classList.remove('ring-2', 'ring-offset-2', 'ring-yellow-400', 'scale-105');
            acceptPromoBtn.innerHTML = '<span class="material-symbols-outlined text-lg">check_circle</span> J\'accepte';
        }
        if (refusePromoBtn) {
            refusePromoBtn.classList.remove('ring-2', 'ring-offset-2', 'ring-white', 'opacity-100');
            refusePromoBtn.classList.add('opacity-100');
        }
    }

    if (acceptPromoBtn) {
        acceptPromoBtn.addEventListener('click', () => {
            promoAcceptedInput.value = 'yes';

            // Visual feedback
            acceptPromoBtn.classList.add('ring-2', 'ring-offset-2', 'ring-yellow-400', 'scale-105');
            acceptPromoBtn.innerHTML = '<span class="material-symbols-outlined text-lg">verified</span> Accepté!';

            refusePromoBtn.classList.remove('ring-2', 'ring-offset-2', 'ring-white');
            refusePromoBtn.classList.add('opacity-50');
        });
    }

    if (refusePromoBtn) {
        refusePromoBtn.addEventListener('click', () => {
            promoAcceptedInput.value = 'no';

            // Visual feedback
            refusePromoBtn.classList.add('ring-2', 'ring-offset-2', 'ring-white');
            refusePromoBtn.classList.remove('opacity-50');

            acceptPromoBtn.classList.remove('ring-2', 'ring-offset-2', 'ring-yellow-400', 'scale-105');
            acceptPromoBtn.innerHTML = '<span class="material-symbols-outlined text-lg">check_circle</span> J\'accepte';
            acceptPromoBtn.classList.add('opacity-50');
        });
    }

    // =====================================================
    // Phone Formatting
    // =====================================================

    phoneInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');

        if (value.length >= 10) {
            value = `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6, 10)}`;
        } else if (value.length >= 6) {
            value = `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6)}`;
        } else if (value.length >= 3) {
            value = `(${value.slice(0, 3)}) ${value.slice(3)}`;
        }

        e.target.value = value;
    });

    // =====================================================
    // Summary Update
    // =====================================================

    function updateSummary() {
        // Company info
        document.getElementById('sumCompany').textContent =
            document.getElementById('companyName').value || '-';
        document.getElementById('sumOwner').textContent =
            document.getElementById('ownerName').value || '-';

        const contactName = isOwnerCheckbox.checked
            ? document.getElementById('ownerName').value
            : document.getElementById('contactName').value;
        document.getElementById('sumContact').textContent = contactName || '-';

        const address = addressInput.value;
        const city = cityInput.value;
        const postal = postalCodeInput.value;
        document.getElementById('sumAddress').textContent =
            address ? `${address}, ${city} ${postal}` : '-';

        // Activity info
        const sectorMap = {
            'restaurant': 'Restaurant',
            'hotellerie': 'Hôtellerie',
            'residence': 'Résidence pour aînés',
            'epicerie': 'Épicerie',
            'depanneur': 'Dépanneur',
            'autre': 'Autre'
        };
        document.getElementById('sumSector').textContent =
            sectorMap[selectedSectorInput.value] || '-';

        const annual = annualPurchaseInput.value;
        document.getElementById('sumAnnual').textContent = annual ? `$${annual}` : '-';

        // Contact info
        document.getElementById('sumEmailResp').textContent =
            document.getElementById('emailResponsable').value || '-';
        document.getElementById('sumEmailFact').textContent =
            document.getElementById('emailFacturation').value || '-';
        document.getElementById('sumPhone').textContent =
            phoneInput.value || '-';

        // Promo info
        const sumPromoRow = document.getElementById('sumPromoRow');
        const promoAccepted = document.getElementById('promoAccepted');
        if (annual && promoAccepted && promoAccepted.value === 'yes') {
            const amount = parseInt(annual.replace(/\s/g, '').replace(/,/g, '')) || 0;
            if (amount > 0) {
                const minOrder = Math.round(amount / 2.33);
                document.getElementById('sumPromo').textContent =
                    `2% avec min. $${minOrder.toLocaleString('fr-CA')}/année`;
                sumPromoRow.classList.remove('hidden');
            } else {
                sumPromoRow.classList.add('hidden');
            }
        } else {
            sumPromoRow.classList.add('hidden');
        }
    }

    // =====================================================
    // Form Submission
    // =====================================================

    form2.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Validate signature (now checks for base64 image data)
        const signatureInput = document.getElementById('signature');
        const signatureContainer = document.getElementById('signatureContainer');
        if (!signatureInput.value || !signatureInput.value.startsWith('data:image')) {
            if (signatureContainer) {
                signatureContainer.classList.add('border-red-500');
                shakeElement(signatureContainer);
            }
            return;
        }

        // Validate terms
        const acceptTerms = document.getElementById('acceptTerms');
        if (!acceptTerms.checked) {
            shakeElement(acceptTerms.parentElement);
            return;
        }

        const submitBtn = form2.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = `
            <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Envoi en cours...</span>
        `;
        submitBtn.disabled = true;

        // Collect form data
        const annual = annualPurchaseInput.value;
        const promoAccepted = document.getElementById('promoAccepted');
        let promoMinOrder = '';
        if (promoAccepted && promoAccepted.value === 'yes' && annual) {
            const amount = parseInt(annual.replace(/\s/g, '').replace(/,/g, '')) || 0;
            promoMinOrder = `$${Math.round(amount / 2).toLocaleString('fr-CA')}`;
        }

        const formData = {
            companyName: document.getElementById('companyName').value,
            ownerName: document.getElementById('ownerName').value,
            contactName: isOwnerCheckbox.checked
                ? document.getElementById('ownerName').value
                : document.getElementById('contactName').value,
            address: addressInput.value,
            city: cityInput.value,
            postalCode: postalCodeInput.value,
            sector: selectedSectorInput.value,
            annualPurchase: annual.replace(/\s/g, ''),
            promoAccepted: promoAccepted ? promoAccepted.value : 'no',
            promoMinOrder: promoMinOrder,
            emailResponsable: document.getElementById('emailResponsable').value,
            emailFacturation: document.getElementById('emailFacturation').value,
            phone: phoneInput.value,
            signature: document.getElementById('signature').value
        };

        try {
            const response = await fetch('/api/demandes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (response.ok && result.success) {
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
                goToStep('success');
            } else {
                throw new Error(result.error || 'Erreur lors de la soumission');
            }
        } catch (error) {
            console.error('Erreur:', error);
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
            alert('Une erreur est survenue. Veuillez réessayer.');
        }
    });

    // Note: goToStep is already defined above, this was a duplicate that was removed

    // =====================================================
    // Input Focus Effects
    // =====================================================

    const allInputs = document.querySelectorAll('input:not([type="checkbox"]):not([type="hidden"])');

    allInputs.forEach(input => {
        input.addEventListener('focus', () => {
            input.classList.remove('border-red-500');
        });
    });

    // =====================================================
    // Initialize
    // =====================================================

    // DEV MODE: Check URL for step parameter (?step=2 or ?step=3)
    const urlParams = new URLSearchParams(window.location.search);
    const startStep = parseInt(urlParams.get('step')) || 1;

    // If starting on step 2 or 3, fill with dummy data for testing
    if (startStep > 1) {
        document.getElementById('companyName').value = 'Restaurant Test Inc.';
        document.getElementById('ownerName').value = 'Jean Tremblay';
        document.getElementById('address').value = '123 Rue Principale';
        document.getElementById('city').value = 'Chicoutimi';
        document.getElementById('postalCode').value = 'G7H 1A1';
    }

    if (startStep > 2) {
        selectedSectorInput.value = 'restaurant';
        const restaurantCard = document.querySelector('[data-sector="restaurant"]');
        if (restaurantCard) {
            restaurantCard.classList.remove('border-gray-200');
            restaurantCard.classList.add('border-primary', 'bg-orange-50');
            restaurantCard.querySelector('.material-symbols-outlined').classList.remove('text-gray-400');
            restaurantCard.querySelector('.material-symbols-outlined').classList.add('text-primary');
        }
        annualPurchaseInput.value = '50 000';
        calculatePromo('50 000');
        document.getElementById('emailResponsable').value = 'test@exemple.com';
        document.getElementById('emailFacturation').value = 'facture@exemple.com';
        document.getElementById('phone').value = '(418) 555-0123';
    }

    goToStep(startStep);

    // =====================================================
    // Modals (Privacy Policy & Terms)
    // =====================================================

    const modalPrivacy = document.getElementById('modalPrivacy');
    const modalTerms = document.getElementById('modalTerms');
    const openPrivacy = document.getElementById('openPrivacy');
    const openTerms = document.getElementById('openTerms');
    const termsNoPromo = document.getElementById('termsNoPromo');
    const termsWithPromo = document.getElementById('termsWithPromo');
    const termsMinAmount = document.getElementById('termsMinAmount');
    const termsMinAmount2 = document.getElementById('termsMinAmount2');

    function openModal(modal) {
        // If opening terms modal, show correct version based on promo
        if (modal === modalTerms) {
            const promoAccepted = document.getElementById('promoAccepted');
            const annual = annualPurchaseInput.value;

            if (promoAccepted && promoAccepted.value === 'yes' && annual) {
                // Show promo version
                termsNoPromo.classList.add('hidden');
                termsWithPromo.classList.remove('hidden');

                // Update minimum amount in terms
                const amount = parseInt(annual.replace(/\s/g, '').replace(/,/g, '')) || 0;
                const minOrder = Math.round(amount / 2);
                const formattedAmount = `$${minOrder.toLocaleString('fr-CA')}`;
                if (termsMinAmount) termsMinAmount.textContent = formattedAmount;
                if (termsMinAmount2) termsMinAmount2.textContent = formattedAmount;
            } else {
                // Show standard version
                termsNoPromo.classList.remove('hidden');
                termsWithPromo.classList.add('hidden');
            }
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.style.overflow = 'hidden';
    }

    function closeModal(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = '';
    }

    if (openPrivacy && modalPrivacy) {
        openPrivacy.addEventListener('click', (e) => {
            e.preventDefault();
            openModal(modalPrivacy);
        });
    }

    if (openTerms && modalTerms) {
        openTerms.addEventListener('click', (e) => {
            e.preventDefault();
            openModal(modalTerms);
        });
    }

    // Close modal buttons
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            closeModal(modalPrivacy);
            closeModal(modalTerms);
        });
    });

    // Close on backdrop click
    [modalPrivacy, modalTerms].forEach(modal => {
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal(modal);
                }
            });
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal(modalPrivacy);
            closeModal(modalTerms);
        }
    });

    // =====================================================
    // Signature Canvas
    // =====================================================

    const signatureCanvas = document.getElementById('signatureCanvas');
    const signatureInput = document.getElementById('signature');
    const signaturePlaceholder = document.getElementById('signaturePlaceholder');
    const clearSignatureBtn = document.getElementById('clearSignature');
    const signatureContainer = document.getElementById('signatureContainer');

    if (signatureCanvas) {
        const ctx = signatureCanvas.getContext('2d');
        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;
        let hasDrawn = false;

        // Set canvas size to match container
        function resizeCanvas() {
            const rect = signatureCanvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            // Save current drawing
            const imageData = hasDrawn ? ctx.getImageData(0, 0, signatureCanvas.width, signatureCanvas.height) : null;

            signatureCanvas.width = rect.width * dpr;
            signatureCanvas.height = rect.height * dpr;

            ctx.scale(dpr, dpr);
            signatureCanvas.style.width = rect.width + 'px';
            signatureCanvas.style.height = rect.height + 'px';

            // Setup drawing style
            ctx.strokeStyle = '#1a1a1a';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Restore drawing if any
            if (imageData) {
                ctx.putImageData(imageData, 0, 0);
            }
        }

        // Initial resize
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // Get coordinates from event (mouse or touch)
        function getCoordinates(e) {
            const rect = signatureCanvas.getBoundingClientRect();
            if (e.touches && e.touches.length > 0) {
                return {
                    x: e.touches[0].clientX - rect.left,
                    y: e.touches[0].clientY - rect.top
                };
            }
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        }

        // Start drawing
        function startDrawing(e) {
            e.preventDefault();
            isDrawing = true;
            const coords = getCoordinates(e);
            lastX = coords.x;
            lastY = coords.y;

            // Hide placeholder on first draw
            if (!hasDrawn && signaturePlaceholder) {
                signaturePlaceholder.style.opacity = '0';
            }
        }

        // Draw
        function draw(e) {
            if (!isDrawing) return;
            e.preventDefault();

            const coords = getCoordinates(e);

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(coords.x, coords.y);
            ctx.stroke();

            lastX = coords.x;
            lastY = coords.y;
            hasDrawn = true;
        }

        // Stop drawing
        function stopDrawing(e) {
            if (isDrawing) {
                isDrawing = false;
                // Save signature as base64
                saveSignature();
            }
        }

        // Save signature to hidden input
        function saveSignature() {
            if (hasDrawn) {
                const dataURL = signatureCanvas.toDataURL('image/png');
                signatureInput.value = dataURL;
                signatureContainer.classList.remove('border-red-500');
                signatureContainer.classList.add('border-green-500');
                setTimeout(() => signatureContainer.classList.remove('border-green-500'), 1500);
            }
        }

        // Clear signature
        function clearSignature() {
            ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
            signatureInput.value = '';
            hasDrawn = false;
            if (signaturePlaceholder) {
                signaturePlaceholder.style.opacity = '1';
            }
        }

        // Mouse events
        signatureCanvas.addEventListener('mousedown', startDrawing);
        signatureCanvas.addEventListener('mousemove', draw);
        signatureCanvas.addEventListener('mouseup', stopDrawing);
        signatureCanvas.addEventListener('mouseout', stopDrawing);

        // Touch events (mobile)
        signatureCanvas.addEventListener('touchstart', startDrawing, { passive: false });
        signatureCanvas.addEventListener('touchmove', draw, { passive: false });
        signatureCanvas.addEventListener('touchend', stopDrawing);
        signatureCanvas.addEventListener('touchcancel', stopDrawing);

        // Clear button
        if (clearSignatureBtn) {
            clearSignatureBtn.addEventListener('click', clearSignature);
        }
    }
});
