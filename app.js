/**
 * Green City PWA - Main Application Script
 */

// ============================================================================
// SUPABASE CONFIGURATION & CLIENT
// ============================================================================
const SUPABASE_URL = 'https://igtjtwslhjeucfzmusxc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ZLWDSz3m4kch_ouj-FY1gQ_EYP910fk';

let supabaseClient = null;
let currentSession = null;
let currentProfile = null;
let isAuthRouting = false;
let isSigningOut = false;

function initSupabaseClient() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.warn('Supabase JS SDK is not loaded.');
        return null;
    }
    if (
        !SUPABASE_URL ||
        !SUPABASE_ANON_KEY ||
        SUPABASE_URL.includes('YOUR_SUPABASE_URL') ||
        SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY')
    ) {
        console.warn('Please set SUPABASE_URL and SUPABASE_ANON_KEY in app.js.');
        return null;
    }
    if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabaseClient;
}

document.addEventListener('DOMContentLoaded', async () => {
    // Hide bottom nav immediately on load if starting on an auth view
    const bottomNav = document.querySelector('.bottom-nav');
    const activeView = document.querySelector('.app-view.active-view');
    if (bottomNav && activeView && (activeView.id === 'view-login' || activeView.id === 'view-signup')) {
        bottomNav.style.display = 'none';
    }
    
    initViewSwitching();
    initLeafletMap();
    registerServiceWorker(); // <-- PWA Service Worker Registration
    initLoginHandlers();     // <-- Login Form & Password Toggle Handlers
    initSignUpHandlers();    // <-- Sign Up Form & Password Toggle Handlers
    initSignOutHandler();    // <-- Sign Out Button Handler
    await initAuthSession(); // <-- Supabase Session Check & Auth State Sync
});

// Global reference for Leaflet map
let mapInstance = null;

/**
 * Global Helper: Interactive Chip Toggle for Interests
 */
window.toggleInterest = function(buttonElement) {
    if (!buttonElement) return;
    const isCurrentlyActive = buttonElement.classList.contains('chip-active');
    if (isCurrentlyActive) {
        buttonElement.classList.remove('chip-active');
        buttonElement.classList.add('chip-inactive');
    } else {
        buttonElement.classList.add('chip-active');
        buttonElement.classList.remove('chip-inactive');
    }
};

/**
 * Helper: Show or clear feedback messages on Auth forms
 */
function setAuthFeedback(elementId, message, type = 'error') {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!message) {
        el.textContent = '';
        el.style.display = 'none';
        el.style.color = '';
        return;
    }
    el.textContent = message;
    el.style.display = 'block';
    el.style.marginTop = '0.5rem';
    el.style.fontSize = '0.85rem';
    el.style.fontWeight = '600';
    el.style.color = type === 'success' ? '#006d54' : '#ba1a1a';
}

/**
 * Helper: Clear login and sign-up form inputs, feedback, and password visibility states
 */
function resetAuthForms() {
	const loginForm = document.getElementById('login-form') || document.querySelector('#view-login form');
	if (loginForm && typeof loginForm.reset === 'function') {
		loginForm.reset();
	}

	const loginEmail = document.getElementById('login-email') || document.querySelector('#view-login input[type="email"], #view-login input[type="text"]');
	const loginPassword = document.getElementById('password-field');
	const loginEyeIcon = document.getElementById('eye-icon');
	const toggleLoginBtn = document.getElementById('toggle-password');

	if (loginEmail) loginEmail.value = '';
	if (loginPassword) {
		loginPassword.value = '';
		loginPassword.type = 'password';
	}
	if (loginEyeIcon) loginEyeIcon.textContent = 'visibility';
	if (toggleLoginBtn) toggleLoginBtn.setAttribute('aria-label', 'إظهار كلمة المرور');

	const signupForm = document.getElementById('signup-form') || document.querySelector('#view-signup form');
	if (signupForm && typeof signupForm.reset === 'function') {
		signupForm.reset();
	}

	const fullNameInput = document.getElementById('fullName');
	const signupEmailInput = document.getElementById('contactInfo');
	const signupPassword = document.getElementById('signup-password-field');
	const signupEyeIcon = document.getElementById('signup-eye-icon');
	const toggleSignupBtn = document.getElementById('toggle-signup-password');

	if (fullNameInput) fullNameInput.value = '';
	if (signupEmailInput) signupEmailInput.value = '';
	if (signupPassword) {
		signupPassword.value = '';
		signupPassword.type = 'password';
	}
	if (signupEyeIcon) signupEyeIcon.textContent = 'visibility';
	if (toggleSignupBtn) toggleSignupBtn.setAttribute('aria-label', 'إظهار كلمة المرور');

	setAuthFeedback('login-feedback', '');
	setAuthFeedback('signup-feedback', '');
}

/**
 * Helper: Toggle disabled/loading state on a submit button
 */
function setButtonLoading(button, isLoading, loadingText) {
    if (!button) return;
    if (!button.dataset.originalHtml) {
        button.dataset.originalHtml = button.innerHTML;
    }
    button.disabled = isLoading;
    if (isLoading && loadingText) {
        button.innerHTML = `<span>${loadingText}</span>`;
    } else if (!isLoading && button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
    }
}

/**
 * Helper: Translate common Supabase Auth error messages into Arabic
 */
function getFriendlyAuthError(error, fallbackMessage) {
    const raw = (error && error.message ? error.message : '').toLowerCase();
    if (!raw) return fallbackMessage;
    if (raw.includes('invalid login credentials')) {
        return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
    }
    if (raw.includes('email not confirmed')) {
        return 'يرجى تأكيد بريدك الإلكتروني أولاً قبل تسجيل الدخول.';
    }
    if (raw.includes('user already registered') || raw.includes('already exists')) {
        return 'هذا البريد الإلكتروني مسجل بالفعل.';
    }
    if (raw.includes('password should be at least')) {
        return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
    }
    if (raw.includes('unable to validate email address') || raw.includes('invalid email')) {
        return 'يرجى إدخال بريد إلكتروني صحيح.';
    }
    return error.message || fallbackMessage;
}

/**
 * Load user profile from public.profiles and update UI display elements
 */
async function loadCurrentUserProfile(user, fallbackFullName = '') {
	if (!user) {
		currentProfile = null;
		return null;
	}

	const client = initSupabaseClient();
	if (!client) return null;

	try {
		const { data, error } = await client
			.from('profiles')
			.select('id, full_name, email, avatar_url, is_moderator, eco_points, rank_title, interests')
			.eq('id', user.id)
			.maybeSingle();

		if (error) {
			console.error('Error loading user profile:', error);
		}

		const resolvedName =
			(data && data.full_name && data.full_name.trim()) ||
			(fallbackFullName && fallbackFullName.trim()) ||
			(user.user_metadata && user.user_metadata.full_name && user.user_metadata.full_name.trim()) ||
			(user.email ? user.email.split('@')[0] : 'مستخدم');

		const resolvedEmail =
			(data && data.email && data.email.trim()) ||
			(user.email ? user.email.trim() : '');

		currentProfile = data
			? { ...data, full_name: resolvedName, email: resolvedEmail }
			: {
				  id: user.id,
				  full_name: resolvedName,
				  email: resolvedEmail,
				  is_moderator: false
			  };

		applyProfileToUI(currentProfile);
		return currentProfile;
	} catch (err) {
		console.error('Unexpected error fetching profile:', err);
		return null;
	}
}

function applyProfileToUI(profile) {
	const greetingTitle = document.querySelector('#view-home .greeting-title');
	const profileNameEl = document.querySelector('#view-account .profile-name');
	const profileIdEl = document.querySelector('#view-account .profile-id');

	if (!profile) {
		if (greetingTitle) {
			greetingTitle.textContent = 'أهلاً بك';
		}
		if (profileNameEl) {
			profileNameEl.textContent = 'مستخدم';
		}
		if (profileIdEl) {
			profileIdEl.textContent = 'عضوية نشطة: #EG-84291';
		}
		return;
	}

	if (greetingTitle && profile.full_name) {
		greetingTitle.textContent = `أهلاً بك، ${profile.full_name}`;
	}

	if (profileNameEl && profile.full_name) {
		profileNameEl.textContent = profile.full_name;
	}

	if (profileIdEl) {
		const emailToShow =
			(profile.email && profile.email.trim()) ||
			(currentSession && currentSession.user && currentSession.user.email) ||
			'';
		profileIdEl.textContent = emailToShow || 'عضوية نشطة: #EG-84291';
	}
}

/**
 * Initialize Supabase session check and listen for auth state changes
 */
async function initAuthSession() {
    const client = initSupabaseClient();
    if (!client) return;

    try {
        const { data, error } = await client.auth.getSession();
        if (error) {
            console.error('Error getting session:', error);
        }

        currentSession = data && data.session ? data.session : null;

        if (currentSession && currentSession.user) {
            await loadCurrentUserProfile(currentSession.user);
            isAuthRouting = true;
            if (typeof window.switchView === 'function') {
                window.switchView('view-home');
            }
            isAuthRouting = false;
        } else {
            const activeView = document.querySelector('.app-view.active-view');
            const onAuthView = activeView && (activeView.id === 'view-login' || activeView.id === 'view-signup');
            isAuthRouting = true;
            if (!onAuthView && typeof window.switchView === 'function') {
                window.switchView('view-login');
            } else {
                const bottomNav = document.querySelector('.bottom-nav');
                if (bottomNav) bottomNav.style.display = 'none';
            }
            isAuthRouting = false;
        }

        client.auth.onAuthStateChange(async (event, session) => {
            currentSession = session || null;

            if (currentSession && currentSession.user) {
                if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
                    await loadCurrentUserProfile(currentSession.user);
                }
                const activeViewNow = document.querySelector('.app-view.active-view');
                if (activeViewNow && (activeViewNow.id === 'view-login' || activeViewNow.id === 'view-signup')) {
                    isAuthRouting = true;
                    if (typeof window.switchView === 'function') {
                        window.switchView('view-home');
                    }
                    isAuthRouting = false;
                }
            } else if (event === 'SIGNED_OUT') {
                currentProfile = null;
				applyProfileToUI(null);
				resetAuthForms();

				const activeViewNow = document.querySelector('.app-view.active-view');
				if (!activeViewNow || activeViewNow.id !== 'view-login') {
                isAuthRouting = true;
                if (typeof window.switchView === 'function') {
                    window.switchView('view-login');
                }
                isAuthRouting = false;
				}
            }
        });
    } catch (err) {
        console.error('Auth session initialization failed:', err);
    }
}

/**
 * Safe sign out helper (can be called from the logout button or console)
 */
window.signOutUser = async function() {
    if (isSigningOut) return;
    isSigningOut = true;

    const logoutBtn = document.getElementById('btn-sign-out');
    setButtonLoading(logoutBtn, true, 'جارٍ تسجيل الخروج...');

    const client = initSupabaseClient();

    try {
        if (client) {
            const { error } = await client.auth.signOut();
            if (error) {
                console.error('Supabase signOut error:', error);
            }
        }
    } catch (err) {
        console.error('Unexpected sign out error:', err);
    } finally {
		// Always clear local auth/profile state, form inputs, and return to login view
        currentSession = null;
        currentProfile = null;
        applyProfileToUI(null);
		resetAuthForms();

        setButtonLoading(logoutBtn, false);
        isSigningOut = false;

        isAuthRouting = true;
        if (typeof window.switchView === 'function') {
            window.switchView('view-login');
        }
        isAuthRouting = false;
    }
};

/**
 * Bind #btn-sign-out click listener
 */
function initSignOutHandler() {
    const signOutBtn = document.getElementById('btn-sign-out');
    if (!signOutBtn) return;

    signOutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await window.signOutUser();
    });
}

/**
 * Single-Page Application (SPA) View Switcher
 */
function initViewSwitching() {
    const navItems = document.querySelectorAll('.bottom-nav .nav-item[data-target]');
    const views = document.querySelectorAll('.app-view');
    const bottomNav = document.querySelector('.bottom-nav'); // <-- Reference the bottom nav
    const backToHomeBtn = document.getElementById('btn-map-back');
    const reportBackBtn = document.getElementById('btn-report-back');
    const communityBackBtn = document.getElementById('btn-community-back');
    const accountBackBtn = document.getElementById('btn-account-back');
    const openAccountBtn = document.getElementById('btn-open-account');
    const blogBackBtn = document.getElementById('btn-blog-back');
    const loginBackBtn = document.getElementById('btn-login-back');
    const initiativesBackBtn = document.getElementById('btn-initiatives-back');
    const ideaBackBtn = document.getElementById('btn-idea-back');

    // Function to switch view by target ID
    window.switchView = function(targetViewId) {
        // Prevent unauthenticated users from entering protected views via inline onclick handlers
        const isAuthTarget = targetViewId === 'view-login' || targetViewId === 'view-signup';
        if (!isAuthTarget && !isAuthRouting && supabaseClient && !currentSession) {
            targetViewId = 'view-login';
        }

        views.forEach(view => {
            if (view.id === targetViewId) {
                view.classList.add('active-view');
            } else {
                view.classList.remove('active-view');
            }
        });

        // Hide bottom nav on auth screens (Login & Sign Up), show on others
        if (bottomNav) {
            if (targetViewId === 'view-login' || targetViewId === 'view-signup') {
                bottomNav.style.display = 'none';
            } else {
                bottomNav.style.display = 'flex';
            }
        }

        // Update Bottom Nav state
        navItems.forEach(item => {
            if (item.getAttribute('data-target') === targetViewId) {
                item.classList.add('active');
                if (!item.querySelector('.nav-indicator')) {
                    const indicator = document.createElement('span');
                    indicator.className = 'nav-indicator';
                    item.appendChild(indicator);
                }
            } else {
                item.classList.remove('active');
                const indicator = item.querySelector('.nav-indicator');
                if (indicator) indicator.remove();
            }
        });

        // Refresh profile data when opening Account view
        if (targetViewId === 'view-account' && currentSession && currentSession.user) {
            loadCurrentUserProfile(currentSession.user);
        }

        // Re-render Leaflet Map size when switching to map view
        if (targetViewId === 'view-map' && mapInstance) {
            setTimeout(() => {
                mapInstance.invalidateSize();
            }, 200);
        }
    };

    // Nav Items click events
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');
            if (targetId) switchView(targetId);
        });
    });

    // Back to Home Button in Map Header
    if (backToHomeBtn) {
        backToHomeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('view-home');
        });
    }

    // Back to Home Button in Report Header
    if (reportBackBtn) {
        reportBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('view-home');
        });
    }

    if (communityBackBtn) {
        communityBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('view-home');
        });
    }

    if (accountBackBtn) {
        accountBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('view-home');
        });
    }
    if (openAccountBtn) {
        openAccountBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('view-account');
        });
    }
    if (blogBackBtn) {
        blogBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('view-home');
        });
    }
    if (loginBackBtn) {
        loginBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('view-home');
        });
    }

    // Back Button for Initiatives List Screen
    if (initiativesBackBtn) {
        initiativesBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('view-home');
        });
    }

    // Back Button for Add Idea Screen
    if (ideaBackBtn) {
        ideaBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('view-home');
        });
    }

    // Link Home Screen "إبلاغ عن مكان" card to Report View
    const reportActionCard = document.querySelector('.quick-actions-grid .action-card');
    if (reportActionCard) {
        reportActionCard.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof window.switchView === 'function') {
                window.switchView('view-report');
            }
        });
    }

    // Link Home Screen "انضم لمبادرة" card to Initiatives List View
    const actionCards = document.querySelectorAll('.quick-actions-grid .action-card');
    if (actionCards.length > 1) {
        actionCards[1].addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof window.switchView === 'function') {
                window.switchView('view-initiatives');
            }
        });
    }

    // Link Home Screen "اقترح فكرة" card to Add Idea View
    if (actionCards.length > 2) {
        actionCards[2].addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof window.switchView === 'function') {
                window.switchView('view-add-idea');
            }
        });
    }

    // Link Home Screen "عرض الكل" button to Initiatives List View
    const viewAllInitiativesBtn = document.querySelector('#view-home .section-block .section-link');
    if (viewAllInitiativesBtn) {
        viewAllInitiativesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof window.switchView === 'function') {
                window.switchView('view-initiatives');
            }
        });
    }

    // Link Community Screen "أضف فكرة" / action buttons to Add Idea View
    const communityAddIdeaBtn = document.querySelector('#view-community .motivation-banner button, #view-community .btn-add-idea');
    if (communityAddIdeaBtn) {
        communityAddIdeaBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof window.switchView === 'function') {
                window.switchView('view-add-idea');
            }
        });
    }
}

/**
 * Login Form and Password Visibility Handlers
 */
function initLoginHandlers() {
    // Password visibility toggle
    const toggleBtn = document.getElementById('toggle-password');
    const passwordField = document.getElementById('password-field');
    const eyeIcon = document.getElementById('eye-icon');

    if (toggleBtn && passwordField && eyeIcon) {
        toggleBtn.addEventListener('click', () => {
            const isPassword = passwordField.type === 'password';
            passwordField.type = isPassword ? 'text' : 'password';
            eyeIcon.textContent = isPassword ? 'visibility_off' : 'visibility';
            toggleBtn.setAttribute('aria-label', isPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
        });
    }

    // Handle Login Submit via Supabase Auth
    const loginForm = document.getElementById('login-form') || document.querySelector('#view-login form');
    const emailInput = document.getElementById('login-email') || document.querySelector('#view-login input[type="email"], #view-login input[type="text"]');
    const submitBtn = document.getElementById('btn-login-submit') || (loginForm ? loginForm.querySelector('button[type="submit"]') : null);

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            setAuthFeedback('login-feedback', '');

            const email = emailInput ? emailInput.value.trim() : '';
            const password = passwordField ? passwordField.value : '';

            if (!email || !password) {
                setAuthFeedback('login-feedback', 'يرجى إدخال البريد الإلكتروني وكلمة المرور.');
                return;
            }

            const client = initSupabaseClient();
            if (!client) {
                setAuthFeedback('login-feedback', 'إعدادات Supabase غير مكتملة بعد.');
                return;
            }

            setButtonLoading(submitBtn, true, 'جارٍ تسجيل الدخول...');

            try {
                const { data, error } = await client.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) {
                    setAuthFeedback('login-feedback', getFriendlyAuthError(error, 'تعذر تسجيل الدخول.'));
                    return;
                }

                currentSession = data.session || null;
                if (data.user) {
                    await loadCurrentUserProfile(data.user);
                }

                isAuthRouting = true;
            if (typeof window.switchView === 'function') {
                window.switchView('view-home');
            }
                isAuthRouting = false;
            } catch (err) {
                console.error('Login error:', err);
                setAuthFeedback('login-feedback', 'حدث خطأ أثناء الاتصال بالخادم.');
            } finally {
                setButtonLoading(submitBtn, false);
            }
        });
    }

    // Link from Login view -> Sign Up view
    const linkToSignUp = document.querySelector('.login-signup-link');
    if (linkToSignUp) {
        linkToSignUp.addEventListener('click', (e) => {
            e.preventDefault();
            setAuthFeedback('login-feedback', '');
            isAuthRouting = true;
            if (typeof window.switchView === 'function') {
                window.switchView('view-signup');
            }
            isAuthRouting = false;
        });
    }
}

/**
 * Sign Up Form, Routing, and Password Visibility Handlers
 */
function initSignUpHandlers() {
    // Link from Sign Up view -> Login view
    const linkToLogin = document.getElementById('link-to-login');
    if (linkToLogin) {
        linkToLogin.addEventListener('click', (e) => {
            e.preventDefault();
            setAuthFeedback('signup-feedback', '');
            isAuthRouting = true;
            if (typeof window.switchView === 'function') {
                window.switchView('view-login');
            }
            isAuthRouting = false;
        });
    }

    // Sign Up password visibility toggle
    const toggleSignupBtn = document.getElementById('toggle-signup-password');
    const signupPasswordField = document.getElementById('signup-password-field');
    const signupEyeIcon = document.getElementById('signup-eye-icon');

    if (toggleSignupBtn && signupPasswordField && signupEyeIcon) {
        toggleSignupBtn.addEventListener('click', () => {
            const isPassword = signupPasswordField.type === 'password';
            signupPasswordField.type = isPassword ? 'text' : 'password';
            signupEyeIcon.textContent = isPassword ? 'visibility_off' : 'visibility';
            toggleSignupBtn.setAttribute('aria-label', isPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
        });
    }

    const fullNameInput = document.getElementById('fullName');
    const emailInput = document.getElementById('contactInfo');
    const signupSubmitBtn = document.getElementById('btn-signup-submit');
    const signupForm = document.getElementById('signup-form') || document.querySelector('#view-signup form');
    let isSigningUp = false;

    async function performSignUp(e) {
        if (e) e.preventDefault();
        if (isSigningUp) return;

        setAuthFeedback('signup-feedback', '');

        const fullName = fullNameInput ? fullNameInput.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const password = signupPasswordField ? signupPasswordField.value : '';

        if (!fullName) {
            setAuthFeedback('signup-feedback', 'يرجى إدخال الاسم الكامل.');
            return;
        }
        if (!email) {
            setAuthFeedback('signup-feedback', 'يرجى إدخال البريد الإلكتروني.');
            return;
        }
        if (!password || password.length < 6) {
            setAuthFeedback('signup-feedback', 'يرجى إدخال كلمة مرور لا تقل عن 6 أحرف.');
            return;
        }

        const client = initSupabaseClient();
        if (!client) {
            setAuthFeedback('signup-feedback', 'إعدادات Supabase غير مكتملة بعد.');
            return;
        }

        isSigningUp = true;
        setButtonLoading(signupSubmitBtn, true, 'جارٍ إنشاء الحساب...');

        try {
            const { data, error } = await client.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName
                    }
                }
            });

            if (error) {
                setAuthFeedback('signup-feedback', getFriendlyAuthError(error, 'تعذر إنشاء الحساب.'));
                return;
            }

            // If email confirmation is disabled, Supabase returns an active session right away
            if (data && data.session && data.user) {
                currentSession = data.session;
                await loadCurrentUserProfile(data.user, fullName);
                isAuthRouting = true;
            if (typeof window.switchView === 'function') {
                window.switchView('view-home');
            }
                isAuthRouting = false;
            } else {
                setAuthFeedback(
                    'signup-feedback',
                    'تم إنشاء الحساب بنجاح! يرجى تأكيد بريدك الإلكتروني ثم تسجيل الدخول.',
                    'success'
                );
    }
        } catch (err) {
            console.error('Sign up error:', err);
            setAuthFeedback('signup-feedback', 'حدث خطأ أثناء إنشاء الحساب.');
        } finally {
            isSigningUp = false;
            setButtonLoading(signupSubmitBtn, false);
        }
    }

    if (signupSubmitBtn) {
        signupSubmitBtn.addEventListener('click', performSignUp);
    }

    if (signupForm) {
        signupForm.addEventListener('submit', performSignUp);
    }
}

/**
 * Register Service Worker for PWA Offline Support
 */
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js')
                .then((registration) => {
                    console.log('ServiceWorker registration successful with scope: ', registration.scope);
                })
                .catch((error) => {
                    console.error('ServiceWorker registration failed: ', error);
                });
        });
    }
}

/**
 * Initialize Interactive Leaflet Map
 */
function initLeafletMap() {
    // Maadi, Cairo Coordinates
    const maadiLat = 29.9602;
    const maadiLng = 31.2569;

    // Initialize map
    mapInstance = L.map('leaflet-map-canvas', {
        zoomControl: false,
        attributionControl: true
    }).setView([maadiLat, maadiLng], 14);

    // Esri Topo Map Layer
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18,
        attribution: 'Tiles &copy; Esri'
    }).addTo(mapInstance);

    // Custom Markers Data
    const locations = [
        {
            title: "حديقة الحي السابع - المعادي",
            lat: 29.9602,
            lng: 31.2569,
            type: "tertiary",
            label: "قيد التطوير",
            icon: "energy_savings_leaf"
        },
        {
            title: "ممشى دجلة الأخضر",
            lat: 29.9680,
            lng: 31.2650,
            type: "secondary",
            label: "ممشى دجلة الأخضر",
            icon: "park"
        },
        {
            title: "أشجار جافة - شارع 9",
            lat: 29.9540,
            lng: 31.2500,
            type: "error",
            label: "أشجار جافة",
            icon: "warning"
        }
    ];

    // Add Custom Markers to Map
    locations.forEach(loc => {
        const markerHtml = `
            <div class="marker-pin-wrapper">
                <div class="marker-label label-${loc.type}">${loc.label}</div>
                <div class="marker-bubble bubble-${loc.type}">
                    <span class="material-symbols-outlined icon-sm">${loc.icon}</span>
                </div>
            </div>
        `;

        const customIcon = L.divIcon({
            html: markerHtml,
            className: 'custom-leaflet-marker',
            iconSize: [80, 50],
            iconAnchor: [40, 45]
        });

        L.marker([loc.lat, loc.lng], { icon: customIcon }).addTo(mapInstance);
    });

    // Wire Up Map Controls
    const zoomInBtn = document.getElementById('btn-zoom-in');
    const zoomOutBtn = document.getElementById('btn-zoom-out');
    const recenterBtn = document.getElementById('btn-recenter');

    if (zoomInBtn) zoomInBtn.addEventListener('click', () => mapInstance.zoomIn());
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => mapInstance.zoomOut());
    if (recenterBtn) {
        recenterBtn.addEventListener('click', () => {
            mapInstance.flyTo([maadiLat, maadiLng], 14, { duration: 1.2 });
        });
    }
}