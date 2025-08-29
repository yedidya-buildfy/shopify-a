// Import Firebase Auth functions
import { onAuthStateChanged, getIdToken } from 'firebase/auth';
import { auth } from './firebase-config.js';

// API configuration
const API_BASE_URL = 'http://localhost:3001/api';

// DOM elements
const appNameInput = document.getElementById('appName');
const createAppButton = document.getElementById('createAppButton');
const appNameSection = document.getElementById('appNameSection');
const progressSection = document.getElementById('progressSection');
const authSection = document.getElementById('authSection');
const successSection = document.getElementById('successSection');
const errorSection = document.getElementById('errorSection');
const loadingOverlay = document.getElementById('loadingOverlay');

// Progress elements
const progressTitle = document.getElementById('progressTitle');
const progressDescription = document.getElementById('progressDescription');
const stepInit = document.getElementById('step-init');
const stepAuth = document.getElementById('step-auth');
const stepComplete = document.getElementById('step-complete');
const toggleOutputButton = document.getElementById('toggleOutput');
const cliOutput = document.getElementById('cliOutput');
const outputContent = document.getElementById('outputContent');

// Auth elements
const authLink = document.getElementById('authLink');
const authWaiting = document.getElementById('authWaiting');

// Success elements
const goToDashboard = document.getElementById('goToDashboard');
const finalAppName = document.getElementById('finalAppName');
const creationDate = document.getElementById('creationDate');

// Error elements
const errorMessage = document.getElementById('errorMessage');
const errorDetails = document.getElementById('errorDetails');
const errorDetailsContent = document.getElementById('errorDetailsContent');
const retryButton = document.getElementById('retryButton');
const skipTodashboard = document.getElementById('skipTodashboard');
const showErrorDetails = document.getElementById('showErrorDetails');

// Global state
let currentUser = null;
let currentJobId = null;
let statusPollingInterval = null;
let isPolling = false;
let appCreationStartTime = null;

// Utility functions
function showSection(section) {
    // Hide all sections
    [appNameSection, progressSection, authSection, successSection, errorSection].forEach(s => {
        s.style.display = 'none';
    });
    // Show the requested section
    section.style.display = 'block';
}

function updateProgressStep(stepElement, status, statusText, errorText = null) {
    // Remove all status classes
    stepElement.classList.remove('active', 'completed', 'error');
    
    // Add new status class
    stepElement.classList.add(status);
    
    // Update status text
    const stepStatusElement = stepElement.querySelector('.step-status');
    if (status === 'error' && errorText) {
        stepStatusElement.textContent = errorText;
        stepStatusElement.style.color = 'var(--error-color)';
    } else {
        stepStatusElement.textContent = statusText;
        stepStatusElement.style.color = status === 'completed' ? 'var(--success-color)' : '';
    }
}

function appendToOutput(text) {
    const line = document.createElement('div');
    line.className = 'output-line';
    line.textContent = text;
    outputContent.appendChild(line);
    
    // Auto-scroll to bottom
    cliOutput.scrollTop = cliOutput.scrollHeight;
}

function clearOutput() {
    outputContent.innerHTML = '<div class="output-line">Starting Shopify CLI...</div>';
}

function validateAppName(name) {
    // Allow letters, numbers, spaces, and dashes
    const validPattern = /^[a-zA-Z0-9\s\-]+$/;
    return validPattern.test(name) && name.trim().length > 0;
}

// Event handlers
appNameInput.addEventListener('input', () => {
    const name = appNameInput.value.trim();
    const isValid = validateAppName(name);
    
    createAppButton.disabled = !isValid;
    
    if (name && !isValid) {
        appNameInput.style.borderColor = 'var(--error-color)';
    } else {
        appNameInput.style.borderColor = '';
    }
});

createAppButton.addEventListener('click', handleCreateApp);
toggleOutputButton.addEventListener('click', toggleOutput);
goToDashboard.addEventListener('click', () => window.location.href = 'dashboard.html');
retryButton.addEventListener('click', handleRetry);
skipTodashboard.addEventListener('click', () => window.location.href = 'dashboard.html');
showErrorDetails.addEventListener('click', toggleErrorDetails);

// Main functions
async function handleCreateApp() {
    const appName = appNameInput.value.trim();
    
    if (!appName || !validateAppName(appName) || !currentUser) {
        return;
    }
    
    try {
        createAppButton.disabled = true;
        loadingOverlay.style.display = 'flex';
        
        // Get Firebase ID token
        const idToken = await getIdToken(currentUser);
        
        // Start app creation
        const response = await fetch(`${API_BASE_URL}/create-shopify-app`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ appName })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.message || 'Failed to start app creation');
        }
        
        // Store job ID and start polling
        currentJobId = result.jobId;
        appCreationStartTime = new Date();
        
        // Switch to progress view
        loadingOverlay.style.display = 'none';
        showSection(progressSection);
        clearOutput();
        
        // Start status polling
        startStatusPolling();
        
        console.log('App creation started with job ID:', currentJobId);
        
    } catch (error) {
        console.error('Error starting app creation:', error);
        loadingOverlay.style.display = 'none';
        showError('Failed to Start App Creation', error.message);
    } finally {
        createAppButton.disabled = false;
    }
}

function startStatusPolling() {
    if (isPolling || !currentJobId) return;
    
    isPolling = true;
    updateProgressStep(stepInit, 'active', 'Initializing Shopify CLI...');
    
    statusPollingInterval = setInterval(async () => {
        try {
            await checkAppCreationStatus();
        } catch (error) {
            console.error('Polling error:', error);
            // Continue polling on errors, but stop after too many failures
        }
    }, 3000); // Poll every 3 seconds
    
    // Also check immediately
    checkAppCreationStatus();
}

async function checkAppCreationStatus() {
    if (!currentJobId || !currentUser) return;
    
    try {
        const idToken = await getIdToken(currentUser);
        const response = await fetch(`${API_BASE_URL}/app-creation-status/${currentJobId}`, {
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.message || 'Failed to get status');
        }
        
        // Update progress based on status
        updateProgressUI(result);
        
    } catch (error) {
        console.error('Error checking app creation status:', error);
        // Don't show error immediately - might be temporary network issue
    }
}

function updateProgressUI(statusData) {
    const { status, stage, output, authUrl, error, appData } = statusData;
    
    // Update output if new content
    if (output && output.length > 0) {
        output.forEach(line => appendToOutput(line));
    }
    
    // Update progress based on stage
    switch (stage) {
        case 'initializing':
            updateProgressStep(stepInit, 'active', 'Initializing Shopify CLI...');
            progressTitle.textContent = 'Initializing Shopify CLI...';
            progressDescription.textContent = 'Setting up your development environment. This may take 5-15 minutes.';
            break;
            
        case 'creating':
            updateProgressStep(stepInit, 'active', 'Creating app project...');
            progressTitle.textContent = 'Creating Shopify App...';
            progressDescription.textContent = 'Generating TypeScript React template and dependencies.';
            break;
            
        case 'waiting_auth':
            updateProgressStep(stepInit, 'completed', 'CLI initialized successfully');
            updateProgressStep(stepAuth, 'active', 'Waiting for authentication...');
            progressTitle.textContent = 'Authentication Required';
            progressDescription.textContent = 'Please authenticate with Shopify Partners to continue.';
            
            // Show auth section with link
            if (authUrl) {
                showAuthSection(authUrl);
            }
            break;
            
        case 'authenticating':
            updateProgressStep(stepAuth, 'active', 'Authentication in progress...');
            progressTitle.textContent = 'Processing Authentication...';
            progressDescription.textContent = 'Completing authentication with Shopify Partners.';
            break;
            
        case 'finalizing':
            updateProgressStep(stepAuth, 'completed', 'Authentication successful');
            updateProgressStep(stepComplete, 'active', 'Finalizing app setup...');
            progressTitle.textContent = 'Finalizing Setup...';
            progressDescription.textContent = 'Completing app configuration and setup.';
            break;
            
        case 'completed':
            stopStatusPolling();
            updateProgressStep(stepComplete, 'completed', 'Setup completed successfully');
            showSuccess(appData);
            break;
            
        case 'failed':
        case 'error':
            stopStatusPolling();
            updateProgressStep(
                getCurrentActiveStep(), 
                'error', 
                'Setup failed', 
                error || 'An error occurred during setup'
            );
            showError('App Creation Failed', error || 'An unexpected error occurred during app creation.');
            break;
    }
}

function getCurrentActiveStep() {
    if (stepComplete.classList.contains('active')) return stepComplete;
    if (stepAuth.classList.contains('active')) return stepAuth;
    return stepInit;
}

function showAuthSection(authUrl) {
    // Hide auth waiting, show auth link
    authWaiting.style.display = 'none';
    authLink.style.display = 'inline-flex';
    authLink.href = authUrl;
    
    // Show auth section
    showSection(authSection);
    
    // Add click handler to track when user clicks auth link
    authLink.addEventListener('click', () => {
        // Update UI to show we're waiting for auth completion
        authLink.style.display = 'none';
        authWaiting.innerHTML = `
            <div class="loading-spinner small"></div>
            <span>Waiting for authentication completion...</span>
        `;
        authWaiting.style.display = 'flex';
    });
}

function showSuccess(appData) {
    // Update success details
    if (appData) {
        finalAppName.textContent = appData.name || 'Unknown';
        creationDate.textContent = new Date().toLocaleDateString();
    }
    
    // Calculate total time
    if (appCreationStartTime) {
        const totalTime = Math.round((new Date() - appCreationStartTime) / 1000);
        const minutes = Math.floor(totalTime / 60);
        const seconds = totalTime % 60;
        console.log(`App creation completed in ${minutes}m ${seconds}s`);
    }
    
    showSection(successSection);
}

function showError(title, message, details = null) {
    errorMessage.textContent = message;
    
    if (details) {
        errorDetailsContent.textContent = details;
        errorDetails.style.display = 'block';
        showErrorDetails.style.display = 'inline-block';
    } else {
        errorDetails.style.display = 'none';
        showErrorDetails.style.display = 'none';
    }
    
    showSection(errorSection);
}

function stopStatusPolling() {
    if (statusPollingInterval) {
        clearInterval(statusPollingInterval);
        statusPollingInterval = null;
    }
    isPolling = false;
}

function handleRetry() {
    // Reset state
    currentJobId = null;
    appCreationStartTime = null;
    stopStatusPolling();
    
    // Reset UI
    clearOutput();
    authWaiting.style.display = 'flex';
    authLink.style.display = 'none';
    
    // Reset progress steps
    updateProgressStep(stepInit, '', 'Waiting to start...');
    updateProgressStep(stepAuth, '', 'Waiting for previous steps...');
    updateProgressStep(stepComplete, '', 'Waiting for previous steps...');
    
    // Show initial section
    showSection(appNameSection);
    appNameInput.focus();
}

function toggleOutput() {
    const isVisible = cliOutput.style.display !== 'none';
    cliOutput.style.display = isVisible ? 'none' : 'block';
    toggleOutputButton.textContent = isVisible ? 'Show Details' : 'Hide Details';
}

function toggleErrorDetails() {
    const isVisible = errorDetails.style.display !== 'none';
    errorDetails.style.display = isVisible ? 'none' : 'block';
    showErrorDetails.textContent = isVisible ? 'Show Details' : 'Hide Details';
}

// Check for resuming jobs on page load
async function checkForResumeJob() {
    // Check if there's a job ID in localStorage (for page refreshes)
    const resumeJobId = localStorage.getItem('shopify-app-creation-job');
    const resumeAppName = localStorage.getItem('shopify-app-creation-name');
    
    if (resumeJobId && currentUser) {
        try {
            console.log('Attempting to resume job:', resumeJobId);
            
            // Check if job is still active
            const idToken = await getIdToken(currentUser);
            const response = await fetch(`${API_BASE_URL}/app-creation-status/${resumeJobId}`, {
                headers: {
                    'Authorization': `Bearer ${idToken}`
                }
            });
            
            const result = await response.json();
            
            if (response.ok && (result.status === 'running' || result.status === 'waiting_auth')) {
                // Resume the job
                currentJobId = resumeJobId;
                appNameInput.value = resumeAppName || '';
                showSection(progressSection);
                clearOutput();
                startStatusPolling();
                console.log('Resumed job successfully');
            } else {
                // Job completed or failed, clear stored data
                localStorage.removeItem('shopify-app-creation-job');
                localStorage.removeItem('shopify-app-creation-name');
            }
        } catch (error) {
            console.error('Error resuming job:', error);
            localStorage.removeItem('shopify-app-creation-job');
            localStorage.removeItem('shopify-app-creation-name');
        }
    }
}

// Store job data for page refresh recovery
function storeJobData(jobId, appName) {
    localStorage.setItem('shopify-app-creation-job', jobId);
    localStorage.setItem('shopify-app-creation-name', appName);
}

// Clear job data when completed
function clearJobData() {
    localStorage.removeItem('shopify-app-creation-job');
    localStorage.removeItem('shopify-app-creation-name');
}

// Auth state observer
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        // User is not logged in, redirect to login page
        window.location.href = 'index.html';
    } else {
        currentUser = user;
        console.log('User authenticated:', user.email);
        
        // Check for existing jobs to resume
        await checkForResumeJob();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopStatusPolling();
    
    // Store current job data if in progress
    if (currentJobId && appNameInput.value.trim()) {
        storeJobData(currentJobId, appNameInput.value.trim());
    }
});

// Override global functions to handle job completion
window.addEventListener('storage', (e) => {
    if (e.key === 'shopify-app-creation-completed') {
        clearJobData();
        stopStatusPolling();
    }
});

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    // Focus on app name input
    appNameInput.focus();
    
    // Set up initial state
    createAppButton.disabled = true;
    
    // Check server health
    checkServerHealth();
});

// Check server health
async function checkServerHealth() {
    try {
        const response = await fetch(`${API_BASE_URL.replace('/api', '')}/health`);
        if (response.ok) {
            console.log('✅ Server is running');
        } else {
            console.warn('⚠️  Server responded with error');
            showError('Server Error', 'The server is not responding correctly. Please try again later.');
        }
    } catch (error) {
        console.error('❌ Server is not running:', error);
        showError('Server Unavailable', 'Cannot connect to the server. Please make sure the server is running and try again.');
    }
}