const express = require('express');
const cors = require('cors');
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { Sandbox } = require('@e2b/code-interpreter');

const app = express();
const port = process.env.SERVER_PORT || 3001;

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
2. Structure the code to run as a single server.js file or simple file structure
3. Use Express.js for the web server
4. Include a basic HTML frontend with inline CSS/JS or separate files
5. Make the app listen on port 3000
6. Focus on practical, working functionality
7. Ensure all dependencies are common packages (express, etc.)

For each request, provide:
1. A brief explanation of what the app does
2. The main server.js file code
3. Any additional HTML/CSS/JS files needed
4. A package.json with dependencies
5. Clear structure that can be deployed and run immediately

The app should be ready to run with:
- npm install
- node server.js

Example structure:
\`\`\`javascript
// server.js
const express = require('express');
const app = express();
const port = 3000;

// ... app logic here ...

app.listen(port, () => {
    console.log(\`App running at http://localhost:\${port}\`);
});
\`\`\`

Focus on creating simple, working web applications that demonstrate the requested functionality.`;

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
            await deployCodeToSandbox(sandbox, generatedCode);
            
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

            res.json({
                success: true,
                response: generatedCode,
                previewUrl: previewUrl,
                sandboxId: sandbox.id,
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

// Helper function to deploy generated code to E2B sandbox
async function deployCodeToSandbox(sandbox, generatedCode) {
    console.log('Deploying code to sandbox...');
    
    // Create app directory
    await sandbox.commands.run('mkdir -p /tmp/app');
    
    // Extract code blocks from the generated response
    const codeBlocks = extractCodeBlocks(generatedCode);
    
    // Deploy each file to the sandbox
    for (const [filename, content] of Object.entries(codeBlocks)) {
        console.log(`Writing file: ${filename}`);
        await sandbox.filesystem.write(`/tmp/app/${filename}`, content);
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
        await sandbox.filesystem.write('/tmp/app/package.json', JSON.stringify(basicPackageJson, null, 2));
    }
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
app.listen(port, () => {
    console.log(`🚀 Shopify AI App Builder server running on port ${port}`);
    console.log(`🔗 Health check: http://localhost:${port}/health`);
    
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
});

module.exports = app;