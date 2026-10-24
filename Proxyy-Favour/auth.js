async function submitAuth(path, form, messageNode, payload) {
    const submitButton = form.querySelector('input[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    messageNode.textContent = '';
    try {
        const response = await fetch('/api' + path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Please try again.');
        window.location.href = path === '/signup' ? '/sign%20up/?registered=1' : '/home%20page/index.html';
    } catch (error) {
        messageNode.textContent = error.message;
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

const loginForm = document.querySelector('#loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', event => {
        event.preventDefault();
        const data = new FormData(loginForm);
        submitAuth('/login', loginForm, document.querySelector('#loginMessage'), {
            email: data.get('email'),
            password: data.get('password')
        });
    });
    document.querySelector('#forgotPassword').addEventListener('click', event => {
        event.preventDefault();
        document.querySelector('#loginMessage').textContent = 'For a password reset, ask your campus Favour administrator.';
    });
}

if (loginForm && new URLSearchParams(window.location.search).has('registered')) {
    document.querySelector('#loginMessage').textContent = 'Account created. Sign in with your campus email and password.';
}

const signupForm = document.querySelector('#signupForm');
if (signupForm) {
    signupForm.addEventListener('submit', event => {
        event.preventDefault();
        const data = new FormData(signupForm);
        submitAuth('/signup', signupForm, document.querySelector('#signupMessage'), {
            name: data.get('name'),
            email: data.get('email'),
            password: data.get('password')
        });
    });
}
