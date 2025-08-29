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
                privateKey: privateKey,
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

// Get a specific project from Firebase Storage
async function getProject(userId, projectId) {
    try {
        // Check if Firebase is available
        if (!bucket) {
            console.warn('⚠️  Firebase Storage not available');
            return null;
        }

        const projectPath = `users/${userId}/projects/${projectId}/project.json`;
        const projectFile = bucket.file(projectPath);
        
        // Check if project exists
        const [exists] = await projectFile.exists();
        if (!exists) {
            return null;
        }
        
        // Get project metadata
        const [content] = await projectFile.download();
        const metadata = JSON.parse(content.toString());
        
        // Get all project files
        const projectFilesPath = `users/${userId}/projects/${projectId}/`;
        const [files] = await bucket.getFiles({
            prefix: projectFilesPath
        });
        
        const projectFiles = {};
        for (const file of files) {
            const filename = file.name.replace(projectFilesPath, '');
            if (filename && filename !== 'project.json') {
                try {
                    const [fileContent] = await file.download();
                    projectFiles[filename] = fileContent.toString();
                } catch (error) {
                    console.warn(`Failed to load file ${filename}:`, error);
                }
            }
        }
        
        // Add files to metadata
        metadata.files = projectFiles;
        
        return metadata;
        
    } catch (error) {
        console.error('Failed to get project from Firebase Storage:', error);
        return null;
    }
}

// Deploy project files to E2B sandbox
async function deployProjectToSandbox(sandbox, projectFiles) {
    console.log('Deploying project files to sandbox...');
    
    // Create app directory
    await sandbox.commands.run('mkdir -p /tmp/app');
    
    // Deploy each file to the sandbox
    for (const [filename, content] of Object.entries(projectFiles)) {
        console.log(`Writing file: ${filename} (${content.length} chars)`);
        await sandbox.files.write(`/tmp/app/${filename}`, content);
    }
    
    // Ensure we have a basic package.json if not provided
    if (!projectFiles['package.json']) {
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
    }
}

// Get user's projects from Firebase Storage
async function getUserProjects(userId) {
    try {
        console.log(`🔍 Looking for projects for user: ${userId}`);
        
        // Check if Firebase is available
        if (!bucket) {
            console.warn('⚠️  Firebase Storage not available - returning empty projects list');
            return [];
        }

        const userProjectsPath = `users/${userId}/projects/`;
        console.log(`🔍 Searching path: ${userProjectsPath}`);
        
        const [files] = await bucket.getFiles({
            prefix: userProjectsPath
        });
        
        console.log(`🔍 Found ${files.length} files in user directory`);
        files.forEach(file => console.log(`  - ${file.name}`));
        
        // Get project directories by finding project.json files
        const projectFiles = files.filter(file => file.name.endsWith('/project.json'));
        console.log(`🔍 Found ${projectFiles.length} project.json files`);
        
        const projects = [];
        
        for (const projectFile of projectFiles) {
            try {
                console.log(`📖 Loading project from: ${projectFile.name}`);
                const [content] = await projectFile.download();
                const metadata = JSON.parse(content.toString());
                projects.push(metadata);
                console.log(`✅ Loaded project: ${metadata.name} (${metadata.id})`);
            } catch (error) {
                console.warn(`Skipping invalid project file: ${projectFile.name}`, error.message);
            }
        }
        
        console.log(`📁 Returning ${projects.length} projects for user ${userId}`);
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

// Firestore database access
let db;
function getFirestore() {
    if (!db && admin.apps.length > 0) {
        db = admin.firestore();
    }
    return db;
}

// Generate unique job ID for Shopify app creation
function generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// In-memory job storage as fallback
const inMemoryJobs = new Map();

// Shopify App Creation Job Management Functions
async function createAppCreationJob(userId, appName) {
    try {
        const firestore = getFirestore();
        const jobId = generateJobId();
        const jobData = {
            jobId,
            userId,
            appName,
            status: 'running',
            stage: 'initializing',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            output: [],
            authUrl: null,
            error: null,
            sandboxId: null,
            appData: null
        };

        if (!firestore) {
            console.warn('⚠️  Firestore not available - using in-memory job tracking');
            inMemoryJobs.set(jobId, jobData);
            console.log(`✅ Created in-memory job: ${jobId} for user ${userId}`);
            return { jobId, status: 'running' };
        }

        try {
            // Try to use Firestore first
            const firestoreJobData = {
                ...jobData,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            
            await firestore.collection('app_creation_jobs').doc(jobId).set(firestoreJobData);
            console.log(`✅ Created Firestore job: ${jobId} for user ${userId}`);
            return { jobId, status: 'running' };
            
        } catch (firestoreError) {
            console.error('❌ Firestore write failed, falling back to in-memory:', firestoreError.message);
            // Fallback to in-memory storage
            inMemoryJobs.set(jobId, jobData);
            console.log(`✅ Created in-memory job (fallback): ${jobId} for user ${userId}`);
            return { jobId, status: 'running' };
        }
        
    } catch (error) {
        console.error('❌ Failed to create app creation job:', error);
        throw new Error('Failed to create app creation job');
    }
}

async function updateAppCreationJob(jobId, updates) {
    try {
        const firestore = getFirestore();
        
        // Try in-memory first if Firestore is not available
        if (!firestore || inMemoryJobs.has(jobId)) {
            if (inMemoryJobs.has(jobId)) {
                const existingJob = inMemoryJobs.get(jobId);
                const updatedJob = {
                    ...existingJob,
                    ...updates,
                    updatedAt: new Date().toISOString()
                };
                inMemoryJobs.set(jobId, updatedJob);
                console.log(`✅ Updated in-memory job ${jobId} with stage: ${updates.stage || 'unknown'}`);
                return;
            }
        }

        try {
            const updateData = {
                ...updates,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            await firestore.collection('app_creation_jobs').doc(jobId).update(updateData);
            console.log(`✅ Updated Firestore job ${jobId} with stage: ${updates.stage || 'unknown'}`);
            
        } catch (firestoreError) {
            console.error(`❌ Firestore update failed for job ${jobId}, trying in-memory fallback:`, firestoreError.message);
            
            // Fallback: try to find and update in-memory
            if (inMemoryJobs.has(jobId)) {
                const existingJob = inMemoryJobs.get(jobId);
                const updatedJob = {
                    ...existingJob,
                    ...updates,
                    updatedAt: new Date().toISOString()
                };
                inMemoryJobs.set(jobId, updatedJob);
                console.log(`✅ Updated in-memory job (fallback) ${jobId} with stage: ${updates.stage || 'unknown'}`);
            } else {
                console.warn(`⚠️  Job ${jobId} not found in Firestore or in-memory`);
            }
        }
        
    } catch (error) {
        console.error(`❌ Failed to update job ${jobId}:`, error);
    }
}

async function getAppCreationJob(jobId) {
    try {
        // Check in-memory first
        if (inMemoryJobs.has(jobId)) {
            console.log(`✅ Found in-memory job ${jobId}`);
            return inMemoryJobs.get(jobId);
        }

        const firestore = getFirestore();
        if (!firestore) {
            console.warn('⚠️  Firestore not available and job not in memory');
            return null;
        }

        try {
            const jobDoc = await firestore.collection('app_creation_jobs').doc(jobId).get();
            
            if (!jobDoc.exists) {
                console.warn(`⚠️  Job ${jobId} not found in Firestore`);
                return null;
            }

            const jobData = jobDoc.data();
            // Convert Firestore timestamps to ISO strings
            if (jobData.createdAt && jobData.createdAt.toDate) {
                jobData.createdAt = jobData.createdAt.toDate().toISOString();
            }
            if (jobData.updatedAt && jobData.updatedAt.toDate) {
                jobData.updatedAt = jobData.updatedAt.toDate().toISOString();
            }
            
            console.log(`✅ Found Firestore job ${jobId}`);
            return jobData;
            
        } catch (firestoreError) {
            console.error(`❌ Firestore read failed for job ${jobId}:`, firestoreError.message);
            return null;
        }
        
    } catch (error) {
        console.error(`❌ Failed to get job ${jobId}:`, error);
        return null;
    }
}

async function saveShopifyAppMetadata(userId, appData) {
    try {
        const firestore = getFirestore();
        if (!firestore) {
            console.warn('⚠️  Firestore not available - cannot save app metadata');
            return;
        }

        const appId = generateProjectId();
        const appMetadata = {
            appId,
            userId,
            name: appData.name,
            description: `Shopify app created with CLI: ${appData.name}`,
            type: 'shopify-cli-app',
            template: 'typescript-react',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'active',
            cliPath: appData.cliPath || null,
            projectPath: appData.projectPath || null,
            authCompleted: appData.authCompleted || false
        };

        await firestore.collection('user_shopify_apps').doc(appId).set(appMetadata);
        console.log(`✅ Saved Shopify app metadata: ${appId} for user ${userId}`);
        
        return { appId, ...appMetadata };
        
    } catch (error) {
        console.error('❌ Failed to save Shopify app metadata:', error);
        throw new Error('Failed to save app metadata');
    }
}

async function getUserShopifyApps(userId) {
    try {
        const firestore = getFirestore();
        if (!firestore) {
            console.warn('⚠️  Firestore not available');
            return [];
        }

        const appsSnapshot = await firestore
            .collection('user_shopify_apps')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .get();

        const apps = [];
        appsSnapshot.forEach(doc => {
            const appData = doc.data();
            // Convert Firestore timestamps to ISO strings
            if (appData.createdAt && appData.createdAt.toDate) {
                appData.createdAt = appData.createdAt.toDate().toISOString();
            }
            if (appData.updatedAt && appData.updatedAt.toDate) {
                appData.updatedAt = appData.updatedAt.toDate().toISOString();
            }
            apps.push(appData);
        });

        console.log(`📱 Found ${apps.length} Shopify apps for user ${userId}`);
        return apps;
        
    } catch (error) {
        console.error('❌ Failed to get user Shopify apps:', error);
        return [];
    }
}

// Cleanup old jobs (run periodically)
async function cleanupOldJobs() {
    try {
        const firestore = getFirestore();
        if (!firestore) return;

        const cutoffTime = new Date();
        cutoffTime.setHours(cutoffTime.getHours() - 24); // 24 hours ago

        const oldJobsQuery = await firestore
            .collection('app_creation_jobs')
            .where('createdAt', '<', cutoffTime)
            .get();

        const batch = firestore.batch();
        let deleteCount = 0;

        oldJobsQuery.forEach(doc => {
            batch.delete(doc.ref);
            deleteCount++;
        });

        if (deleteCount > 0) {
            await batch.commit();
            console.log(`🧹 Cleaned up ${deleteCount} old app creation jobs`);
        }
        
    } catch (error) {
        console.error('❌ Failed to cleanup old jobs:', error);
    }
}

// Run cleanup every hour
setInterval(cleanupOldJobs, 60 * 60 * 1000);

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());

// Enhanced authentication middleware with Firebase token verification
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Authentication required',
            message: 'Please provide a valid authentication token'
        });
    }
    
    // Extract token
    const token = authHeader.substring(7);
    
    try {
        // Check if Firebase is initialized properly with bucket
        if (admin.apps.length === 0 || !bucket) {
            console.warn('🔓 Firebase not initialized, using basic token validation');
            // Fallback to basic token validation
            req.user = {
                uid: `user_${token.substring(0, 10)}`,
                email: 'demo@example.com', // You'll need to get this from frontend
                token: token
            };
            next();
            return;
        }
        
        // Verify Firebase ID token
        console.log('🔐 Verifying Firebase ID token...');
        const decodedToken = await admin.auth().verifyIdToken(token);
        console.log(`✅ Token verified for user: ${decodedToken.email} (${decodedToken.uid})`);
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            token: token
        };
        next();
    } catch (error) {
        console.error('Token verification failed:', error);
        
        // Fallback for development - remove this in production
        console.warn('Using fallback authentication for development');
        req.user = {
            uid: `user_${token.substring(0, 10)}`,
            email: 'demo@example.com',
            token: token
        };
        next();
    }
};

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});


// Get user projects endpoint
app.get('/api/projects', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        console.log(`📁 Getting projects for user ID: ${userId}, email: ${req.user.email}`);
        
        const projects = await getUserProjects(userId);
        console.log(`📁 Found ${projects.length} projects for user ${userId}`);
        
        res.json({
            success: true,
            projects: projects,
            userEmail: req.user.email
        });
        
    } catch (error) {
        console.error('Error getting user projects:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve projects'
        });
    }
});

// Load a specific project endpoint
app.get('/api/projects/:projectId', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const projectId = req.params.projectId;
        
        console.log(`Loading project ${projectId} for user ${userId}`);
        
        // Get project from Firebase Storage
        const project = await getProject(userId, projectId);
        
        if (!project) {
            return res.status(404).json({
                error: 'Project not found',
                message: 'The requested project does not exist or you do not have access to it'
            });
        }
        
        // If project has a sandbox ID, try to recreate the preview URL
        let previewUrl = project.previewUrl;
        if (project.sandboxId && project.files) {
            try {
                console.log('Recreating sandbox for project...');
                const sandbox = await Sandbox.create('47xhltp24c20rrk3ntgv');
                
                // Deploy project files to new sandbox
                await deployProjectToSandbox(sandbox, project.files);
                
                // Start the server
                await sandbox.commands.run('cd /tmp/app && npm install && node server.js', { 
                    background: true 
                });
                
                // Wait for server to start
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                previewUrl = `https://${sandbox.getHost(3000)}`;
                
                // Update project with new sandbox info
                project.previewUrl = previewUrl;
                project.sandboxId = sandbox.id;
                
                console.log(`Project sandbox recreated at: ${previewUrl}`);
                
            } catch (sandboxError) {
                console.error('Failed to recreate sandbox:', sandboxError);
                // Still return the project even if sandbox recreation fails
            }
        }
        
        res.json({
            success: true,
            project: project
        });
        
    } catch (error) {
        console.error('Error loading project:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to load project'
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
        const sandbox = await Sandbox.create('47xhltp24c20rrk3ntgv');
        
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
            const userId = req.user.uid;
            const projectName = await generateEmailBasedProjectName(req.user.email, userId);
            const projectData = {
                name: projectName,
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

// Generate email-based project name (email-001, email-002, etc.)
async function generateEmailBasedProjectName(userEmail, userId) {
    try {
        // Extract email prefix (everything before @)
        const emailPrefix = userEmail.split('@')[0];
        
        // Get existing projects count for this user
        const existingProjects = await getUserProjects(userId);
        const projectNumber = existingProjects.length + 1;
        
        // Format project number with leading zeros (001, 002, etc.)
        const formattedNumber = projectNumber.toString().padStart(3, '0');
        
        return `${emailPrefix}-${formattedNumber}`;
    } catch (error) {
        console.error('Error generating project name:', error);
        // Fallback to timestamp-based name
        return `project-${Date.now()}`;
    }
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

// Background Shopify CLI Process Management
const activeJobs = new Map(); // In-memory tracking for active jobs

async function startShopifyAppCreationProcess(jobId, userId, appName) {
    try {
        console.log(`🔨 Starting background CLI process for job ${jobId}`);
        
        // Update job status
        await updateAppCreationJob(jobId, {
            stage: 'initializing',
            status: 'running'
        });

        // Create E2B sandbox with Shopify CLI template
        console.log('🏗️  Creating E2B sandbox with Shopify CLI...');
        const sandbox = await Sandbox.create('47xhltp24c20rrk3ntgv');
        
        // Store sandbox reference
        activeJobs.set(jobId, { sandbox, userId, appName, startTime: new Date() });
        
        await updateAppCreationJob(jobId, {
            stage: 'creating',
            sandboxId: sandbox.id,
            output: ['E2B sandbox created successfully', 'Initializing Shopify CLI...']
        });

        // Change to a writable directory  
        await sandbox.commands.run('cd /tmp', { background: false });
        
        // Run shopify app init with headless mode and TypeScript React template
        console.log('🚀 Running Shopify CLI init...');
        
        // Build the init command with output redirection to capture logs
        const shopifyCommand = `shopify app init "${appName}" --template=typescript-react --headless --no-color`;
        
        console.log(`Executing: ${shopifyCommand}`);
        
        await updateAppCreationJob(jobId, {
            output: ['E2B sandbox created successfully', 'Initializing Shopify CLI...', `Running: ${shopifyCommand}`]
        });

        // Execute the CLI command in background with extended timeout and output capture
        // We'll use a wrapper script to capture output to a file we can read
        const wrapperCommand = `cd /tmp && {
            echo "=== Starting Shopify CLI at $(date) ==="
            ${shopifyCommand} 2>&1 | tee /tmp/shopify_output.log
            echo "=== CLI finished with exit code $? at $(date) ==="
        }`;
        
        console.log('🏃 Starting CLI command with output logging...');
        
        const cliProcess = await sandbox.commands.run(wrapperCommand, { 
            background: true,
            timeout: 900000 // 15 minutes timeout
        });

        // Also create an output file we can monitor
        await sandbox.commands.run('touch /tmp/shopify_output.log', { background: false });

        // Monitor the process output
        monitorShopifyCliProcess(jobId, sandbox, cliProcess, userId, appName);

    } catch (error) {
        console.error(`❌ Failed to start Shopify CLI process for job ${jobId}:`, error);
        
        await updateAppCreationJob(jobId, {
            status: 'failed',
            stage: 'error',
            error: error.message || 'Failed to start CLI process'
        });
        
        // Clean up
        activeJobs.delete(jobId);
    }
}

async function monitorShopifyCliProcess(jobId, sandbox, cliProcess, userId, appName) {
    try {
        console.log(`👁️  Monitoring real CLI process for job ${jobId}`);
        let outputBuffer = ['E2B sandbox created successfully', 'Initializing Shopify CLI...', `Running shopify app init "${appName}"...`];
        let authUrl = null;
        let isWaitingForAuth = false;
        let isProcessComplete = false;
        let lastOutputLength = 0;

        // Function to extract authentication URLs from CLI output
        const extractAuthUrl = (output) => {
            // Look for various Shopify CLI authentication patterns
            const patterns = [
                /To create your app, visit:\s*(https:\/\/partners\.shopify\.com\/[^\s\n]+)/i,
                /Please visit the following URL to authenticate:\s*(https:\/\/partners\.shopify\.com\/[^\s\n]+)/i,
                /Visit this URL to authenticate:\s*(https:\/\/partners\.shopify\.com\/[^\s\n]+)/i,
                /Authentication URL:\s*(https:\/\/partners\.shopify\.com\/[^\s\n]+)/i,
                /Open this link:\s*(https:\/\/partners\.shopify\.com\/[^\s\n]+)/i,
                /(https:\/\/partners\.shopify\.com\/[^\s\n]*auth[^\s\n]*)/i
            ];

            for (const pattern of patterns) {
                const match = output.match(pattern);
                if (match) {
                    console.log(`🔗 Found authentication URL: ${match[1]}`);
                    return match[1];
                }
            }
            return null;
        };

        // Function to determine the current stage based on CLI output
        const determineStage = (output) => {
            const lowerOutput = output.toLowerCase();
            
            if (lowerOutput.includes('creating app') || lowerOutput.includes('setting up') || lowerOutput.includes('initializing')) {
                return 'creating';
            } else if (lowerOutput.includes('authentication') || lowerOutput.includes('auth') || lowerOutput.includes('visit') || lowerOutput.includes('partners.shopify.com')) {
                return 'waiting_auth';
            } else if (lowerOutput.includes('authenticating') || lowerOutput.includes('completing')) {
                return 'authenticating';
            } else if (lowerOutput.includes('finalizing') || lowerOutput.includes('finishing') || lowerOutput.includes('installing dependencies')) {
                return 'finalizing';
            } else if (lowerOutput.includes('success') || lowerOutput.includes('completed') || lowerOutput.includes('done')) {
                return 'completed';
            }
            return 'creating';
        };

        // Poll for real CLI output
        const pollInterval = setInterval(async () => {
            try {
                const jobData = activeJobs.get(jobId);
                if (!jobData || isProcessComplete) {
                    clearInterval(pollInterval);
                    return;
                }

                // Check if the CLI process is still running
                const processCheck = await sandbox.commands.run('ps aux | grep -v grep | grep "shopify"', { background: false });
                const isProcessRunning = processCheck.stdout && processCheck.stdout.includes('shopify');

                // Try to read the CLI output from the log file
                let currentOutput = '';
                let newOutputLines = [];
                
                try {
                    // Read the output log file that tee is writing to
                    const logRead = await sandbox.commands.run('cat /tmp/shopify_output.log 2>/dev/null || echo ""', { background: false });
                    
                    if (logRead.stdout && logRead.stdout.trim()) {
                        currentOutput = logRead.stdout;
                        console.log(`📋 CLI Output (${currentOutput.length} chars): ${currentOutput.substring(0, 300)}${currentOutput.length > 300 ? '...' : ''}`);
                        
                        // Parse new lines since last check
                        const allLines = currentOutput.split('\n').filter(line => line.trim());
                        const currentOutputLength = outputBuffer.length;
                        
                        // Add only new lines that aren't already in the buffer
                        for (const line of allLines) {
                            const trimmedLine = line.trim();
                            if (trimmedLine && !outputBuffer.some(existing => existing.includes(trimmedLine.substring(0, 50)))) {
                                newOutputLines.push(trimmedLine);
                            }
                        }
                        
                        // Try to extract auth URL from the full output
                        if (!authUrl) {
                            const foundAuthUrl = extractAuthUrl(currentOutput);
                            if (foundAuthUrl) {
                                authUrl = foundAuthUrl;
                                isWaitingForAuth = true;
                                newOutputLines.push(`🔗 Authentication required: ${authUrl}`);
                                console.log(`🔐 Extracted auth URL: ${authUrl}`);
                            }
                        }
                    }

                    // Check directory status for progress indication
                    const outputCheck = await sandbox.commands.run('ls -la /tmp/app/ 2>/dev/null || echo "no app dir"', { background: false });
                    if (outputCheck.stdout && !outputCheck.stdout.includes('no app dir')) {
                        console.log(`📁 App directory exists: ${outputCheck.stdout.substring(0, 200)}`);
                    }

                    // Since we can't directly capture stdout from the background process,
                    // let's try to detect the state by checking the filesystem and process status
                    const appDirCheck = await sandbox.commands.run(`cd /tmp && ls -la "${appName}" 2>/dev/null || echo "no app dir yet"`, { background: false });
                    
                    if (appDirCheck.stdout && !appDirCheck.stdout.includes('no app dir yet')) {
                        console.log(`📂 App directory created: ${appDirCheck.stdout.substring(0, 200)}`);
                        
                        // Check for package.json or other files that indicate progress
                        const filesCheck = await sandbox.commands.run(`cd /tmp/"${appName}" && ls -la 2>/dev/null | head -20`, { background: false });
                        if (filesCheck.stdout) {
                            currentOutput = `App directory created successfully:\n${filesCheck.stdout}`;
                            
                            // Check if this looks like a complete Shopify app structure
                            if (filesCheck.stdout.includes('package.json') && filesCheck.stdout.includes('app')) {
                                currentOutput += '\nShopify app structure detected - setup appears complete!';
                                isProcessComplete = true;
                            }
                        }
                    } else if (!isProcessRunning && !authUrl) {
                        // Process finished but we don't have an auth URL yet - might need authentication
                        currentOutput = 'CLI process requires authentication. Checking for authentication requirements...';
                        
                        // Try to run the command again in foreground to see what it outputs
                        try {
                            const authCheck = await sandbox.commands.run(`cd /tmp && timeout 10 shopify app init "${appName}" --template=typescript-react --headless --no-color`, { background: false });
                            if (authCheck.stdout || authCheck.stderr) {
                                const fullOutput = (authCheck.stdout || '') + (authCheck.stderr || '');
                                console.log(`🔍 CLI output for auth check: ${fullOutput.substring(0, 500)}`);
                                
                                // Try to extract auth URL
                                const foundAuthUrl = extractAuthUrl(fullOutput);
                                if (foundAuthUrl) {
                                    authUrl = foundAuthUrl;
                                    isWaitingForAuth = true;
                                    currentOutput += `\nAuthentication required. Please visit: ${authUrl}`;
                                } else if (fullOutput.includes('Authentication') || fullOutput.includes('login') || fullOutput.includes('auth')) {
                                    currentOutput += '\nAuthentication required. Please check the Shopify Partners portal.';
                                    // Provide a generic partners URL if we can't extract the specific one
                                    authUrl = 'https://partners.shopify.com/';
                                    isWaitingForAuth = true;
                                }
                            }
                        } catch (authError) {
                            console.log(`ℹ️  Auth check completed: ${authError.message}`);
                        }
                    }

                } catch (outputError) {
                    console.log(`ℹ️  Output check: ${outputError.message}`);
                }

                // Add new output lines to buffer
                if (newOutputLines.length > 0) {
                    outputBuffer.push(...newOutputLines);
                    console.log(`📄 Added ${newOutputLines.length} new output lines to buffer`);
                }

                // Update job based on current state
                let currentStage = 'creating';
                let updateData = { output: outputBuffer };

                if (isProcessComplete) {
                    currentStage = 'completed';
                    outputBuffer.push('✅ Shopify app created successfully!');
                    outputBuffer.push('📁 Project files have been generated');
                    outputBuffer.push('🎉 Setup complete!');

                    // Save app metadata
                    try {
                        const appData = await saveShopifyAppMetadata(userId, {
                            name: appName,
                            cliPath: `/tmp/${appName}`,
                            projectPath: `/tmp/${appName}`,
                            authCompleted: !isWaitingForAuth || authUrl !== null
                        });

                        updateData = {
                            stage: 'completed',
                            status: 'completed',
                            appData: appData,
                            output: outputBuffer
                        };

                        console.log(`✅ Shopify app creation completed for job ${jobId}`);
                    } catch (saveError) {
                        console.error(`❌ Error saving app metadata: ${saveError.message}`);
                    }

                    // Clean up
                    activeJobs.delete(jobId);
                    clearInterval(pollInterval);
                    
                } else if (authUrl && isWaitingForAuth) {
                    currentStage = 'waiting_auth';
                    updateData.authUrl = authUrl;
                    updateData.stage = currentStage;
                    
                } else if (!isProcessRunning && outputBuffer.length > 3) {
                    // Process has stopped but we're not sure why
                    const lastOutput = outputBuffer[outputBuffer.length - 1] || '';
                    if (lastOutput.includes('success') || lastOutput.includes('complete')) {
                        currentStage = 'completed';
                        isProcessComplete = true;
                    } else {
                        // Might be waiting for authentication or there was an error
                        outputBuffer.push('⏸️  CLI process paused - may require authentication');
                        currentStage = 'waiting_auth';
                        // Provide fallback auth URL
                        if (!authUrl) {
                            authUrl = 'https://partners.shopify.com/';
                            updateData.authUrl = authUrl;
                        }
                    }
                    updateData.stage = currentStage;
                } else {
                    // Still creating
                    currentStage = determineStage(outputBuffer.join(' '));
                    updateData.stage = currentStage;
                }

                // Update the job with new data
                await updateAppCreationJob(jobId, updateData);
                
                console.log(`📊 Job ${jobId}: stage=${currentStage}, output lines=${outputBuffer.length}, process_running=${isProcessRunning}`);

            } catch (pollError) {
                console.error(`❌ Error polling CLI process for job ${jobId}:`, pollError);
            }
        }, 8000); // Poll every 8 seconds for more thorough checks

        // Set a maximum timeout to prevent infinite polling
        setTimeout(() => {
            clearInterval(pollInterval);
            if (activeJobs.has(jobId) && !isProcessComplete) {
                console.warn(`⏰ Job ${jobId} timed out after 25 minutes`);
                updateAppCreationJob(jobId, {
                    status: 'failed',
                    stage: 'error',
                    error: 'Process timed out after 25 minutes. This may be due to network issues or authentication requirements.'
                });
                activeJobs.delete(jobId);
            }
        }, 1500000); // 25 minutes maximum

    } catch (error) {
        console.error(`❌ Error monitoring CLI process for job ${jobId}:`, error);
        
        await updateAppCreationJob(jobId, {
            status: 'failed',
            stage: 'error',
            error: error.message || 'Failed to monitor CLI process'
        });
        
        activeJobs.delete(jobId);
    }
}

// Cleanup function for abandoned jobs
function cleanupAbandonedJobs() {
    const now = new Date();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    for (const [jobId, jobInfo] of activeJobs.entries()) {
        if (now - jobInfo.startTime > maxAge) {
            console.log(`🧹 Cleaning up abandoned job ${jobId}`);
            activeJobs.delete(jobId);
            
            // Update job status
            updateAppCreationJob(jobId, {
                status: 'failed',
                stage: 'error',
                error: 'Job abandoned due to timeout'
            }).catch(err => console.error('Error updating abandoned job:', err));
        }
    }
}

// Run cleanup every 10 minutes
setInterval(cleanupAbandonedJobs, 10 * 60 * 1000);

// Shopify App Creation Endpoints

// Create new Shopify app with CLI
app.post('/api/create-shopify-app', authenticateUser, async (req, res) => {
    try {
        const { appName } = req.body;
        const userId = req.user.uid;

        if (!appName || !appName.trim()) {
            return res.status(400).json({
                error: 'App name is required',
                message: 'Please provide a valid app name'
            });
        }

        // Validate app name (letters, numbers, spaces, dashes only)
        const validPattern = /^[a-zA-Z0-9\s\-]+$/;
        if (!validPattern.test(appName.trim())) {
            return res.status(400).json({
                error: 'Invalid app name',
                message: 'App name can only contain letters, numbers, spaces, and dashes'
            });
        }

        console.log(`🚀 Starting Shopify app creation: "${appName}" for user ${userId}`);

        // Create job in Firestore
        const jobResult = await createAppCreationJob(userId, appName.trim());
        
        // Start the background CLI process
        startShopifyAppCreationProcess(jobResult.jobId, userId, appName.trim());

        res.json({
            success: true,
            jobId: jobResult.jobId,
            message: 'Shopify app creation started',
            estimatedTime: '5-15 minutes'
        });

    } catch (error) {
        console.error('Error starting Shopify app creation:', error);
        res.status(500).json({
            error: 'Failed to start app creation',
            message: error.message || 'Internal server error'
        });
    }
});

// Get app creation status
app.get('/api/app-creation-status/:jobId', authenticateUser, async (req, res) => {
    try {
        const { jobId } = req.params;
        const userId = req.user.uid;

        const jobData = await getAppCreationJob(jobId);
        
        if (!jobData) {
            return res.status(404).json({
                error: 'Job not found',
                message: 'The requested job does not exist'
            });
        }

        // Verify job belongs to user
        if (jobData.userId !== userId) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'You do not have access to this job'
            });
        }

        res.json({
            success: true,
            jobId: jobData.jobId,
            status: jobData.status,
            stage: jobData.stage,
            output: jobData.output || [],
            authUrl: jobData.authUrl,
            error: jobData.error,
            appData: jobData.appData,
            createdAt: jobData.createdAt,
            updatedAt: jobData.updatedAt
        });

    } catch (error) {
        console.error('Error getting app creation status:', error);
        res.status(500).json({
            error: 'Failed to get status',
            message: error.message || 'Internal server error'
        });
    }
});

// Complete app setup (after authentication)
app.post('/api/complete-app-setup', authenticateUser, async (req, res) => {
    try {
        const { jobId } = req.body;
        const userId = req.user.uid;

        if (!jobId) {
            return res.status(400).json({
                error: 'Job ID is required',
                message: 'Please provide a valid job ID'
            });
        }

        const jobData = await getAppCreationJob(jobId);
        
        if (!jobData) {
            return res.status(404).json({
                error: 'Job not found',
                message: 'The requested job does not exist'
            });
        }

        // Verify job belongs to user
        if (jobData.userId !== userId) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'You do not have access to this job'
            });
        }

        // Update job status to indicate setup completion
        await updateAppCreationJob(jobId, {
            stage: 'finalizing',
            status: 'running'
        });

        res.json({
            success: true,
            message: 'App setup completion acknowledged'
        });

    } catch (error) {
        console.error('Error completing app setup:', error);
        res.status(500).json({
            error: 'Failed to complete setup',
            message: error.message || 'Internal server error'
        });
    }
});

// Get user's Shopify CLI apps
app.get('/api/shopify-apps', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const apps = await getUserShopifyApps(userId);
        
        res.json({
            success: true,
            apps: apps
        });

    } catch (error) {
        console.error('Error getting Shopify apps:', error);
        res.status(500).json({
            error: 'Failed to get apps',
            message: error.message || 'Internal server error'
        });
    }
});

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