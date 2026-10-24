async function authRequest(path, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch('/api' + path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error('The app returned an unreadable response. Restart Hangout and try again.');
        }
        if (!response.ok) throw new Error(result.error || 'Please try again.');
        return result;
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('The email service took too long to respond. Please try again.');
        if (error instanceof TypeError) throw new Error('Could not reach Hangout. Restart the app and try again.');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function setMessage(node, message) {
    if (node) node.textContent = message;
}

const loginForm = document.querySelector('#loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async event => {
        event.preventDefault();
        const button = loginForm.querySelector('input[type="submit"]');
        const message = document.querySelector('#loginMessage');
        const data = new FormData(loginForm);
        button.disabled = true;
        setMessage(message, '');
        try {
            await authRequest('/login', {
                email: data.get('email'),
                password: data.get('password')
            });
            window.location.href = '/home%20page/index.html';
        } catch (error) {
            setMessage(message, error.message);
        } finally {
            button.disabled = false;
        }
    });
}

const resetForm = document.querySelector('#resetForm');
const forgotPassword = document.querySelector('#forgotPassword');
if (loginForm && resetForm && forgotPassword) {
    const resetEmail = document.querySelector('#resetEmail');
    const resetFields = document.querySelector('#resetCodeFields');
    const resetCode = document.querySelector('#resetCode');
    const resetPassword = document.querySelector('#resetNewPassword');
    const resetButton = document.querySelector('#resetSubmit');
    const resetMessage = document.querySelector('#resetMessage');
    const resendResetCode = document.querySelector('#resendResetCode');
    let resetCodeSent = false;

    forgotPassword.addEventListener('click', event => {
        event.preventDefault();
        resetEmail.value = loginForm.querySelector('[name="email"]').value;
        setMessage(resetMessage, '');
        loginForm.hidden = true;
        resetForm.hidden = false;
        resetEmail.focus();
    });

    document.querySelector('#backToLogin').addEventListener('click', event => {
        event.preventDefault();
        resetForm.hidden = true;
        loginForm.hidden = false;
        setMessage(resetMessage, '');
    });

    async function sendResetCode() {
        const button = resetButton;
        button.disabled = true;
        setMessage(resetMessage, 'Sending code…');
        try {
            await authRequest('/password-reset/send-otp', { email: resetEmail.value });
            resetCodeSent = true;
            resetFields.hidden = false;
            resetCode.disabled = false;
            resetCode.required = true;
            resetPassword.disabled = false;
            resetPassword.required = true;
            resetButton.value = 'Reset password';
            resendResetCode.hidden = false;
            setMessage(resetMessage, 'If this email has an account, a six-digit code is on its way. Check your inbox and spam folder.');
        } catch (error) {
            setMessage(resetMessage, error.message);
        } finally {
            button.disabled = false;
        }
    }

    resetForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!resetCodeSent) {
            await sendResetCode();
            return;
        }
        resetButton.disabled = true;
        setMessage(resetMessage, '');
        try {
            await authRequest('/password-reset/verify-otp', {
                email: resetEmail.value,
                code: resetCode.value,
                password: resetPassword.value
            });
            loginForm.querySelector('[name="email"]').value = resetEmail.value;
            loginForm.querySelector('[name="password"]').value = '';
            resetForm.hidden = true;
            loginForm.hidden = false;
            setMessage(document.querySelector('#loginMessage'), 'Password updated. Sign in with your new password.');
        } catch (error) {
            setMessage(resetMessage, error.message);
        } finally {
            resetButton.disabled = false;
        }
    });

    resendResetCode.addEventListener('click', async event => {
        event.preventDefault();
        await sendResetCode();
    });
}

if (loginForm && new URLSearchParams(window.location.search).has('verified')) {
    setMessage(document.querySelector('#loginMessage'), 'Email verified. You can sign in now.');
}

const signupForm = document.querySelector('#signupForm');
if (signupForm) {
    const signupEmail = signupForm.querySelector('[name="email"]');
    const signupCodeWrap = document.querySelector('#signupCodeWrap');
    const signupCode = document.querySelector('#signupCode');
    const signupCodeNote = document.querySelector('#signupCodeNote');
    const signupCodeActions = document.querySelector('#signupCodeActions');
    const signupButton = signupForm.querySelector('input[type="submit"]');
    const signupMessage = document.querySelector('#signupMessage');
    let signupCodeSent = false;

    async function requestSignupCode() {
        signupButton.disabled = true;
        setMessage(signupMessage, 'Sending verification code…');
        try {
            await authRequest('/signup/send-otp', {
                name: signupForm.querySelector('[name="name"]').value,
                email: signupEmail.value,
                password: signupForm.querySelector('[name="password"]').value
            });
            signupCodeSent = true;
            signupEmail.readOnly = true;
            signupCodeWrap.hidden = false;
            signupCode.disabled = false;
            signupCode.required = true;
            signupCodeNote.hidden = false;
            signupCodeNote.textContent = `Enter the six-digit code sent to ${signupEmail.value}. It expires in 10 minutes.`;
            signupCodeActions.hidden = false;
            signupButton.value = 'Verify email and create account';
            setMessage(signupMessage, 'Check your inbox and spam folder for the code.');
            signupCode.focus();
        } catch (error) {
            setMessage(signupMessage, error.message);
        } finally {
            signupButton.disabled = false;
        }
    }

    signupForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!signupCodeSent) {
            await requestSignupCode();
            return;
        }
        signupButton.disabled = true;
        setMessage(signupMessage, '');
        try {
            await authRequest('/signup/verify-otp', {
                name: signupForm.querySelector('[name="name"]').value,
                email: signupEmail.value,
                password: signupForm.querySelector('[name="password"]').value,
                code: signupCode.value
            });
            window.location.href = '/sign%20up/?verified=1';
        } catch (error) {
            setMessage(signupMessage, error.message);
        } finally {
            signupButton.disabled = false;
        }
    });

    document.querySelector('#resendSignupCode').addEventListener('click', async event => {
        event.preventDefault();
        await requestSignupCode();
    });

    document.querySelector('#changeSignupEmail').addEventListener('click', event => {
        event.preventDefault();
        signupCodeSent = false;
        signupEmail.readOnly = false;
        signupCode.value = '';
        signupCode.required = false;
        signupCode.disabled = true;
        signupCodeWrap.hidden = true;
        signupCodeNote.hidden = true;
        signupCodeActions.hidden = true;
        signupButton.value = 'Send verification code';
        setMessage(signupMessage, 'Enter the email you want to verify. A resent code is limited to once every 60 seconds.');
        signupEmail.focus();
    });
}

for (const codeInput of document.querySelectorAll('#signupCode, #resetCode')) {
    codeInput.addEventListener('input', () => {
        codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    });
}
