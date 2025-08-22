# Shopify AI App Builder

A web application for building Shopify apps using AI coding agents, featuring Firebase authentication and a dark mode interface with Shopify green accents.

## Features

- ✅ User Authentication (Login, Register, Password Reset)
- ✅ Dark mode UI with Shopify green accent color
- ✅ Firebase integration for user management
- ✅ **AI-Powered Code Generation** using Claude API
- ✅ Lovable-inspired gradient interface
- ✅ Real-time Shopify app code generation
- ✅ Copy-to-clipboard functionality
- ✅ Responsive design
- ✅ Form validation and error handling
- ✅ Loading states and user feedback

## Setup Instructions

### 1. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Enable Authentication:
   - Go to Authentication > Sign-in method
   - Enable "Email/Password" provider
4. Get your Firebase configuration:
   - Go to Project Settings > General
   - Scroll down to "Your apps" section
   - Click "Web" and register your app
   - Copy the configuration object

### 2. Get Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign up or sign in to your account
3. Navigate to API Keys section
4. Create a new API key
5. Copy the API key (starts with `sk-ant-`)

### 3. Configure Environment Variables

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and replace the placeholder values with your actual configuration:
   ```
   # Firebase Configuration
   VITE_FIREBASE_API_KEY=your-actual-api-key
   VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-actual-sender-id
   VITE_FIREBASE_APP_ID=your-actual-app-id
   VITE_FIREBASE_MEASUREMENT_ID=your-actual-measurement-id

   # Claude API Configuration
   ANTHROPIC_API_KEY=your-claude-api-key-here
   SERVER_PORT=3001
   ```

⚠️ **Important**: Never commit the `.env` file to version control. It's already included in `.gitignore`.

### 4. Install Dependencies & Run the Application

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to the URL shown in the terminal (usually `http://localhost:5173`)

#### Alternative: Simple HTTP Server
If you prefer not to use a build tool, you can serve the files with a simple HTTP server:

**Using Python:**
```bash
python -m http.server 8000
```

**Using Node.js:**
```bash
npx http-server
```

**Note**: If using a simple HTTP server, you'll need to update `firebase-config.js` to use hardcoded values instead of environment variables.

## File Structure

```
shopify-a/
├── index.html          # Authentication page (login, register, forgot password)
├── dashboard.html      # AI code generation interface
├── styles.css          # Dark mode CSS for authentication
├── dashboard.css       # Lovable-inspired CSS for dashboard
├── auth.js             # Authentication logic and form handling
├── dashboard.js        # AI integration and dashboard functionality
├── firebase-config.js  # Firebase configuration
├── server/
│   └── index.js        # Express server with Claude API integration
├── package.json        # Dependencies and scripts
├── .env                # Environment variables (not committed)
├── .env.example        # Environment variables template
├── .gitignore          # Git ignore rules
└── README.md           # This file
```

## Usage

### Authentication
1. **Registration**:
   - Click "Don't have an account? Register"
   - Fill in email and password (minimum 6 characters)
   - Confirm password and click "Register"
   - Check your email for verification link

2. **Login**:
   - Enter your registered email and password
   - Click "Login"
   - You'll be redirected to the AI dashboard

3. **Forgot Password**:
   - Click "Forgot Password?"
   - Enter your email address
   - Check your email for the password reset link

### AI Code Generation
1. **Create Shopify Apps**:
   - After login, you'll see the Lovable-inspired interface
   - Enter your prompt in the text area (e.g., "Create a Shopify app that tracks inventory levels")
   - Click the send button (green arrow) or press Enter
   - Wait for AI to generate your complete Shopify app code

2. **Copy and Use Code**:
   - Click "Copy Code" to copy the generated code to clipboard
   - Click "New App" to start a new generation
   - The AI provides complete, deployable Shopify applications

## Next Steps

To continue building the Shopify AI App Builder:

1. Create a dashboard page (`dashboard.html`) for authenticated users
2. Implement the AI coding agent functionality
3. Add Shopify app creation tools
4. Set up Firebase Firestore for storing app data
5. Add project management features

## Color Scheme

- **Primary Background**: `#1a1a1a` (Dark)
- **Secondary Background**: `#2d2d2d` (Dark Grey)
- **Shopify Green**: `#00A651` (Primary Accent)
- **Text Primary**: `#ffffff` (White)
- **Text Secondary**: `#b3b3b3` (Light Grey)

## Security Features

- ✅ **Environment Variables**: Sensitive Firebase config stored in `.env` (not committed to git)
- ✅ **Email Verification**: New accounts require email verification
- ✅ **Firebase Auth Security**: Leverages Google's enterprise-grade authentication
- ✅ **Client-side Validation**: Form validation with proper error handling
- ✅ **Password Requirements**: Minimum 6 characters with strength validation
- ✅ **Rate Limiting**: Firebase handles brute-force protection automatically
- ✅ **Secure Defaults**: `.gitignore` prevents accidental credential commits

## Security Best Practices

### Development
- Never commit `.env` files to version control
- Use different Firebase projects for development/staging/production
- Regularly rotate API keys and credentials

### Production
- Set up Firebase Security Rules for Firestore/Storage
- Enable Firebase App Check for additional security
- Use HTTPS only (Firebase automatically enforces this)
- Monitor Firebase Authentication logs for suspicious activity
- Set up proper CORS policies

### Environment Variables Security
```bash
# ✅ Good - Environment variables are not exposed in client code
VITE_FIREBASE_API_KEY=abc123

# ❌ Bad - Direct credentials in source code
const apiKey = "abc123"
```

**Note**: Firebase client-side API keys are designed to be publicly accessible, but it's still best practice to use environment variables for configuration management and to prevent accidental exposure of other sensitive data.