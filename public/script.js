// ========================================
// LLM TUTOR FRONTEND
// ========================================
// This frontend connects to the backend API
// and handles the chat interface

// ========================================
// STATE MANAGEMENT
// ========================================
let currentMode = null; // Current learning mode: 'explain', 'quiz', or 'simplify'
let isProcessing = false; // Prevent multiple simultaneous requests
let chatHistory = []; // Store conversation history

// ========================================
// DOM ELEMENTS
// ========================================
const chatContainer = document.getElementById('chatContainer');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const currentModeDisplay = document.getElementById('currentMode');

// Mode buttons
const explainBtn = document.getElementById('explainBtn');
const quizBtn = document.getElementById('quizBtn');
const simplifyBtn = document.getElementById('simplifyBtn');

// ========================================
// MODE SELECTION HANDLERS
// ========================================
// Set the current learning mode
function setMode(mode) {
    currentMode = mode;
    chatHistory = []; // Reset history when mode changes
    
    // Update UI to show selected mode
    updateModeDisplay(mode);
    
    // Update button states
    updateButtonStates(mode);
    
    // Auto-send an initial request based on the mode
    handleModeSelection(mode);
}

// Update the current mode display text
function updateModeDisplay(mode) {
    const modeNames = {
        'explain': '<i class="ri-book-open-line"></i> Explain Mode',
        'quiz': '<i class="ri-questionnaire-line"></i> Quiz Mode',
        'simplify': '<i class="ri-lightbulb-flash-line"></i> Simplify Mode'
    };
    currentModeDisplay.innerHTML = modeNames[mode] || 'None selected';
}

// Update button active states
function updateButtonStates(mode) {
    // Remove active class from all buttons
    [explainBtn, quizBtn, simplifyBtn].forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to selected button
    if (mode === 'explain') explainBtn.classList.add('active');
    if (mode === 'quiz') quizBtn.classList.add('active');
    if (mode === 'simplify') simplifyBtn.classList.add('active');
}

// Handle mode selection and send initial request
function handleModeSelection(mode) {
    // Different initial prompts for each mode
    const initialPrompts = {
        'explain': 'Please explain the concept of photosynthesis.',
        'quiz': 'I\'m ready to be quizzed on photosynthesis.',
        'simplify': 'Please explain photosynthesis in simple terms.'
    };
    
    const userMessage = initialPrompts[mode];
    
    // Display user's automatic message
    displayMessage(userMessage, 'user');
    
    // Add to history
    chatHistory.push({ role: 'user', content: userMessage });
    
    // Send to backend
    sendToBackend(userMessage, mode);
}

// ========================================
// MESSAGE DISPLAY
// ========================================
// Display a message in the chat (type: 'user' or 'ai')
function displayMessage(text, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = type === 'user' ? '<i class="ri-user-3-line"></i>' : '<i class="ri-robot-2-line"></i>';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const paragraph = document.createElement('p');
    
    // Escape HTML to prevent XSS
    const escapedText = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    // Convert **text** to <strong>text</strong>
    const formattedText = escapedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Format quiz options if applicable
    let finalHtml = formattedText;
    if (type === 'ai' && currentMode === 'quiz') {
        finalHtml = formatQuizOptions(finalHtml);
    }
    
    paragraph.innerHTML = finalHtml;
    
    content.appendChild(paragraph);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    
    chatContainer.appendChild(messageDiv);
    
    // Auto-scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Format quiz options into clickable buttons
function formatQuizOptions(text) {
    // Look for patterns like "A) Option text" or "A. Option text"
    // We look for A, B, C, D followed by ) or . at the start of a line (or after newline)
    const optionRegex = /(?:^|\n)([A-D])[\)\.]\s+(.*?)(?=\n|$)/g;
    const matches = [...text.matchAll(optionRegex)];
    
    if (matches.length >= 2) {
        let optionsHtml = '<div class="quiz-options">';
        matches.forEach(match => {
            const letter = match[1];
            const content = match[2];
            optionsHtml += `<button class="quiz-option-btn" onclick="window.sendOption('${letter}')">${letter}) ${content}</button>`;
        });
        optionsHtml += '</div>';
        
        // Remove the original text options to avoid duplication
        // We replace them with an empty string, then clean up extra newlines
        let cleanText = text.replace(optionRegex, '');
        return cleanText.trim() + optionsHtml;
    }
    return text;
}

// Handle option click
window.sendOption = function(option) {
    const userInput = document.getElementById('userInput');
    if (userInput.disabled) return;
    
    userInput.value = option;
    handleSend();
};

// Display loading indicator while waiting for AI response
function displayLoading() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai-message';
    messageDiv.id = 'loadingMessage';
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<i class="ri-robot-2-line"></i>';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.innerHTML = '<span></span><span></span><span></span>';
    
    content.appendChild(loading);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Remove loading indicator
function removeLoading() {
    const loadingMsg = document.getElementById('loadingMessage');
    if (loadingMsg) {
        loadingMsg.remove();
    }
}

// Display error message
function displayError(errorText) {
    displayMessage(`⚠️ Error: ${errorText}`, 'ai');
}

// ========================================
// BACKEND COMMUNICATION
// ========================================
// Send message to backend API
async function sendToBackend(userMessage, mode) {
    // Prevent multiple simultaneous requests
    if (isProcessing) {
        console.log('Already processing a request, please wait...');
        return;
    }
    
    isProcessing = true;
    
    // Disable input and buttons
    setUIEnabled(false);
    
    // Show loading indicator
    displayLoading();
    
    try {
        // Make API call to backend
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: userMessage,
                mode: mode,
                history: chatHistory // Send conversation history
            })
        });
        
        // Remove loading indicator
        removeLoading();
        
        if (!response.ok) {
            // Handle HTTP errors
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Display AI response
        if (data.reply) {
            displayMessage(data.reply, 'ai');
            // Add AI response to history
            chatHistory.push({ role: 'assistant', content: data.reply });
        } else {
            displayError('Received an unexpected response format from the server.');
        }
        
    } catch (error) {
        // Remove loading indicator
        removeLoading();
        
        // Display error message
        console.error('Error:', error);
        
        if (error.message.includes('fetch')) {
            displayError('Cannot connect to the server. Please make sure the backend is running.');
        } else {
            displayError(error.message);
        }
        
    } finally {
        // Re-enable input and buttons
        setUIEnabled(true);
        isProcessing = false;
    }
}

// ========================================
// UI STATE MANAGEMENT
// ========================================
// Enable or disable UI elements
function setUIEnabled(enabled) {
    sendBtn.disabled = !enabled;
    userInput.disabled = !enabled;
    explainBtn.disabled = !enabled;
    quizBtn.disabled = !enabled;
    simplifyBtn.disabled = !enabled;
}

// ========================================
// USER INPUT HANDLING
// ========================================
// Handle send button click
function handleSend() {
    const message = userInput.value.trim();
    
    // Don't send empty messages
    if (!message) return;
    
    // Check if a mode is selected
    if (!currentMode) {
        alert('Please select a learning mode first (Explain, Quiz, or Simplify)');
        return;
    }
    
    // Display user message
    displayMessage(message, 'user');
    
    // Add to history
    chatHistory.push({ role: 'user', content: message });
    
    // Clear input
    userInput.value = '';
    
    // Send to backend
    sendToBackend(message, currentMode);
}

// Handle Enter key in input field
function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
    }
}

// ========================================
// EVENT LISTENERS
// ========================================
// Mode button clicks
explainBtn.addEventListener('click', () => setMode('explain'));
quizBtn.addEventListener('click', () => setMode('quiz'));
simplifyBtn.addEventListener('click', () => setMode('simplify'));

// Send button click
sendBtn.addEventListener('click', handleSend);

// Enter key press
userInput.addEventListener('keypress', handleKeyPress);

// ========================================
// INITIALIZATION
// ========================================
// Focus on input when page loads
window.addEventListener('load', () => {
    userInput.focus();
    
    // Check if backend is available
    checkBackendHealth();
});

// Check backend health on load
async function checkBackendHealth() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();
        console.log('✓ Backend is running:', data.message);
    } catch (error) {
        console.error('✗ Backend is not available:', error);
        displayError('Backend server is not responding. Please start the server with: npm start');
    }
}
