// =====================================================
// Analytics Tracking Script
// Les Jardins du Saguenay - Formulaire d'ouverture de compte
// =====================================================

(function() {
    'use strict';

    // Generate unique session ID
    function generateSessionId() {
        return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Get or create session ID
    let sessionId = sessionStorage.getItem('analyticsSessionId');
    if (!sessionId) {
        sessionId = generateSessionId();
        sessionStorage.setItem('analyticsSessionId', sessionId);
    }

    // Detect device type
    function getDeviceType() {
        const ua = navigator.userAgent;
        if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
            return 'tablet';
        }
        if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
            return 'mobile';
        }
        return 'desktop';
    }

    // Detect browser
    function getBrowser() {
        const ua = navigator.userAgent;
        if (ua.includes('Firefox')) return 'Firefox';
        if (ua.includes('SamsungBrowser')) return 'Samsung';
        if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera';
        if (ua.includes('Trident')) return 'IE';
        if (ua.includes('Edge')) return 'Edge';
        if (ua.includes('Edg')) return 'Edge';
        if (ua.includes('Chrome')) return 'Chrome';
        if (ua.includes('Safari')) return 'Safari';
        return 'Unknown';
    }

    // Detect OS
    function getOS() {
        const ua = navigator.userAgent;
        if (ua.includes('Win')) return 'Windows';
        if (ua.includes('Mac')) return 'MacOS';
        if (ua.includes('Linux')) return 'Linux';
        if (ua.includes('Android')) return 'Android';
        if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
        return 'Unknown';
    }

    // Get URL parameters
    function getUrlParam(param) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(param);
    }

    // Track state
    const tracker = {
        currentStep: '1',
        stepStartTime: Date.now(),
        fieldFocusTime: {},
        currentField: null,
        fieldStartTime: null,
        promoShownTime: null,
        initialized: false
    };

    // Send data to server (fire and forget)
    function sendEvent(endpoint, data) {
        const payload = { sessionId, ...data };

        // Use sendBeacon for reliability, fallback to fetch
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/analytics/' + endpoint, JSON.stringify(payload));
        } else {
            fetch('/api/analytics/' + endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true
            }).catch(() => {});
        }
    }

    // Initialize session
    function initSession() {
        if (tracker.initialized) return;
        tracker.initialized = true;

        const sessionData = {
            deviceType: getDeviceType(),
            browser: getBrowser(),
            os: getOS(),
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            referrer: document.referrer || null,
            utmSource: getUrlParam('utm_source'),
            utmMedium: getUrlParam('utm_medium'),
            utmCampaign: getUrlParam('utm_campaign')
        };

        sendEvent('session', sessionData);

        // Track initial step view
        trackEvent('step_view', { step: '1' });
    }

    // Track event
    function trackEvent(eventType, eventData = {}, step = null) {
        sendEvent('event', {
            eventType,
            eventData,
            step: step || tracker.currentStep
        });
    }

    // Track step change
    function trackStepChange(newStep) {
        const now = Date.now();
        const timeSpent = now - tracker.stepStartTime;

        // Save time spent on previous step
        sendEvent('step-time', {
            step: tracker.currentStep,
            timeSpent,
            enteredAt: new Date(tracker.stepStartTime).toISOString(),
            leftAt: new Date(now).toISOString()
        });

        // Update current step
        tracker.currentStep = newStep;
        tracker.stepStartTime = now;

        // Track new step view
        trackEvent('step_view', { step: newStep }, newStep);
    }

    // Track field focus
    function trackFieldFocus(fieldName) {
        // End previous field tracking
        if (tracker.currentField && tracker.fieldStartTime) {
            const timeSpent = Date.now() - tracker.fieldStartTime;
            sendEvent('field', {
                fieldName: tracker.currentField,
                interactionType: 'blur',
                timeSpent
            });
        }

        // Start tracking new field
        tracker.currentField = fieldName;
        tracker.fieldStartTime = Date.now();

        sendEvent('field', {
            fieldName,
            interactionType: 'focus',
            timeSpent: 0
        });
    }

    // Track field blur
    function trackFieldBlur(fieldName) {
        if (tracker.currentField === fieldName && tracker.fieldStartTime) {
            const timeSpent = Date.now() - tracker.fieldStartTime;
            sendEvent('field', {
                fieldName,
                interactionType: 'blur',
                timeSpent
            });
            tracker.currentField = null;
            tracker.fieldStartTime = null;
        }
    }

    // Track promo card shown
    function trackPromoShown() {
        tracker.promoShownTime = Date.now();
        trackEvent('promo_shown', {});
    }

    // Track promo decision
    function trackPromoDecision(accepted) {
        const viewTime = tracker.promoShownTime ? Date.now() - tracker.promoShownTime : 0;
        trackEvent(accepted ? 'promo_accepted' : 'promo_refused', { viewTime });
    }

    // Track form completion
    function trackCompletion() {
        // Track final step time
        const now = Date.now();
        const timeSpent = now - tracker.stepStartTime;
        sendEvent('step-time', {
            step: tracker.currentStep,
            timeSpent,
            enteredAt: new Date(tracker.stepStartTime).toISOString(),
            leftAt: new Date(now).toISOString()
        });

        // Mark session as complete
        sendEvent('session/end', { completed: true });

        trackEvent('form_completed', {});
    }

    // Track page unload (abandonment)
    function trackUnload() {
        // Only track if not completed
        if (tracker.currentStep !== 'success') {
            const now = Date.now();
            const timeSpent = now - tracker.stepStartTime;

            // Track final step time
            sendEvent('step-time', {
                step: tracker.currentStep,
                timeSpent,
                enteredAt: new Date(tracker.stepStartTime).toISOString(),
                leftAt: new Date(now).toISOString()
            });

            // Track current field if any
            if (tracker.currentField && tracker.fieldStartTime) {
                sendEvent('field', {
                    fieldName: tracker.currentField,
                    interactionType: 'abandon',
                    timeSpent: now - tracker.fieldStartTime
                });
            }

            // Mark session as abandoned
            sendEvent('session/end', { completed: false });
        }
    }

    // =====================================================
    // DOM Event Listeners
    // =====================================================

    document.addEventListener('DOMContentLoaded', function() {
        initSession();

        // Track step navigation buttons
        document.querySelectorAll('[data-next], [data-prev]').forEach(btn => {
            btn.addEventListener('click', function() {
                const nextStep = this.getAttribute('data-next');
                const prevStep = this.getAttribute('data-prev');
                const newStep = nextStep || prevStep;
                if (newStep) {
                    setTimeout(() => trackStepChange(newStep), 100);
                }
            });
        });

        // Track form field interactions
        const formFields = document.querySelectorAll('input, select, textarea');
        formFields.forEach(field => {
            const fieldName = field.name || field.id || 'unknown';

            field.addEventListener('focus', () => trackFieldFocus(fieldName));
            field.addEventListener('blur', () => trackFieldBlur(fieldName));
        });

        // Track promo card visibility
        const promoCard = document.getElementById('promoCard');
        if (promoCard) {
            // Use MutationObserver to detect when promo card becomes visible
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        if (!promoCard.classList.contains('hidden')) {
                            trackPromoShown();
                        }
                    }
                });
            });
            observer.observe(promoCard, { attributes: true });
        }

        // Track promo accept/refuse buttons
        const acceptBtn = document.getElementById('acceptPromo');
        const refuseBtn = document.getElementById('refusePromo');

        if (acceptBtn) {
            acceptBtn.addEventListener('click', () => trackPromoDecision(true));
        }
        if (refuseBtn) {
            refuseBtn.addEventListener('click', () => trackPromoDecision(false));
        }

        // Track form submission
        const mainForm = document.getElementById('mainForm');
        if (mainForm) {
            mainForm.addEventListener('submit', function(e) {
                // Don't prevent default, just track
                trackEvent('form_submit_attempt', {});
            });
        }

        // Track successful completion (when success step is shown)
        const successStep = document.querySelector('[data-step="success"]');
        if (successStep) {
            const successObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        if (!successStep.classList.contains('hidden')) {
                            trackStepChange('success');
                            trackCompletion();
                        }
                    }
                });
            });
            successObserver.observe(successStep, { attributes: true });
        }

        // Track modal opens
        const privacyLink = document.getElementById('openPrivacy');
        const termsLink = document.getElementById('openTerms');

        if (privacyLink) {
            privacyLink.addEventListener('click', () => trackEvent('modal_open', { modal: 'privacy' }));
        }
        if (termsLink) {
            termsLink.addEventListener('click', () => trackEvent('modal_open', { modal: 'terms' }));
        }

        // Track scrolling behavior
        let maxScroll = 0;
        window.addEventListener('scroll', function() {
            const scrollPercent = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
            if (scrollPercent > maxScroll) {
                maxScroll = scrollPercent;
                // Track milestone scrolls
                if (maxScroll === 25 || maxScroll === 50 || maxScroll === 75 || maxScroll === 100) {
                    trackEvent('scroll_milestone', { percent: maxScroll });
                }
            }
        });

        // Track visibility change (tab switch)
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                trackEvent('tab_hidden', {});
            } else {
                trackEvent('tab_visible', {});
            }
        });
    });

    // Track page unload
    window.addEventListener('beforeunload', trackUnload);
    window.addEventListener('pagehide', trackUnload);

    // Expose tracking functions globally for custom events
    window.Analytics = {
        trackEvent,
        trackStepChange,
        trackPromoShown,
        trackPromoDecision,
        trackCompletion
    };

})();
