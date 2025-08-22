const express = require('express');
const cors = require('cors');
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { Sandbox } = require('@e2b/code-interpreter');
const admin = require('firebase-admin');

const app = express();
const port = process.env.SERVER_PORT || 3001;

// Initialize Firebase Admin SDK
let bucket;
function initializeFirebaseAdmin() {
    try {
        // Check if Firebase Admin is already initialized
        if (admin.apps.length > 0) {
            bucket = admin.storage().bucket();
            console.log('✅ Firebase Admin SDK already initialized');
            return;
        }

        // Try to use service account JSON file first
        const serviceAccountPath = './shopify-a-196e9-firebase-adminsdk-fbsvc-bb46976ef2.json';
        const fs = require('fs');
        
        try {
            if (fs.existsSync(serviceAccountPath)) {
                const serviceAccount = require(serviceAccountPath);
                
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                    storageBucket: 'shopify-a-196e9.firebasestorage.app'
                });
                
                bucket = admin.storage().bucket();
                console.log('✅ Firebase Admin SDK initialized with service account file');
                return;
            }
        } catch (fileError) {
            console.warn('Could not load service account file, trying environment variables...');
        }

        // Fallback to environment variables
        const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const storageBucket = process.env.VITE_FIREBASE_STORAGE_BUCKET;

        if (!projectId || !privateKey || !clientEmail || !storageBucket) {
            console.warn('⚠️  Firebase Admin SDK not configured - missing service account file or environment variables');
            console.warn('   Projects will not be saved to Firebase Storage');
            return;
        }

        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: projectId,
                privateKey: privateKey.replace(/\\n/g, '\n'),
                clientEmail: clientEmail,
            }),
            storageBucket: 'shopify-a-196e9.firebasestorage.app'
        });

        bucket = admin.storage().bucket();
        console.log('✅ Firebase Admin SDK initialized successfully');
        
    } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin SDK:', error);
        console.warn('   Projects will not be saved to Firebase Storage');
    }
}

// Generate unique project ID
function generateProjectId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Save project to Firebase Storage
async function saveProject(userId, projectData) {
    try {
        // Check if Firebase is available
        if (!bucket) {
            console.warn('⚠️  Firebase Storage not available - skipping project save');
            const projectId = generateProjectId();
            return { projectId, metadata: { id: projectId } };
        }

        const projectId = generateProjectId();
        const projectPath = `users/${userId}/projects/${projectId}`;
        
        // Create project metadata
        const metadata = {
            id: projectId,
            name: projectData.name || `Project ${projectId}`,
            description: projectData.description || '',
            prompt: projectData.prompt || '',
            createdAt: new Date().toISOString(),
            previewUrl: projectData.previewUrl || null,
            sandboxId: projectData.sandboxId || null
        };
        
        // Save metadata file
        const metadataFile = bucket.file(`${projectPath}/project.json`);
        await metadataFile.save(JSON.stringify(metadata, null, 2), {
            metadata: {
                contentType: 'application/json',
            }
        });
        
        // Save all code files
        for (const [filename, content] of Object.entries(projectData.files)) {
            const file = bucket.file(`${projectPath}/${filename}`);
            const contentType = getContentType(filename);
            
            await file.save(content, {
                metadata: {
                    contentType: contentType,
                }
            });
            console.log(`✅ Saved file: ${filename} to Firebase Storage`);
        }
        
        console.log(`✅ Project saved: ${projectId} for user ${userId}`);
        return { projectId, metadata };
        
    } catch (error) {
        console.error('❌ Failed to save project to Firebase Storage:', error);
        // Return a project ID even if saving fails
        const projectId = generateProjectId();
        return { projectId, metadata: { id: projectId } };
    }
}

// Get user's projects from Firebase Storage
async function getUserProjects(userId) {
    try {
        // Check if Firebase is available
        if (!bucket) {
            console.warn('⚠️  Firebase Storage not available - returning empty projects list');
            return [];
        }

        const userProjectsPath = `users/${userId}/projects/`;
        const [files] = await bucket.getFiles({
            prefix: userProjectsPath,
            delimiter: '/'
        });
        
        // Get project directories by finding project.json files
        const projectFiles = files.filter(file => file.name.endsWith('/project.json'));
        const projects = [];
        
        for (const projectFile of projectFiles) {
            try {
                const [content] = await projectFile.download();
                const metadata = JSON.parse(content.toString());
                projects.push(metadata);
            } catch (error) {
                console.warn(`Skipping invalid project file: ${projectFile.name}`);
            }
        }
        
        return projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
    } catch (error) {
        console.error('Failed to get user projects from Firebase Storage:', error);
        return [];
    }
}

// Helper function to determine content type
function getContentType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const contentTypes = {
        'js': 'application/javascript',
        'json': 'application/json',
        'html': 'text/html',
        'css': 'text/css',
        'txt': 'text/plain',
        'md': 'text/markdown'
    };
    return contentTypes[ext] || 'text/plain';
}

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());

// Simple authentication middleware
// In production, you would use Firebase Admin SDK to verify tokens
const authenticateUser = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Authentication required',
            message: 'Please provide a valid authentication token'
        });
    }
    
    // Extract token
    const token = authHeader.substring(7);
    
    // Basic token validation (in production, verify with Firebase Admin)
    if (!token || token.length < 10) {
        return res.status(401).json({
            error: 'Invalid token',
            message: 'Authentication token is invalid'
        });
    }
    
    // For now, just check that a token exists
    // In production: admin.auth().verifyIdToken(token)
    req.user = { token }; // Store token info for later use
    next();
};

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get user projects endpoint
app.get('/api/projects', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.token.substring(0, 10); // Use first 10 chars of token as user ID
        const projects = await getUserProjects(userId);
        
        res.json({
            success: true,
            projects: projects
        });
        
    } catch (error) {
        console.error('Error getting user projects:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve projects'
        });
    }
});

// Generate Shopify app code endpoint with E2B sandbox integration
app.post('/api/generate-code', authenticateUser, async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ 
                error: 'Prompt is required',
                message: 'Please provide a prompt for code generation'
            });
        }

        console.log('Generating code for prompt:', prompt);

        // Create a specialized system prompt for Shopify app development with E2B deployment
        const systemPrompt = `You are an expert Shopify app developer and code generator. Your task is to help users create Shopify apps that will be deployed in an E2B sandbox environment.

When generating code:
1. Create a simple, self-contained Node.js/Express web application
2. Structure the code to run as a single server.js file
3. Use Express.js for the web server
4. Include HTML content served directly from the server or as static files in the same directory
5. Make the app listen on port 3000
6. Focus on practical, working functionality
7. Ensure all dependencies are common packages (express, etc.)
8. IMPORTANT: If serving static files, use express.static(__dirname) to serve from the current directory, NOT from a 'public' subdirectory

For each request, provide:
1. A brief explanation of what the app does
2. The main server.js file code that serves content from the current directory
3. Any additional HTML/CSS/JS files needed (these will be in the same directory as server.js)
4. A package.json with dependencies
5. Clear structure that can be deployed and run immediately

The app should be ready to run with:
- npm install
- node server.js

Example structure:
\`\`\`javascript
// server.js
const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Serve static files from current directory
app.use(express.static(__dirname));

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(\`App running at http://localhost:\${port}\`);
});
\`\`\`

Focus on creating simple, working web applications that serve files from the same directory as server.js.`;

        const message = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 4000,
            temperature: 0.7,
            system: systemPrompt,
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        const generatedCode = message.content[0].text;
        console.log('Code generation completed successfully');

        // Create E2B sandbox and deploy the code
        console.log('Creating E2B sandbox...');
        const sandbox = await Sandbox.create();
        
        try {
            // Extract and deploy the generated code files to the sandbox
            const codeBlocks = await deployCodeToSandbox(sandbox, generatedCode);
            
            // Verify files were deployed correctly
            console.log('Verifying deployed files...');
            const listFiles = await sandbox.commands.run('ls -la /tmp/app');
            console.log('Files in /tmp/app:', listFiles.stdout);
            
            // Start the web server in the sandbox
            console.log('Starting web server in sandbox...');
            const serverProcess = await sandbox.commands.run('cd /tmp/app && npm install && node server.js', { 
                background: true 
            });
            
            // Wait a moment for the server to start
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Get the public URL for the sandbox
            const previewUrl = `https://${sandbox.getHost(3000)}`;
            console.log('Sandbox deployed successfully at:', previewUrl);

            // Save project to filesystem
            console.log('Saving project to filesystem...');
            const userId = req.user.token.substring(0, 10); // Use first 10 chars of token as user ID for now
            const projectData = {
                name: generateProjectName(prompt),
                description: `Generated from prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`,
                prompt: prompt,
                files: codeBlocks,
                previewUrl: previewUrl,
                sandboxId: sandbox.id
            };
            
            const savedProject = await saveProject(userId, projectData);
            console.log(`✅ Project saved with ID: ${savedProject.projectId}`);

            res.json({
                success: true,
                response: generatedCode,
                previewUrl: previewUrl,
                sandboxId: sandbox.id,
                projectId: savedProject.projectId,
                usage: {
                    input_tokens: message.usage.input_tokens,
                    output_tokens: message.usage.output_tokens
                }
            });

        } catch (deployError) {
            console.error('Error deploying to sandbox:', deployError);
            // If deployment fails, still return the generated code
            res.json({
                success: true,
                response: generatedCode,
                previewUrl: null,
                error: 'Failed to deploy to sandbox',
                usage: {
                    input_tokens: message.usage.input_tokens,
                    output_tokens: message.usage.output_tokens
                }
            });
        }

    } catch (error) {
        console.error('Error generating code:', error);
        
        // Handle different types of errors
        if (error.status === 401) {
            return res.status(401).json({
                error: 'Authentication failed',
                message: 'Invalid API key. Please check your Anthropic API key.'
            });
        }
        
        if (error.status === 429) {
            return res.status(429).json({
                error: 'Rate limit exceeded',
                message: 'Too many requests. Please try again later.'
            });
        }

        if (error.status === 400) {
            return res.status(400).json({
                error: 'Bad request',
                message: error.message || 'Invalid request parameters.'
            });
        }

        // Generic error response
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to generate code. Please try again.'
        });
    }
});

// Generate project name from prompt
function generateProjectName(prompt) {
    // Extract key words and create a meaningful project name
    const words = prompt.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 2 && !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'man', 'try', 'make', 'app', 'website', 'create'].includes(word))
        .slice(0, 3);
    
    if (words.length === 0) {
        return 'Shopify App';
    }
    
    return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') + ' App';
}

// Helper function to deploy generated code to E2B sandbox
async function deployCodeToSandbox(sandbox, generatedCode) {
    console.log('Deploying code to sandbox...');
    
    // Create app directory
    await sandbox.commands.run('mkdir -p /tmp/app');
    
    // Extract code blocks from the generated response
    const codeBlocks = extractCodeBlocks(generatedCode);
    console.log('Extracted code blocks:', Object.keys(codeBlocks));
    
    // Deploy each file to the sandbox
    for (const [filename, content] of Object.entries(codeBlocks)) {
        console.log(`Writing file: ${filename} (${content.length} chars)`);
        await sandbox.files.write(`/tmp/app/${filename}`, content);
    }
    
    // Ensure we have a basic package.json if not provided
    if (!codeBlocks['package.json']) {
        const basicPackageJson = {
            "name": "shopify-app",
            "version": "1.0.0",
            "main": "server.js",
            "dependencies": {
                "express": "^4.18.2"
            }
        };
        const packageJsonContent = JSON.stringify(basicPackageJson, null, 2);
        await sandbox.files.write('/tmp/app/package.json', packageJsonContent);
        codeBlocks['package.json'] = packageJsonContent;
    }
    
    return codeBlocks;
}

// Helper function to extract code blocks from generated response
function extractCodeBlocks(generatedCode) {
    const files = {};
    
    // Look for code blocks with filenames (```javascript // server.js)
    const codeBlockRegex = /```(?:javascript|js|json|html|css)?\s*(?:\/\/\s*(.+?))?[\r\n]([\s\S]*?)```/gi;
    let match;
    
    while ((match = codeBlockRegex.exec(generatedCode)) !== null) {
        let filename = match[1] ? match[1].trim() : null;
        const content = match[2].trim();
        
        // Try to infer filename from content if not specified
        if (!filename) {
            if (content.includes('const express = require') || content.includes('app.listen')) {
                filename = 'server.js';
            } else if (content.includes('"name":') && content.includes('"dependencies"')) {
                filename = 'package.json';
            } else if (content.includes('<!DOCTYPE html>') || content.includes('<html')) {
                filename = 'index.html';
            } else if (content.includes('body {') || content.includes('.')) {
                filename = 'styles.css';
            } else {
                filename = `file_${Object.keys(files).length}.js`;
            }
        }
        
        files[filename] = content;
    }
    
    return files;
}

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: 'Something went wrong on the server.'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: 'The requested endpoint does not exist.'
    });
});

// Start server
app.listen(port, async () => {
    console.log(`🚀 Shopify AI App Builder server running on port ${port}`);
    console.log(`🔗 Health check: http://localhost:${port}/health`);
    
    // Initialize Firebase Admin SDK
    initializeFirebaseAdmin();
    
    // Validate API keys on startup
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('⚠️  WARNING: ANTHROPIC_API_KEY not found in environment variables!');
        console.error('   Please add your Claude API key to the .env file.');
    } else if (process.env.ANTHROPIC_API_KEY.startsWith('your-')) {
        console.error('⚠️  WARNING: Please replace the placeholder API key in .env with your actual Anthropic API key.');
    } else {
        console.log('✅ Anthropic API key loaded successfully');
    }
    
    if (!process.env.E2B_API_KEY) {
        console.error('⚠️  WARNING: E2B_API_KEY not found in environment variables!');
        console.error('   Please add your E2B API key to the .env file.');
        console.error('   Get your E2B API key at: https://e2b.dev/dashboard');
    } else if (process.env.E2B_API_KEY.startsWith('your-')) {
        console.error('⚠️  WARNING: Please replace the placeholder E2B API key in .env with your actual E2B API key.');
        console.error('   Get your E2B API key at: https://e2b.dev/dashboard');
    } else {
        console.log('✅ E2B API key loaded successfully');
    }
    
    // Validate Firebase configuration
    if (!process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
        console.warn('⚠️  WARNING: Firebase Admin SDK credentials not found!');
        console.warn('   Please add FIREBASE_PRIVATE_KEY and FIREBASE_CLIENT_EMAIL to .env file');
        console.warn('   Get these from Firebase Console > Project Settings > Service Accounts');
        console.warn('   Projects will not be saved without Firebase configuration');
    } else if (process.env.FIREBASE_PRIVATE_KEY.includes('your-')) {
        console.warn('⚠️  WARNING: Please replace placeholder Firebase credentials with actual values');
    } else {
        console.log('✅ Firebase credentials configured');
    }
});

module.exports = app;