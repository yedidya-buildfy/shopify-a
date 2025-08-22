// Import Firebase Auth functions
import { signOut, onAuthStateChanged, getIdToken } from 'firebase/auth';
import { auth } from './firebase-config.js';

// DOM elements
const promptInput = document.getElementById('promptInput');
const sendButton = document.getElementById('sendButton');
const sideNavLogoutButton = document.getElementById('sideNavLogout');
const sideNavTrigger = document.querySelector('.side-nav-trigger');
const sideNav = document.getElementById('sideNav');
const projectsList = document.getElementById('projectsList');
const projectsPlaceholder = document.getElementById('projectsPlaceholder');
const heroSection = document.getElementById('heroSection');
const resultsSection = document.getElementById('resultsSection');
const codeOutput = document.getElementById('codeOutput');
const loadingState = document.getElementById('loadingState');
const newAppButton = document.getElementById('newAppButton');
const copyCodeButton = document.getElementById('copyCodeButton');
const previewButton = document.getElementById('previewButton');
const dashboardContainer = document.querySelector('.dashboard-container');

// API configuration
const API_BASE_URL = 'http://localhost:3001/api';

// Global state
let currentUser = null;
let isGenerating = false;
let currentPreviewUrl = null;
let currentSandboxId = null;
let userProjects = [];
let isLoadingProject = false;

// Auto-resize textarea
function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

// Initialize textarea auto-resize
promptInput.addEventListener('input', () => {
    autoResizeTextarea(promptInput);
    
    // Enable/disable send button based on content
    const hasContent = promptInput.value.trim().length > 0;
    sendButton.disabled = !hasContent || isGenerating;
    
    if (hasContent && !isGenerating) {
        sendButton.style.opacity = '1';
    } else {
        sendButton.style.opacity = '0.5';
    }
});

// Handle Enter key (send on Enter, new line on Shift+Enter)
promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendPrompt();
    }
});

// Send prompt handler
async function handleSendPrompt() {
    const prompt = promptInput.value.trim();
    
    if (!prompt || isGenerating || !currentUser) return;
    
    try {
        isGenerating = true;
        
        // Show loading state
        showResultsSection();
        showLoadingState();
        
        // Disable send button and show loading
        sendButton.disabled = true;
        sendButton.innerHTML = `
            <div class="loading-spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>
        `;
        
        // Get Firebase ID token for authentication
        const idToken = await getIdToken(currentUser);
        
        // Make API call to generate code
        const response = await fetch(`${API_BASE_URL}/generate-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ prompt })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.message || 'Failed to generate code');
        }
        
        // Display the generated code and handle sandbox response
        displayGeneratedCode(result.response);
        
        // Handle preview URL if sandbox was created successfully
        if (result.previewUrl) {
            currentPreviewUrl = result.previewUrl;
            currentSandboxId = result.sandboxId;
            showPreviewButton();
        } else {
            hidePreviewButton();
            if (result.error) {
                console.warn('Sandbox deployment failed:', result.error);
            }
        }
        
        // Clear the input
        promptInput.value = '';
        autoResizeTextarea(promptInput);
        
        console.log('Code generation successful:', result);
        
        // Refresh projects list if a new project was created
        if (result.projectId) {
            loadUserProjects();
        }
        
    } catch (error) {
        console.error('Error generating code:', error);
        showErrorState(error.message);
    } finally {
        isGenerating = false;
        
        // Reset send button
        sendButton.disabled = false;
        sendButton.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22,2 15,22 11,13 2,9"></polygon>
            </svg>
        `;
    }
}

// Show results section
function showResultsSection() {
    dashboardContainer.classList.add('showing-results');
    resultsSection.style.display = 'block';
}

// Show loading state
function showLoadingState() {
    codeOutput.innerHTML = `
        <div class="loading-state" id="loadingState">
            <div class="loading-spinner"></div>
            <p>AI is generating your Shopify app...</p>
        </div>
    `;
}

// Display generated code
function displayGeneratedCode(code) {
    codeOutput.innerHTML = `
        <div class="code-content">
            ${formatCodeForDisplay(code)}
        </div>
    `;
}

// Show error state
function showErrorState(errorMessage) {
    codeOutput.innerHTML = `
        <div class="error-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <h3>Generation Failed</h3>
            <p>${errorMessage}</p>
            <button class="retry-button" onclick="handleRetry()">Try Again</button>
        </div>
    `;
}

// Format code for display (basic formatting)
function formatCodeForDisplay(code) {
    return code
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/  /g, '&nbsp;&nbsp;');
}

// Show preview button
function showPreviewButton() {
    previewButton.style.display = 'inline-flex';
}

// Hide preview button
function hidePreviewButton() {
    previewButton.style.display = 'none';
    currentPreviewUrl = null;
    currentSandboxId = null;
}

// Handle retry
function handleRetry() {
    dashboardContainer.classList.remove('showing-results');
    resultsSection.style.display = 'none';
    hidePreviewButton();
    promptInput.focus();
}

// New app button handler
newAppButton.addEventListener('click', handleRetry);

// Preview button click handler
previewButton.addEventListener('click', () => {
    if (currentPreviewUrl) {
        // Open the sandbox preview in a new tab
        window.open(currentPreviewUrl, '_blank');
    } else {
        console.warn('No preview URL available');
        alert('Preview not available. The sandbox may not have deployed successfully.');
    }
});

// Copy code button handler
copyCodeButton.addEventListener('click', async () => {
    const codeContent = codeOutput.querySelector('.code-content');
    if (codeContent) {
        try {
            const textContent = codeContent.textContent || codeContent.innerText;
            await navigator.clipboard.writeText(textContent);
            
            // Show success feedback
            const originalText = copyCodeButton.innerHTML;
            copyCodeButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20,6 9,17 4,12"></polyline>
                </svg>
                Copied!
            `;
            
            setTimeout(() => {
                copyCodeButton.innerHTML = originalText;
            }, 2000);
            
        } catch (error) {
            console.error('Failed to copy code:', error);
            alert('Failed to copy code to clipboard');
        }
    }
});

// Send button click handler
sendButton.addEventListener('click', handleSendPrompt);

// Logout functionality
const handleLogout = async () => {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
        alert('Failed to logout. Please try again.');
    }
};

sideNavLogoutButton.addEventListener('click', handleLogout);

// Side Navigation hover functionality
let sideNavTimer = null;

function showSideNav() {
    clearTimeout(sideNavTimer);
    sideNav.classList.add('show');
}

function hideSideNav() {
    sideNavTimer = setTimeout(() => {
        sideNav.classList.remove('show');
    }, 300); // Small delay to prevent flickering
}

// Event listeners for side navigation
sideNavTrigger.addEventListener('mouseenter', showSideNav);
sideNavTrigger.addEventListener('mouseleave', hideSideNav);
sideNav.addEventListener('mouseenter', showSideNav);
sideNav.addEventListener('mouseleave', hideSideNav);

// Additional safety: Check mouse position periodically
let mouseCheckInterval = null;

function startMouseTracking() {
    mouseCheckInterval = setInterval(() => {
        // Only track when side nav is visible
        if (sideNav.classList.contains('show')) {
            const rect = sideNav.getBoundingClientRect();
            const triggerRect = sideNavTrigger.getBoundingClientRect();
            
            // Get current mouse position (if available)
            if (window.lastMouseX !== undefined && window.lastMouseY !== undefined) {
                const isOverNav = window.lastMouseX >= 0 && window.lastMouseX <= rect.right && 
                                window.lastMouseY >= 0 && window.lastMouseY <= window.innerHeight;
                const isOverTrigger = window.lastMouseX >= triggerRect.left && window.lastMouseX <= triggerRect.right &&
                                    window.lastMouseY >= triggerRect.top && window.lastMouseY <= triggerRect.bottom;
                
                if (!isOverNav && !isOverTrigger) {
                    hideSideNav();
                }
            }
        }
    }, 100);
}

// Track mouse position globally
document.addEventListener('mousemove', (e) => {
    window.lastMouseX = e.clientX;
    window.lastMouseY = e.clientY;
});

// Start mouse tracking
startMouseTracking();

// Project Management Functions
async function loadUserProjects() {
    try {
        if (!currentUser) {
            console.log('No current user, cannot load projects');
            return;
        }
        
        console.log('Loading projects for user:', currentUser.email);
        const idToken = await getIdToken(currentUser);
        console.log('Got Firebase ID token, length:', idToken.length);
        
        const response = await fetch(`${API_BASE_URL}/projects`, {
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });
        
        const result = await response.json();
        console.log('Projects API response:', result);
        
        if (response.ok) {
            userProjects = result.projects || [];
            console.log('Loaded', userProjects.length, 'projects');
            displayProjects();
        } else {
            console.error('Failed to load projects:', result.message);
            showProjectsError('Failed to load projects');
        }
        
    } catch (error) {
        console.error('Error loading projects:', error);
        showProjectsError('Error loading projects');
    }
}

function displayProjects() {
    if (userProjects.length === 0) {
        projectsPlaceholder.innerHTML = `
            <span>No projects yet</span>
            <small>Create your first Shopify app!</small>
        `;
        return;
    }
    
    // Hide placeholder
    projectsPlaceholder.style.display = 'none';
    
    // Clear existing projects
    const existingProjects = projectsList.querySelectorAll('.project-item');
    existingProjects.forEach(item => item.remove());
    
    // Add each project
    userProjects.forEach(project => {
        const projectElement = createProjectElement(project);
        projectsList.appendChild(projectElement);
    });
}

function createProjectElement(project) {
    const projectDiv = document.createElement('div');
    projectDiv.className = 'project-item';
    projectDiv.dataset.projectId = project.id;
    
    const createdDate = new Date(project.createdAt).toLocaleDateString();
    
    projectDiv.innerHTML = `
        <div class="project-name">${project.name}</div>
        <div class="project-description">${project.description}</div>
        <div class="project-date">${createdDate}</div>
        <div class="project-loading-overlay">
            <div class="loading-spinner small"></div>
        </div>
    `;
    
    // Add click handler
    projectDiv.addEventListener('click', () => loadProject(project.id));
    
    return projectDiv;
}

function showProjectsError(message) {
    projectsPlaceholder.innerHTML = `
        <span>⚠️ ${message}</span>
        <button id="retryProjectsBtn" style="margin-top: 8px; padding: 4px 8px; background: var(--shopify-green); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
            Retry
        </button>
    `;
    
    // Add event listener to retry button
    const retryBtn = document.getElementById('retryProjectsBtn');
    if (retryBtn) {
        retryBtn.addEventListener('click', loadUserProjects);
    }
}

async function loadProject(projectId) {
    if (isLoadingProject || !currentUser) return;
    
    try {
        isLoadingProject = true;
        
        // Show loading state on the project item
        const projectElement = document.querySelector(`[data-project-id="${projectId}"]`);
        if (projectElement) {
            projectElement.classList.add('loading');
        }
        
        // Show loading state in results section
        showResultsSection();
        showLoadingState();
        
        const idToken = await getIdToken(currentUser);
        const response = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.message || 'Failed to load project');
        }
        
        const project = result.project;
        
        // Display the project code
        const codeContent = Object.entries(project.files || {})
            .map(([filename, content]) => `// ${filename}\n${content}`)
            .join('\n\n');
        
        displayGeneratedCode(codeContent);
        
        // Update preview button and URLs
        if (project.previewUrl) {
            currentPreviewUrl = project.previewUrl;
            currentSandboxId = project.sandboxId;
            showPreviewButton();
        } else {
            hidePreviewButton();
        }
        
        console.log('Project loaded successfully:', project.name);
        
    } catch (error) {
        console.error('Error loading project:', error);
        showErrorState(error.message);
    } finally {
        isLoadingProject = false;
        
        // Remove loading state from project item
        const projectElement = document.querySelector(`[data-project-id="${projectId}"]`);
        if (projectElement) {
            projectElement.classList.remove('loading');
        }
    }
}

// Auth state observer - redirect if not authenticated
onAuthStateChanged(auth, (user) => {
    if (!user) {
        // User is not logged in, redirect to login page
        window.location.href = 'index.html';
    } else {
        currentUser = user;
        console.log('User authenticated:', user.email);
        
        // Load user projects
        loadUserProjects();
    }
});

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
    // Set initial button state
    sendButton.disabled = true;
    sendButton.style.opacity = '0.5';
    
    // Focus on input
    promptInput.focus();
    
    // Check if server is running
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
        }
    } catch (error) {
        console.error('❌ Server is not running. Please start the server with: npm run dev');
        showServerError();
    }
}

// Show server error
function showServerError() {
    // You could show a notification here that the server is not running
    console.log('Make sure to run: npm run dev');
}

// Add loading spinner animation styles
const style = document.createElement('style');
style.textContent = `
    .loading-spinner {
        animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);