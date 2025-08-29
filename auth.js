// Import Firebase Auth functions
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendPasswordResetEmail, 
    sendEmailVerification,
    onAuthStateChanged 
} from 'firebase/auth';
import { auth } from './firebase-config.js';

// DOM elements
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const forgotPasswordForm = document.getElementById('forgotPasswordForm');
const messageDiv = document.getElementById('message');

// Form elements
const loginFormElement = document.getElementById('loginFormElement');
const registerFormElement = document.getElementById('registerFormElement');
const forgotPasswordFormElement = document.getElementById('forgotPasswordFormElement');

// Navigation links
const showRegisterLink = document.getElementById('showRegister');
const showLoginLink = document.getElementById('showLogin');
const showForgotPasswordLink = document.getElementById('showForgotPassword');
const backToLoginLink = document.getElementById('backToLogin');

// Form switching
showRegisterLink.addEventListener('click', (e) => {
    e.preventDefault();
    showForm('register');
});

showLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    showForm('login');
});

showForgotPasswordLink.addEventListener('click', (e) => {
    e.preventDefault();
    showForm('forgotPassword');
});

backToLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    showForm('login');
});

function showForm(formType) {
    // Hide all forms
    loginForm.classList.remove('active');
    registerForm.classList.remove('active');
    forgotPasswordForm.classList.remove('active');
    hideMessage();

    // Show selected form
    switch(formType) {
        case 'login':
            loginForm.classList.add('active');
            break;
        case 'register':
            registerForm.classList.add('active');
            break;
        case 'forgotPassword':
            forgotPasswordForm.classList.add('active');
            break;
    }
}

// Message handling
function showMessage(text, type = 'error') {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.classList.remove('hidden');
}

function hideMessage() {
    messageDiv.classList.add('hidden');
}

function setButtonLoading(button, loading) {
    if (loading) {
        button.disabled = true;
        const originalText = button.textContent;
        button.innerHTML = '<span class="loading"></span>' + originalText;
        button.dataset.originalText = originalText;
    } else {
        button.disabled = false;
        button.innerHTML = button.dataset.originalText || button.textContent.replace(/^.*/, '');
    }
}

// Login functionality
loginFormElement.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const submitButton = e.target.querySelector('button[type="submit"]');
    
    if (!email || !password) {
        showMessage('Please fill in all fields');
        return;
    }
    
    try {
        setButtonLoading(submitButton, true);
        hideMessage();
        
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        showMessage('Login successful! Welcome back.', 'success');
        
        // Redirect to app setup page
        setTimeout(() => {
            window.location.href = 'app-setup.html';
        }, 1500);
        
    } catch (error) {
        let errorMessage = 'Login failed. Please try again.';
        
        switch (error.code) {
            case 'auth/user-not-found':
                errorMessage = 'No account found with this email address.';
                break;
            case 'auth/wrong-password':
                errorMessage = 'Invalid password. Please try again.';
                break;
            case 'auth/invalid-email':
                errorMessage = 'Invalid email address.';
                break;
            case 'auth/too-many-requests':
                errorMessage = 'Too many failed attempts. Please try again later.';
                break;
            case 'auth/user-disabled':
                errorMessage = 'This account has been disabled.';
                break;
        }
        
        showMessage(errorMessage);
    } finally {
        setButtonLoading(submitButton, false);
    }
});

// Registration functionality
registerFormElement.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const submitButton = e.target.querySelector('button[type="submit"]');
    
    if (!email || !password || !confirmPassword) {
        showMessage('Please fill in all fields');
        return;
    }
    
    if (password !== confirmPassword) {
        showMessage('Passwords do not match');
        return;
    }
    
    if (password.length < 6) {
        showMessage('Password must be at least 6 characters long');
        return;
    }
    
    try {
        setButtonLoading(submitButton, true);
        hideMessage();
        
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        
        // Send email verification
        await sendEmailVerification(userCredential.user);
        
        showMessage('Account created successfully! Please check your email to verify your account.', 'success');
        
        // Clear form
        registerFormElement.reset();
        
        // Switch to login form after a delay
        setTimeout(() => {
            showForm('login');
        }, 3000);
        
    } catch (error) {
        let errorMessage = 'Registration failed. Please try again.';
        
        switch (error.code) {
            case 'auth/email-already-in-use':
                errorMessage = 'An account with this email already exists.';
                break;
            case 'auth/invalid-email':
                errorMessage = 'Invalid email address.';
                break;
            case 'auth/weak-password':
                errorMessage = 'Password is too weak. Please choose a stronger password.';
                break;
            case 'auth/operation-not-allowed':
                errorMessage = 'Email/password accounts are not enabled.';
                break;
        }
        
        showMessage(errorMessage);
    } finally {
        setButtonLoading(submitButton, false);
    }
});

// Forgot password functionality
forgotPasswordFormElement.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('forgotEmail').value;
    const submitButton = e.target.querySelector('button[type="submit"]');
    
    if (!email) {
        showMessage('Please enter your email address');
        return;
    }
    
    try {
        setButtonLoading(submitButton, true);
        hideMessage();
        
        await sendPasswordResetEmail(auth, email);
        showMessage('Password reset email sent! Check your inbox.', 'success');
        
        // Clear form
        forgotPasswordFormElement.reset();
        
        // Switch to login form after a delay
        setTimeout(() => {
            showForm('login');
        }, 3000);
        
    } catch (error) {
        let errorMessage = 'Failed to send password reset email.';
        
        switch (error.code) {
            case 'auth/user-not-found':
                errorMessage = 'No account found with this email address.';
                break;
            case 'auth/invalid-email':
                errorMessage = 'Invalid email address.';
                break;
            case 'auth/too-many-requests':
                errorMessage = 'Too many requests. Please try again later.';
                break;
        }
        
        showMessage(errorMessage);
    } finally {
        setButtonLoading(submitButton, false);
    }
});

// Auth state observer
onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log('User is signed in:', user.email);
        // You can redirect to the main app here if needed
    } else {
        console.log('User is signed out');
    }
});