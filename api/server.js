// ========================================
// SIMPLE LLM TUTOR BACKEND SERVER
// ========================================
// This backend serves as the AI tutor API
// It handles chat requests with different learning modes

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// MIDDLEWARE
// ========================================
app.use(cors());
app.use(express.json());

// ========================================
// BASIC AUTHENTICATION
// ========================================
const authMiddleware = (req, res, next) => {
    // Skip auth for health check
    if (req.path === '/api/health') return next();

    const authHeader = req.headers.authorization;

    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="LLM Tutor Area"');
        return res.status(401).send('Authentication required');
    }

    // Decode "Basic base64(user:pass)"
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];

    // Check credentials (default: admin / password)
    const validUser = process.env.AUTH_USER;
    const validPass = process.env.AUTH_PASS;

    if (user === validUser && pass === validPass) {
        next();
    } else {
        res.setHeader('WWW-Authenticate', 'Basic realm="LLM Tutor Area"');
        return res.status(401).send('Access denied');
    }
};

app.use(authMiddleware);
app.use(express.static(path.join(__dirname, '..', 'public'))); // Serve frontend files

// ========================================
// HARDCODED SAMPLE NOTES
// ========================================
// These notes are the knowledge base for the AI tutor
const SAMPLE_NOTES = `
Topic: Photosynthesis

Definition:
Photosynthesis is the process by which green plants use sunlight to synthesize nutrients from carbon dioxide and water. It primarily occurs in the chloroplasts of plant cells.

Key Points:
- Photosynthesis converts light energy into chemical energy stored in glucose
- The process requires chlorophyll (green pigment), sunlight, carbon dioxide, and water
- Oxygen is released as a byproduct
- Takes place mainly in leaves

The Chemical Equation:
6CO₂ + 6H₂O + Light Energy → C₆H₁₂O₆ + 6O₂

Two Main Stages:
1. Light-dependent reactions (occur in thylakoid membranes)
   - Capture light energy
   - Split water molecules
   - Produce ATP and NADPH

2. Light-independent reactions / Calvin Cycle (occur in stroma)
   - Use ATP and NADPH from light reactions
   - Fix carbon dioxide into glucose
   - Can occur in light or dark

Importance:
- Produces oxygen for the atmosphere
- Forms the base of most food chains
- Removes CO₂ from the atmosphere
- Provides energy for the plant and organisms that eat plants
`;

// ========================================
// PROMPT GENERATION LOGIC
// ========================================
// Generate mode-specific instructions
function getModeInstruction(mode) {
    const instructions = {
        explain: "Explain the concept clearly with examples using only the notes provided below. Be thorough but concise.",
        quiz: "Conduct a multiple-choice quiz based on the notes. \n1. Ask ONE question at a time with 4 options (A, B, C, D).\n2. Start with a question about a RANDOM concept from the notes (do not always start with the definition).\n3. When the student answers, start with 'Correct!' or 'Incorrect!' followed by a brief explanation.\n4. ONLY AFTER the explanation, ask the NEXT question.\n5. Number your questions (e.g., Question 1, Question 2).\n6. Continue asking questions indefinitely until the student explicitly says 'stop'. Do not end the quiz automatically.\n7. If the student asks for a 'new quiz', 'restart', or 'start over', ignore the previous conversation and start a fresh quiz from Question 1.\n8. If the student says 'end quiz', 'stop', or 'quit', conclude the quiz and say 'Quiz ended. Type \"new quiz\" to start again.'",
        simplify: "Explain the concept in very simple words like teaching a beginner or child. Use analogies and everyday examples."
    };
    
    return instructions[mode] || instructions.explain;
}

// Build the complete prompt for the LLM
function buildPrompt(userMessage, mode, history = []) {
    const modeInstruction = getModeInstruction(mode);
    
    // Format history
    let historyText = "";
    if (history.length > 0) {
        historyText = "\nCONVERSATION HISTORY:\n" + history.map(msg => {
            const role = msg.role === 'user' ? 'Student' : 'Tutor';
            return `${role}: ${msg.content}`;
        }).join("\n") + "\n";
    }
    
    // Structure: System context + Notes + Mode instruction + History + User message
    const prompt = `You are a helpful AI tutor. Your role is to teach students based on the provided study notes.

STUDY NOTES:
${SAMPLE_NOTES}

INSTRUCTIONS:
${modeInstruction}

IMPORTANT: Only use information from the study notes above. Do not add external information.
${historyText}
Student's message: ${userMessage}`;

    return prompt;
}

// ========================================
// OPENAI API CALL WITH TIMEOUT
// ========================================
// Call OpenAI-compatible chat API with timeout
async function callOpenAI(prompt, mode) {
    const apiKey = process.env.OPENAI_API_KEY;
    
    // Check if API key is set
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    
    const apiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // Increased timeout to 15 seconds
    
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful AI tutor.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 1000 // Increased token limit
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
        }
        
        const data = await response.json();
        
        // Extract the AI's reply
        if (data.choices && data.choices.length > 0) {
            return data.choices[0].message.content;
        } else {
            throw new Error('Unexpected response format from OpenAI API');
        }
        
    } catch (error) {
        clearTimeout(timeoutId);
        console.error('Error calling OpenAI:', error.message);
        
        // If timeout or API error, throw to trigger fallback
        throw error;
    }
}

// ========================================
// DEMO MODE RESPONSES (Fallback)
// ========================================
function getDemoResponse(mode, message) {
    // Specialized logic for Quiz mode to simulate flow
    if (mode === 'quiz') {
        const cleanMsg = message.trim().toUpperCase();
        
        // Handle restart request
        if (cleanMsg.includes('NEW QUIZ') || cleanMsg.includes('RESTART') || cleanMsg.includes('START OVER')) {
            const startQuestions = [
                "Question 1: What gas do plants take in from the atmosphere during photosynthesis?\n\nA) Oxygen\nB) Carbon Dioxide\nC) Nitrogen\nD) Hydrogen",
                "Question 1: Where does the light-dependent reaction take place?\n\nA) Stroma\nB) Thylakoid membranes\nC) Roots\nD) Stem",
                "Question 1: What is the primary product of photosynthesis?\n\nA) Glucose\nB) Water\nC) Carbon Dioxide\nD) Nitrogen"
            ];
            return startQuestions[Math.floor(Math.random() * startQuestions.length)];
        }

        // Handle end quiz request
        if (cleanMsg.includes('END QUIZ') || cleanMsg.includes('STOP') || cleanMsg.includes('QUIT')) {
            return "Quiz ended. Thanks for practicing! Type 'new quiz' to start again.";
        }
        
        // If user sends a single letter answer
        if (/^[A-D]$/.test(cleanMsg)) {
            return "Correct! Plants take in Carbon Dioxide to perform photosynthesis.\n\nNext Question:\nWhere does the light-dependent reaction take place?\n\nA) Stroma\nB) Thylakoid membranes\nC) Roots\nD) Stem";
        }
        // Default start question (Randomized)
        const startQuestions = [
            "Question 1: What gas do plants take in from the atmosphere during photosynthesis?\n\nA) Oxygen\nB) Carbon Dioxide\nC) Nitrogen\nD) Hydrogen",
            "Question 1: Where does the light-dependent reaction take place?\n\nA) Stroma\nB) Thylakoid membranes\nC) Roots\nD) Stem",
            "Question 1: What is the primary product of photosynthesis?\n\nA) Glucose\nB) Water\nC) Carbon Dioxide\nD) Nitrogen"
        ];
        return startQuestions[Math.floor(Math.random() * startQuestions.length)];
    }

    const responses = {
        explain: [
            "Photosynthesis is the process by which green plants create their own food using sunlight. \n\nThink of it like a solar-powered kitchen inside the leaf:\n1. **Ingredients**: Water (from roots) + Carbon Dioxide (from air)\n2. **Energy**: Sunlight (captured by chlorophyll)\n3. **Product**: Glucose (sugar for food) + Oxygen (released into air)\n\nThe chemical equation is: 6CO₂ + 6H₂O + Light → C₆H₁₂O₆ + 6O₂",
            "The two main stages are:\n\n1. **Light-Dependent Reactions**: These happen in the thylakoid membranes. They capture sunlight and split water molecules to make energy (ATP/NADPH).\n\n2. **Calvin Cycle**: This happens in the stroma. It uses that energy to turn CO₂ into sugar (glucose).",
            "This process is vital because it produces the oxygen we breathe and forms the base of the food chain for almost all life on Earth."
        ],
        simplify: [
            "Imagine a plant is like a chef. \n\nIt needs three things to cook:\n1. Sunlight (the fire)\n2. Water (from the rain)\n3. Air (specifically CO₂)\n\nIt mixes them all up in its green leaves and makes sugar! That sugar is its food to help it grow.",
            "Plants breathe in the bad air (CO₂) and breathe out the good air (Oxygen) that we need to live. They are like nature's air purifiers!",
            "Green stuff in leaves called 'chlorophyll' is what catches the sunlight. It's like a solar panel for the plant."
        ]
    };

    // Return a random response from the selected mode
    const modeResponses = responses[mode] || responses.explain;
    return modeResponses[Math.floor(Math.random() * modeResponses.length)];
}

// ========================================
// API ENDPOINTS
// ========================================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'LLM Tutor API is running' });
});

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message, mode, history } = req.body;
        
        // Validate request
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ 
                error: 'Message is required and must be a string' 
            });
        }
        
        if (!mode || !['explain', 'quiz', 'simplify'].includes(mode)) {
            return res.status(400).json({ 
                error: 'Mode must be one of: explain, quiz, simplify' 
            });
        }
        
        console.log(`[${new Date().toISOString()}] Chat request - Mode: ${mode}`);
        
        // Try to call OpenAI, but fall back to Demo Mode if it fails
        let aiReply;
        try {
            // Only attempt OpenAI if key is present
            if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('your-api-key')) {
                const fullPrompt = buildPrompt(message, mode, history);
                aiReply = await callOpenAI(fullPrompt, mode);
            } else {
                throw new Error('No valid API key configured');
            }
        } catch (error) {
            console.log('⚠️ Using Demo Mode fallback:', error.message);
            aiReply = getDemoResponse(mode, message);
        }
        
        // Send response back to frontend
        res.json({ reply: aiReply });
        
    } catch (error) {
        console.error('Error in /api/chat:', error);
        res.status(500).json({ 
            error: 'Failed to generate response',
            details: error.message 
        });
    }
});

// ========================================
// ERROR HANDLING
// ========================================
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

module.exports = app;
